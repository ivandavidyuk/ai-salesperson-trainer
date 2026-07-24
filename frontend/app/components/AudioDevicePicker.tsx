"use client";

// Выбор микрофона и динамика со шкалой уровня.
//
// Шкала здесь важнее списка: без неё человек выбирает вслепую между
// «Микрофон (Realtek)» и «Лин. вход BEHRINGER» и узнаёт о проблеме только
// через десять минут разговора с тишиной.

import { useState } from "react";
import type { AudioDevice } from "@/lib/audioDevices";

// Порог, с которого бэкенд считает звук голосом (_MIN_VOICE_RMS в stt.py).
// Держим здесь то же число: шкала должна показывать не «есть сигнал»,
// а «этого хватит, чтобы вас распознали».
const VOICE_RMS = 500;

// Обычная речь даёт 1000–5000, поэтому шкалу упираем в 4000 —
// иначе полоска почти не двигалась бы
const FULL_SCALE_RMS = 4000;

interface AudioDevicePickerProps {
  inputs: AudioDevice[];
  inputId: string | null;
  onInputChange: (id: string) => void;
  outputs: AudioDevice[];
  outputId: string | null;
  onOutputChange: (id: string) => void;
  /** Текущая громкость в единицах PCM16 */
  level: number;
  /** Слышали ли голос за последние секунды */
  heard: boolean;
  compact?: boolean;
}

const selectClass =
  "w-full rounded-input border-[length:1.5px] border-line bg-surface-card px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-brand";

const labelClass =
  "mb-1.5 block font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover";

/** Короткий тестовый сигнал на выбранный динамик. */
async function playTestTone(deviceId: string | null): Promise<void> {
  // WAV собираем вручную: у элемента <audio> есть setSinkId, а у
  // AudioContext он поддержан далеко не везде
  const rate = 44100;
  const seconds = 0.4;
  const samples = Math.floor(rate * seconds);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);

  for (let i = 0; i < samples; i += 1) {
    // Мягкое затухание к концу, чтобы не щёлкало
    const fade = Math.min(1, (samples - i) / (rate * 0.08));
    const value = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.25 * fade;
    view.setInt16(44 + i * 2, value * 0x7fff, true);
  }

  const blob = new Blob([buffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  try {
    if (deviceId && typeof audio.setSinkId === "function") {
      await audio.setSinkId(deviceId);
    }
    await audio.play();
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
  } catch {
    URL.revokeObjectURL(url);
  }
}

export default function AudioDevicePicker({
  inputs,
  inputId,
  onInputChange,
  outputs,
  outputId,
  onOutputChange,
  level,
  heard,
  compact = false,
}: AudioDevicePickerProps) {
  const [testing, setTesting] = useState(false);

  const percent = Math.min(100, Math.round((level / FULL_SCALE_RMS) * 100));
  const enough = level >= VOICE_RMS;

  return (
    <div className={compact ? "flex flex-col gap-3" : "flex flex-col gap-4"}>
      <div>
        {!compact && <span className={labelClass}>Микрофон</span>}
        <select
          value={inputId ?? ""}
          onChange={(event) => onInputChange(event.target.value)}
          aria-label="Микрофон"
          className={selectClass}
        >
          {inputs.length === 0 && <option value="">Устройства не найдены</option>}
          {inputs.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
        </select>

        {/* Шкала: засечка на пороге, с которого сервер считает звук голосом */}
        <div className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-line-soft">
          <div
            style={{ width: `${percent}%` }}
            className={`h-full rounded-full transition-[width] duration-75 ${
              enough ? "bg-brand" : "bg-brand-sparkline"
            }`}
          />
          <span
            style={{ left: `${(VOICE_RMS / FULL_SCALE_RMS) * 100}%` }}
            className="absolute inset-y-0 w-px bg-line-strong"
            aria-hidden="true"
          />
        </div>

        <div
          className={`mt-1.5 text-[12.5px] ${heard ? "text-good" : "text-ink-subtle"}`}
        >
          {heard ? "Слышу вас" : "Скажите что-нибудь — проверим микрофон"}
        </div>
      </div>

      {outputs.length > 0 && (
        <div>
          {!compact && <span className={labelClass}>Динамик</span>}
          <div className="flex gap-2">
            <select
              value={outputId ?? ""}
              onChange={(event) => onOutputChange(event.target.value)}
              aria-label="Динамик"
              className={selectClass}
            >
              {outputs.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={testing}
              onClick={async () => {
                setTesting(true);
                await playTestTone(outputId);
                window.setTimeout(() => setTesting(false), 500);
              }}
              className="shrink-0 whitespace-nowrap rounded-input border border-line-strong bg-surface-card px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-surface disabled:text-ink-subtle"
            >
              Проверить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
