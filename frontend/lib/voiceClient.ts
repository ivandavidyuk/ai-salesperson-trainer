// Клиентские утилиты для голосового звонка (работают только в браузере):
//   MicRecorder — захват микрофона и потоковая отправка PCM 16 кГц mono;
//   AudioPlayer — стриминговое воспроизведение MP3-ответа через MediaSource
//                 (звук с первого чанка); фолбэк — сборка Blob по предложениям
//                 для браузеров без MSE (iOS Safari).

// Кодирует ArrayBuffer в base64 (порциями, чтобы не переполнить стек).
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

// Декодирует base64 в байты.
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Целевая частота дискретизации, которую ждёт STT
const TARGET_SAMPLE_RATE = 16000;

// Пауза плеера между предложениями ответа, в течение которой ИИ всё ещё
// считается говорящим (иначе индикатор мигал бы на каждом стыке)
const PLAYBACK_GAP_GRACE_MS = 600;

// --- Захват микрофона ------------------------------------------------------

export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private paused = false;

  // Запускает захват. onPcm вызывается с base64-строкой PCM16 на каждый блок.
  async start(onPcm: (base64: string) => void): Promise<void> {
    // Запрашиваем микрофон (моно, с шумо-/эхоподавлением)
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Пытаемся создать контекст сразу на 16 кГц (иначе ворклет ресемплит сам)
    this.ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

    // Некоторые браузеры стартуют контекст в состоянии suspended
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    await this.ctx.audioWorklet.addModule("/pcm-recorder-worklet.js");

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-recorder", {
      processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE },
    });

    // Получаем готовые PCM16-буферы из ворклета
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.paused) return;
      onPcm(arrayBufferToBase64(event.data));
    };

    // Ворклет ничего не выводит в звук (process не пишет output),
    // поэтому подключение к destination не создаёт эха.
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  // Временно перестаёт отправлять аудио (на паузе)
  pause(): void {
    this.paused = true;
  }

  // Возобновляет отправку аудио
  resume(): void {
    this.paused = false;
  }

  // Полностью останавливает захват и освобождает ресурсы
  async stop(): Promise<void> {
    this.paused = true;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        // контекст мог быть уже закрыт
      }
      this.ctx = null;
    }
  }
}

// --- Воспроизведение ответа ------------------------------------------------

// Поддерживается ли стриминговое воспроизведение MP3 через MediaSource.
// iOS Safari не поддерживает MSE — там работает фолбэк на Blob-очередь.
function mseSupported(): boolean {
  return (
    typeof MediaSource !== "undefined" &&
    typeof MediaSource.isTypeSupported === "function" &&
    MediaSource.isTypeSupported("audio/mpeg")
  );
}

export class AudioPlayer {
  // --- Основной путь: MediaSource (звук с первого чанка) ---
  private useMse: boolean;
  private audio: HTMLAudioElement | null = null;
  private mediaSource: MediaSource | null = null;
  private objectUrl: string | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  // Чанки, ожидающие appendBuffer (он асинхронный — аппендим по одному)
  private appendQueue: Uint8Array[] = [];
  private destroyed = false;
  // При локальном barge-in отбрасываем чанки отменяемого ответа до серверного
  // подтверждения. Таймаут не даст плееру зависнуть при потере соединения.
  private ignoreIncomingUntil = 0;
  // appendBuffer мог уже выполняться в момент flush — после updateend нужно
  // перескочить за добавленный хвост отменённого ответа.
  private seekToBufferEndAfterUpdate = false;
  // Когда позиция воспроизведения последний раз реально сдвинулась. Между
  // предложениями ответа бывает короткая пауза (следующее ещё синтезируется) —
  // без этой отметки индикатор «Говорит клиент» мигал бы на каждом стыке.
  private lastActivePlaybackAt = 0;
  // Позиция на прошлом timeupdate — чтобы отличить продвижение от застревания
  private lastPlaybackTime = -1;

  // --- Фолбэк: сборка Blob по предложениям ---
  private pending: Uint8Array[] = [];
  private queue: Blob[] = [];
  private playing = false;
  private current: HTMLAudioElement | null = null;

  constructor() {
    this.useMse = mseSupported();
    if (this.useMse) {
      this._initMse();
    }
  }

  // Добавляет очередной аудио-чанк текущего ответа
  pushChunk(base64: string): void {
    if (performance.now() < this.ignoreIncomingUntil) return;
    const bytes = base64ToBytes(base64);
    if (this.useMse) {
      this.appendQueue.push(bytes);
      this._appendNext();
      this._ensurePlaying();
    } else {
      this.pending.push(bytes);
    }
  }

  // Маркер конца предложения/ответа.
  // MSE: не нужен — поток непрерывный, звук уже играет с первого чанка.
  // Фолбэк: собираем накопленный MP3 и ставим в очередь воспроизведения.
  endUtterance(): void {
    if (this.useMse) return;
    if (this.pending.length === 0) return;
    const parts = this.pending.map((u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer);
    const blob = new Blob(parts, { type: "audio/mpeg" });
    this.pending = [];
    this.queue.push(blob);
    if (!this.playing) {
      void this._playNext();
    }
  }

  /** Мгновенно глушит ответ до подтверждения отмены сервером. */
  interrupt(): void {
    this.ignoreIncomingUntil = performance.now() + 1500;
    this._flushPlayback();
  }

  /** Звучит ли сейчас ответ ИИ — для индикатора на экране звонка. */
  isPlaying(): boolean {
    const now = performance.now();
    if (now < this.ignoreIncomingUntil) return false;
    if (this._isActivelyPlaying()) {
      this.lastActivePlaybackAt = now;
      return true;
    }
    // Грация на паузы между предложениями: буфер доигран, а следующее
    // предложение ещё синтезируется — ИИ всё ещё «говорит»
    return now - this.lastActivePlaybackAt <= PLAYBACK_GAP_GRACE_MS;
  }

  private _isActivelyPlaying(): boolean {
    if (this.useMse) {
      // По геометрии буфера судить нельзя: MediaSource не ставит элемент на
      // паузу между ответами, а buffered.end понемногу уползает вперёд от
      // реально доигранного — к середине разговора «ИИ говорит» залипало
      // навсегда. Факт речи даёт только продвижение позиции (см. timeupdate),
      // здесь остаётся начало ответа: звук ещё не пошёл, но чанки уже пришли.
      return this.appendQueue.length > 0 || Boolean(this.sourceBuffer?.updating);
    }
    return this.playing || this.queue.length > 0 || this.pending.length > 0;
  }

  // Позиция сдвинулась — значит звук идёт на самом деле. Застрявшее
  // воспроизведение timeupdate не шлёт, и грация спокойно истечёт.
  private _notePlaybackProgress(): void {
    const audio = this.audio;
    // На паузе timeupdate приходит только от нашего же seek (flush после
    // перебивания) — это не речь
    if (!audio || audio.paused) return;
    if (audio.currentTime > this.lastPlaybackTime) {
      this.lastPlaybackTime = audio.currentTime;
      this.lastActivePlaybackAt = performance.now();
    }
  }

  /** Сервер подтвердил границу отменённого ответа — можно принимать следующий. */
  confirmInterrupt(): void {
    this._flushPlayback();
    this.ignoreIncomingUntil = 0;
  }

  // Сбрасывает недоигранный буфер, оставляя плеер готовым к следующему ответу.
  private _flushPlayback(): void {
    this.appendQueue = [];
    this.pending = [];
    // Обрыв ответа — ИИ больше не говорит, грацию не тянем
    this.lastActivePlaybackAt = 0;
    if (this.useMse) {
      const sb = this.sourceBuffer;
      const audio = this.audio;
      if (!audio) return;
      audio.pause();
      if (!sb) return;
      if (sb.updating) {
        this.seekToBufferEndAfterUpdate = true;
      }
      try {
        if (sb.buffered.length > 0) {
          const end = sb.buffered.end(sb.buffered.length - 1);
          if (end > audio.currentTime) {
            audio.currentTime = end;
          }
        }
      } catch {
        // updateend повторит seek, если appendBuffer ещё выполняется
      }
    } else {
      this.queue = [];
      this.playing = false;
      if (this.current) {
        this.current.onended = null;
        this.current.onerror = null;
        this.current.pause();
        this.current = null;
      }
    }
  }

  // Останавливает воспроизведение и освобождает ресурсы (терминально)
  reset(): void {
    this.destroyed = true;
    this.ignoreIncomingUntil = 0;
    this.seekToBufferEndAfterUpdate = false;
    this.lastActivePlaybackAt = 0;
    this.lastPlaybackTime = -1;
    // MSE-путь
    this.appendQueue = [];
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.sourceBuffer = null;
    this.mediaSource = null;
    // Фолбэк
    this.pending = [];
    this.queue = [];
    this.playing = false;
    if (this.current) {
      this.current.pause();
      this.current.onended = null;
      this.current.onerror = null;
      this.current = null;
    }
  }

  // --- Внутренности MSE-пути ---

  private _initMse(): void {
    this.mediaSource = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    this.audio = new Audio(this.objectUrl);
    // Единственный надёжный признак речи — что позиция реально растёт
    this.audio.addEventListener("timeupdate", () => this._notePlaybackProgress());

    this.mediaSource.addEventListener("sourceopen", () => {
      if (this.destroyed || !this.mediaSource) return;
      const sb = this.mediaSource.addSourceBuffer("audio/mpeg");
      // sequence: сегменты идут подряд по мере добавления — таймстемпы
      // MP3-фреймов из разных TTS-ответов не важны, пауз между ответами
      // в буфере нет (элемент просто ждёт новых данных)
      sb.mode = "sequence";
      sb.addEventListener("updateend", () => {
        if (this.seekToBufferEndAfterUpdate && this.audio) {
          this.seekToBufferEndAfterUpdate = false;
          try {
            if (sb.buffered.length > 0) {
              this.audio.currentTime = sb.buffered.end(sb.buffered.length - 1);
            }
          } catch {
            // диапазон мог измениться между проверкой и seek
          }
        }
        this._healGap();
        this._cleanupPlayed();
        this._appendNext();
      });
      this.sourceBuffer = sb;
      this._appendNext();
    });
  }

  // Аппендит следующий чанк, когда SourceBuffer свободен
  private _appendNext(): void {
    const sb = this.sourceBuffer;
    if (this.destroyed || !sb || sb.updating) return;
    const chunk = this.appendQueue.shift();
    if (!chunk) return;
    try {
      sb.appendBuffer(chunk as BufferSource);
    } catch {
      // QuotaExceededError и подобное: вернём чанк и попробуем после чистки
      this.appendQueue.unshift(chunk);
      this._cleanupPlayed();
    }
  }

  // Страховка после flush: если позиция воспроизведения оказалась в дыре
  // перед новыми данными (буфер впереди был удалён), перескакиваем на них
  private _healGap(): void {
    const sb = this.sourceBuffer;
    const audio = this.audio;
    if (!sb || !audio || sb.buffered.length === 0) return;
    for (let i = 0; i < sb.buffered.length; i++) {
      const start = sb.buffered.start(i);
      const end = sb.buffered.end(i);
      // Позиция внутри диапазона, где ещё есть что играть — всё в порядке
      if (audio.currentTime >= start - 0.05 && audio.currentTime < end - 0.01) {
        return;
      }
      // Данные впереди позиции — перескакиваем на их начало
      if (start > audio.currentTime + 0.05) {
        audio.currentTime = start;
        return;
      }
    }
  }

  // Удаляет уже отыгранные диапазоны, чтобы буфер не рос бесконечно
  private _cleanupPlayed(): void {
    const sb = this.sourceBuffer;
    const audio = this.audio;
    if (!sb || !audio || sb.updating || sb.buffered.length === 0) return;
    const start = sb.buffered.start(0);
    // Держим последние 30 секунд до текущей позиции
    const cutoff = audio.currentTime - 30;
    if (cutoff > start) {
      try {
        sb.remove(start, cutoff);
      } catch {
        // не критично — почистим в следующий раз
      }
    }
  }

  // Запускает воспроизведение, если оно ещё не идёт
  private _ensurePlaying(): void {
    const audio = this.audio;
    if (!audio || !audio.paused) return;
    audio.play().catch(() => {
      // автоплей заблокирован — звук пойдёт после жеста пользователя
    });
  }

  // --- Внутренности фолбэка (Blob-очередь) ---

  private async _playNext(): Promise<void> {
    const blob = this.queue.shift();
    if (!blob) {
      this.playing = false;
      return;
    }
    this.playing = true;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.current = audio;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      this.current = null;
      void this._playNext();
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;

    try {
      await audio.play();
    } catch {
      // автоплей мог быть заблокирован — переходим к следующему
      cleanup();
    }
  }
}
