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

/** Громкость блока PCM16 — те же единицы, что считает бэкенд. */
function pcm16Rms(buffer: ArrayBuffer): number {
  const samples = new Int16Array(buffer);
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

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

  /**
   * Запускает захват. onPcm вызывается с base64-строкой PCM16 на каждый блок,
   * onLevel — с громкостью этого блока в тех же единицах, что считает сервер
   * (PCM16), чтобы шкала в интерфейсе и порог голоса на бэкенде говорили
   * на одном языке.
   */
  async start(
    onPcm: (base64: string) => void,
    options: {
      deviceId?: string | null;
      onLevel?: (rms: number) => void;
      /** Сохранённое устройство исчезло — id больше не годится */
      onDeviceMissing?: () => void;
    } = {}
  ): Promise<void> {
    const { deviceId, onLevel, onDeviceMissing } = options;

    // Моно, с шумо- и эхоподавлением
    const constraints = (id?: string | null): MediaStreamConstraints => ({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        ...(id ? { deviceId: { exact: id } } : {}),
      },
    });

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(
        constraints(deviceId)
      );
    } catch (error) {
      // Выбранного устройства больше нет (вынули гарнитуру, сменился профиль).
      // Без отката человек оказался бы заперт с неработающим микрофоном.
      const name = (error as { name?: string } | null)?.name;
      if (deviceId && (name === "OverconstrainedError" || name === "NotFoundError")) {
        onDeviceMissing?.();
        this.stream = await navigator.mediaDevices.getUserMedia(constraints(null));
      } else {
        throw error;
      }
    }

    // Пытаемся создать контекст сразу на 16 кГц. Если устройство такую
    // частоту не отдаёт и браузер отказывается — берём его умолчание:
    // ворклет читает реальную частоту контекста и ресемплит сам.
    try {
      this.ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      this.ctx = new AudioContext();
    }

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
      // Уровень считаем из того же буфера, что уходит на сервер, — лишней
      // работы нет, а шкала показывает ровно то, что слышит распознавание
      if (onLevel) onLevel(pcm16Rms(event.data));
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

/**
 * Снимок состояния плеера для серверного лога.
 *
 * Появился после разбора сессии 37f584df: ИИ четыре минуты «молчал», хотя
 * сервер исправно слал аудио. Понять это по серверным логам было нельзя —
 * плеер не сообщал о себе ничего. Теперь сообщает.
 */
export interface PlayerDiagnostic {
  event: string;
  detail?: string;
  currentTime?: number;
  paused?: boolean;
  readyState?: number;
  bufferedEnd?: number;
  ranges?: number;
  queued?: number;
}

// Как часто сторож проверяет, идёт ли воспроизведение на самом деле
const WATCHDOG_TICK_MS = 1000;
// Позиция не двигается, а играть есть что — считаем это застреванием
const STALL_AFTER_MS = 2000;
// Мягкая починка не помогла — пересобираем MediaSource целиком
const STALL_REBUILD_AFTER_MS = 4000;
// Меньше этого «хвоста» в буфере — обычная тишина между ответами, не застревание
const STALL_MIN_UNPLAYED_SEC = 0.25;
// На сколько толкать позицию, когда данные есть, а элемент их не играет.
// Кадр MP3 при 44.1 кГц — около 26 мс, так что это меньше двух кадров:
// достаточно, чтобы конвейер пересобрался, и незаметно на слух
const NUDGE_SEC = 0.05;
// Периодический снимок состояния, чтобы видеть дрейф позиции и буфера
const HEARTBEAT_TICKS = 10;
// Предохранители пересборки: она сама создаёт элемент с теми же обработчиками
const REBUILD_COOLDOWN_MS = 5000;
const MAX_REBUILDS = 8;

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

  /** Выбранный динамик. Запоминаем: в фолбэке элемент новый на каждое предложение. */
  private outputDeviceId: string | null = null;

  // --- Сторож застревания ---
  private onDiagnostic?: (data: PlayerDiagnostic) => void;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** Когда сторож впервые увидел, что позиция стоит, а играть есть что */
  private stalledSince = 0;
  private ticks = 0;
  private rebuilds = 0;
  private lastRebuildAt = 0;

  constructor(onDiagnostic?: (data: PlayerDiagnostic) => void) {
    this.onDiagnostic = onDiagnostic;
    this.useMse = mseSupported();
    if (this.useMse) {
      this._initMse();
      this.watchdog = setInterval(() => this._watch(), WATCHDOG_TICK_MS);
    }
    this._report("init", this.useMse ? "mse" : "blob-fallback");
  }

  /** Снимок состояния — уходит в серверный лог рядом с таймингами хода. */
  private _report(event: string, detail?: string): void {
    if (!this.onDiagnostic) return;
    const audio = this.audio;
    const sb = this.sourceBuffer;
    const round = (n: number) => Math.round(n * 100) / 100;

    let ranges = 0;
    let bufferedEnd: number | undefined;
    try {
      if (sb && sb.buffered.length > 0) {
        ranges = sb.buffered.length;
        bufferedEnd = round(sb.buffered.end(sb.buffered.length - 1));
      }
    } catch {
      // буфер могли пересобрать между проверкой и чтением
    }

    this.onDiagnostic({
      event,
      detail,
      currentTime: audio ? round(audio.currentTime) : undefined,
      paused: audio?.paused,
      readyState: audio?.readyState,
      bufferedEnd,
      ranges,
      queued: this.appendQueue.length,
    });
  }

  /**
   * Переключает вывод на другой динамик. Работает только там, где есть
   * setSinkId (Chromium); в Firefox и на iOS тихо ничего не делает.
   */
  setOutputDevice(deviceId: string | null): void {
    this.outputDeviceId = deviceId;
    if (this.audio) void this._applySink(this.audio);
    if (this.current) void this._applySink(this.current);
  }

  private async _applySink(audio: HTMLAudioElement): Promise<void> {
    if (!this.outputDeviceId) return;
    if (typeof audio.setSinkId !== "function") return;
    try {
      await audio.setSinkId(this.outputDeviceId);
    } catch {
      // Устройство могли вынуть — остаёмся на прежнем выводе
    }
  }

  // Добавляет очередной аудио-чанк текущего ответа
  pushChunk(base64: string): void {
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

  /** Звучит ли сейчас ответ ИИ — для индикатора на экране звонка. */
  isPlaying(): boolean {
    const now = performance.now();
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

  /** Сервер оборвал ответ (barge_in) — недоигранный хвост уже не нужен. */
  confirmInterrupt(): void {
    this._report("barge-in");
    this._flushPlayback();
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
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
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

  // --- Сторож застревания ---

  /**
   * Раз в секунду проверяет, идёт ли звук на самом деле.
   *
   * Признак беды: в буфере есть неигранный хвост (или ждут чанки), а позиция
   * не двигается. Сначала пробуем мягко — вернуть позицию к данным и толкнуть
   * play(). Если через несколько секунд не помогло, пересобираем MediaSource:
   * пусть лучше пропадёт пара секунд звука, чем ИИ замолчит на минуты.
   */
  private _watch(): void {
    if (this.destroyed || !this.useMse) return;
    const audio = this.audio;
    const sb = this.sourceBuffer;
    if (!audio || !sb) return;

    this.ticks += 1;
    if (this.ticks % HEARTBEAT_TICKS === 0) this._report("heartbeat");

    let unplayed = 0;
    try {
      if (sb.buffered.length > 0) {
        unplayed = sb.buffered.end(sb.buffered.length - 1) - audio.currentTime;
      }
    } catch {
      return;
    }

    // Играть нечего — обычная тишина между ответами, не застревание
    if (unplayed <= STALL_MIN_UNPLAYED_SEC && this.appendQueue.length === 0) {
      this.stalledSince = 0;
      return;
    }

    const now = performance.now();
    // Позиция двигалась недавно — звук идёт
    if (now - this.lastActivePlaybackAt < STALL_AFTER_MS) {
      this.stalledSince = 0;
      return;
    }

    if (this.stalledSince === 0) {
      this.stalledSince = now;
      this._report("stall", `unplayed=${Math.round(unplayed * 100) / 100}`);
      const before = audio.currentTime;
      this._healGap();
      this._ensurePlaying();
      // Ни то, ни другое не сдвинуло позицию — значит это застревание
      // «данные есть, играть отказывается». Расталкиваем перемоткой.
      if (audio.currentTime === before) this._nudgePosition();
      return;
    }

    if (now - this.stalledSince >= STALL_REBUILD_AFTER_MS) {
      this._report("rebuild");
      this._rebuildMse();
    }
  }

  /**
   * Полностью пересобирает MediaSource, сохраняя неотданные чанки.
   *
   * Пересборка создаёт новый элемент с теми же обработчиками, поэтому
   * устойчивая ошибка декодирования закрутила бы бесконечный цикл. Отсюда
   * пауза между попытками и общий предел на разговор: если не помогает,
   * лучше остаться сломанным предсказуемо и увидеть это в логе.
   */
  private _rebuildMse(): void {
    if (this.destroyed) return;

    const now = performance.now();
    if (now - this.lastRebuildAt < REBUILD_COOLDOWN_MS) return;
    if (this.rebuilds >= MAX_REBUILDS) {
      if (this.rebuilds === MAX_REBUILDS) {
        this.rebuilds += 1; // сообщаем один раз, дальше молчим
        this._report("rebuild-giving-up");
      }
      return;
    }
    this.lastRebuildAt = now;
    this.rebuilds += 1;

    const pending = this.appendQueue.slice();

    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.sourceBuffer = null;
    this.mediaSource = null;
    this.seekToBufferEndAfterUpdate = false;
    this.lastPlaybackTime = -1;
    // Даём новому элементу время раскрутиться, не считая это застреванием
    this.lastActivePlaybackAt = performance.now();
    this.stalledSince = 0;

    this._initMse();
    this.appendQueue = pending;
    this._appendNext();
  }

  // --- Внутренности MSE-пути ---

  private _initMse(): void {
    this.mediaSource = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    const audio = new Audio(this.objectUrl);
    this.audio = audio;
    void this._applySink(audio);
    // Единственный надёжный признак речи — что позиция реально растёт
    audio.addEventListener("timeupdate", () => this._notePlaybackProgress());

    // Раньше элемент молчал обо всём: ошибка декодирования, ожидание данных
    // и остановка проходили незамеченными, а отказ play() глотался пустым
    // catch. Именно поэтому клиентский сбой было не отличить от серверного.
    audio.addEventListener("error", () => {
      const code = audio.error?.code;
      const names: Record<number, string> = {
        1: "ABORTED",
        2: "NETWORK",
        3: "DECODE",
        4: "SRC_NOT_SUPPORTED",
      };
      this._report("audio-error", code ? (names[code] ?? String(code)) : "unknown");
      // Элемент с ошибкой мёртв навсегда — только пересборка
      this._rebuildMse();
    });
    audio.addEventListener("stalled", () => this._report("stalled"));
    audio.addEventListener("ended", () => this._report("ended"));

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
    if (!sb || !audio) return;
    let count = 0;
    try {
      count = sb.buffered.length;
    } catch {
      return; // буфер пересобирают — вернёмся на следующем updateend
    }
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
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

    // Позиция ЗА концом всех данных. Раньше этот случай не обрабатывался, и
    // плеер вставал намертво: новые чанки в режиме sequence ложатся в конец
    // последнего диапазона, то есть позади позиции, а сама позиция назад
    // не возвращается — играть оказывается нечего. Так ответы ИИ копились
    // в буфере минутами, пока очередной append случайно не догонял позицию
    // и всё не проигрывалось залпом.
    const lastEnd = sb.buffered.end(count - 1);
    if (audio.currentTime > lastEnd) {
      audio.currentTime = lastEnd;
      this._report("healed-past-end");
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

  // Запускает воспроизведение, если оно ещё не идёт.
  //
  // Условия `!audio.paused` здесь раньше было достаточно, чтобы выйти, — и это
  // ломало единственный путь восстановления: застрявший MSE-элемент стоит
  // НЕ на паузе, он ждёт данных (paused === false, readyState низкий).
  // Проверка отсекала как раз тот случай, ради которого метод и нужен.
  /**
   * Микро-перемотка вперёд, чтобы расшевелить застрявший MediaSource.
   *
   * Все застревания в живых разговорах выглядели одинаково: элемент не на
   * паузе, readyState 2 или 4, впереди в том же диапазоне лежит до восьми
   * секунд речи — и позиция стоит. Ни один из прежних приёмов на этот случай
   * не рассчитан: _healGap не видит дыры и выходит, а _ensurePlaying при
   * readyState >= 3 не делает ничего.
   *
   * Перемотка на несколько миллисекунд заставляет элемент пересобрать
   * конвейер декодирования. Теряется меньше двух MP3-кадров — на слух
   * незаметно, в отличие от полной пересборки MediaSource, которая стоит
   * пары секунд звука.
   */
  private _nudgePosition(): void {
    const audio = this.audio;
    const sb = this.sourceBuffer;
    if (!audio || !sb) return;
    try {
      if (sb.buffered.length === 0) return;
      const end = sb.buffered.end(sb.buffered.length - 1);
      const target = audio.currentTime + NUDGE_SEC;
      // За концом данных играть нечего — там перемотка только навредит,
      // этот случай уже разбирает _healGap
      if (target >= end) return;
      audio.currentTime = target;
      this._report("nudge");
    } catch {
      // Буфер пересобирают — попробуем на следующем тике сторожа
    }
  }

  private _ensurePlaying(): void {
    const audio = this.audio;
    if (!audio) return;
    // HAVE_FUTURE_DATA и выше при снятой паузе — звук идёт, дёргать незачем
    if (!audio.paused && audio.readyState >= 3) return;

    const started = audio.play();
    if (!started || typeof started.catch !== "function") return;
    started.catch((error: unknown) => {
      const name = (error as { name?: string } | null)?.name ?? "unknown";
      // AbortError — штатное следствие pause()/seek сразу после play()
      if (name === "AbortError") return;
      this._report("play-rejected", name);
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
    void this._applySink(audio);

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
