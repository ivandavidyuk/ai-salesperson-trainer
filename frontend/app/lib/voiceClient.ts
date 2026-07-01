// Клиентские утилиты для голосового звонка (работают только в браузере):
//   MicRecorder — захват микрофона и потоковая отправка PCM 16 кГц mono;
//   AudioPlayer — сборка OGG-ответа из чанков и последовательное воспроизведение.

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

export class AudioPlayer {
  // Накопитель чанков текущего (ещё не завершённого) ответа
  private pending: Uint8Array[] = [];
  // Очередь готовых к проигрыванию аудио-ответов
  private queue: Blob[] = [];
  private playing = false;
  private current: HTMLAudioElement | null = null;

  // Добавляет очередной OGG-чанк текущего ответа
  pushChunk(base64: string): void {
    this.pending.push(base64ToBytes(base64));
  }

  // Ответ завершён: собираем OGG целиком и ставим в очередь воспроизведения
  endUtterance(): void {
    if (this.pending.length === 0) return;
    const parts = this.pending.map((u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer);
    const blob = new Blob(parts, { type: "audio/ogg" });
    this.pending = [];
    this.queue.push(blob);
    if (!this.playing) {
      void this._playNext();
    }
  }

  // Проигрывает следующий ответ из очереди
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

  // Останавливает воспроизведение и очищает всё накопленное
  reset(): void {
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
}
