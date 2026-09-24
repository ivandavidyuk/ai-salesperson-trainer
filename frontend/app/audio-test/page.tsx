"use client";

// Временный стенд: куда Android отправляет звук, пока сайт держит микрофон.
//
// 24.09 на Pixel с Bluetooth-наушниками голос пациента шёл в динамик
// телефона, хотя человек говорил в наушники. Гипотеза: захват микрофона
// с эхоподавлением переводит Android в режим звонка, наушники уходят
// в гарнитурный канал, а обычное воспроизведение — в динамик. Кнопки ниже
// проигрывают один и тот же тон разными способами при разных режимах
// микрофона; по тому, какие звучат в наушниках, выбирается починка.
//
// Ссылок сюда нет, страница за входом. Удалить после замера.

import { useEffect, useRef, useState } from "react";

// Пять коротких сигналов 440 Гц. Длинный тон нарочно: если звук переедет
// из динамика в наушники посреди проигрывания, это будет слышно
function toneWav(): Blob {
  const rate = 44100;
  const seconds = 3;
  const samples = Math.floor(rate * seconds);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
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
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const on = t % 0.6 < 0.4 ? 1 : 0;
    const value = Math.sin(2 * Math.PI * 440 * t) * 0.35 * on;
    view.setInt16(44 + i * 2, value * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// aec — как в тренажёре сейчас; raw — вся обработка выключена;
// ns — без эхоподавления, но с шумоподавлением и автоусилением
type Режим = "aec" | "raw" | "ns" | "none";

interface Вариант {
  key: string;
  label: string;
  mic: Режим;
  how: "element" | "webaudio" | "stream";
}

const ВАРИАНТЫ: Вариант[] = [
  { key: "A", label: "Как сейчас в тренажёре: микрофон с эхоподавлением, звук через <audio>", mic: "aec", how: "element" },
  { key: "B", label: "Микрофон с эхоподавлением, звук через Web Audio", mic: "aec", how: "webaudio" },
  { key: "C", label: "Микрофон с эхоподавлением, звук через поток (как у звонков WebRTC)", mic: "aec", how: "stream" },
  { key: "D", label: "Микрофон без всякой обработки, звук через <audio>", mic: "raw", how: "element" },
  { key: "E", label: "Микрофон без эхоподавления, но с шумоподавлением, звук через <audio>", mic: "ns", how: "element" },
  { key: "F", label: "Без микрофона, звук через <audio> (контроль)", mic: "none", how: "element" },
];

function обработка(mode: Режим): MediaTrackConstraints {
  if (mode === "aec") return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (mode === "ns") return { echoCancellation: false, noiseSuppression: true, autoGainControl: true };
  return { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
}

export default function AudioTestPage() {
  const stream = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState("Нажмите вариант — прозвучат пять коротких сигналов");
  const [devices, setDevices] = useState<string[]>([]);

  function stopMic() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }

  async function refreshDevices() {
    const all = await navigator.mediaDevices?.enumerateDevices();
    setDevices((all ?? []).map((d) => `${d.kind}: ${d.label || "(без подписи)"}`));
  }

  async function startMic(mode: Режим): Promise<string> {
    stopMic();
    if (mode === "none") return "микрофон выключен";
    stream.current = await navigator.mediaDevices.getUserMedia({ audio: обработка(mode) });
    const track = stream.current.getAudioTracks()[0];
    const settings = track?.getSettings() ?? {};
    void refreshDevices();
    return (
      `микрофон «${track?.label || "без подписи"}», ` +
      `эхоподавление ${settings.echoCancellation ? "вкл" : "выкл"}, ` +
      `шумоподавление ${settings.noiseSuppression ? "вкл" : "выкл"}`
    );
  }

  async function play(вариант: Вариант) {
    try {
      setStatus(`Вариант ${вариант.key}: включаю…`);
      const mic = await startMic(вариант.mic);
      // Гарнитурный канал Bluetooth поднимается около секунды — без паузы
      // первый сигнал ушёл бы туда, где звук был до переключения
      await new Promise((r) => setTimeout(r, 1200));
      const blob = toneWav();
      if (вариант.how === "element") {
        const audio = new Audio(URL.createObjectURL(blob));
        await audio.play();
      } else {
        // Свежий контекст на каждый прогон: поток вывода открывается при
        // создании контекста, и старый мог остаться на прежнем маршруте
        const ctx = new AudioContext();
        await ctx.resume();
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        if (вариант.how === "webaudio") {
          source.connect(ctx.destination);
        } else {
          const dest = ctx.createMediaStreamDestination();
          source.connect(dest);
          const audio = new Audio();
          audio.srcObject = dest.stream;
          await audio.play();
        }
        source.onended = () => void ctx.close();
        source.start();
      }
      setStatus(`Вариант ${вариант.key} звучит — ${mic}. Где слышно: в наушниках или в динамике?`);
    } catch (error) {
      const name = (error as { name?: string } | null)?.name ?? "ошибка";
      setStatus(`Вариант ${вариант.key}: не получилось — ${name}`);
    }
  }

  useEffect(() => {
    void refreshDevices();
    return stopMic;
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-[520px] bg-surface px-4 py-6">
      <h1 className="text-[22px] font-semibold text-ink">Куда идёт звук</h1>
      <p className="mt-2 text-[15px] leading-normal text-ink-muted">
        Подключите Bluetooth-наушники и нажимайте варианты по очереди. Про
        каждый запомните: сигналы в наушниках или в динамике телефона.
      </p>

      <div className="mt-5 flex flex-col gap-2.5">
        {ВАРИАНТЫ.map((вариант) => (
          <button
            key={вариант.key}
            type="button"
            onClick={() => void play(вариант)}
            className="flex min-h-[56px] items-center gap-3 rounded-xl border border-line-strong bg-surface-card px-4 py-3 text-left text-[15px] font-medium text-ink active:bg-surface-bubble"
          >
            <span className="font-mono text-[18px] font-semibold text-brand">{вариант.key}</span>
            {вариант.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            stopMic();
            setStatus("Микрофон выключен");
          }}
          className="min-h-11 rounded-xl px-4 text-[15px] font-semibold text-ink-muted"
        >
          Выключить микрофон
        </button>
      </div>

      <p className="mt-5 rounded-xl bg-surface-card px-4 py-3 text-[15px] leading-normal text-ink-body">
        {status}
      </p>

      <div className="mt-5 font-mono text-[12px] leading-relaxed text-ink-subtle">
        {devices.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </main>
  );
}
