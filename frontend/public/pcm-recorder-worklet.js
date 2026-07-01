// AudioWorklet-процессор для захвата микрофона.
// Берёт вход Float32, при необходимости ресемплит к целевой частоте (16 кГц),
// конвертирует в 16-битный PCM (LINEAR16) и отправляет буфер в основной поток.
// Данные копятся блоками (~200 мс), чтобы не слать слишком много сообщений.

class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    // Целевая частота дискретизации для STT (Yandex ждёт 16 кГц mono)
    this.targetRate = opts.targetSampleRate || 16000;
    // Фактическая частота контекста (глобальная в scope ворклета)
    this.inputRate = sampleRate;
    this._chunk = [];
    // Порог накопления на входной частоте (~200 мс аудио)
    this._threshold = Math.round(this.inputRate * 0.2);
  }

  // Ресемпл + конверсия Float32 -> Int16 и отправка в основной поток
  _flush() {
    const inputLen = this._chunk.length;
    if (inputLen === 0) return;

    const ratio = this.inputRate / this.targetRate;
    const outLen = Math.max(1, Math.floor(inputLen / ratio));
    const out = new Int16Array(outLen);

    for (let i = 0; i < outLen; i++) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, inputLen - 1);
      const frac = idx - i0;
      // Линейная интерполяция между соседними отсчётами
      const sample = this._chunk[i0] * (1 - frac) + this._chunk[i1] * frac;
      const s = Math.max(-1, Math.min(1, sample));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this.port.postMessage(out.buffer, [out.buffer]);
    this._chunk = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      for (let i = 0; i < channel.length; i++) {
        this._chunk.push(channel[i]);
      }
      if (this._chunk.length >= this._threshold) {
        this._flush();
      }
    }
    // Возвращаем true, чтобы процессор продолжал работать
    return true;
  }
}

registerProcessor("pcm-recorder", PCMRecorderProcessor);
