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
//
// Замер 24.09: все шесть кнопок A–F звучат в наушниках, в том числе A,
// устроенная как тренажёр. Значит, тренажёр отличается чем-то ещё. Кандидаты —
// то, чего у кнопок A–F нет: сохранённые в браузере микрофон и динамик
// (выбор динамика на телефоне теперь скрыт, но мог остаться с июля, когда
// телефон видел десктопную вёрстку), захват через MicRecorder с контекстом
// на 16 кГц и плеер на MediaSource. Кнопки G–J добавляют их по одному.
//
// Иван уточнил: после выдачи доступа в списке было четыре микрофона, и он
// выбрал микрофон наушников. Если это он — наушники уходят в режим звонка,
// музыкальный канал отключается, и обычный звук Android отдаёт в динамик.
// K и L проверяют, идёт ли в наушники звук другими путями при их микрофоне.

import { useEffect, useRef, useState } from "react";
import { AudioPlayer, MicRecorder } from "@/lib/voiceClient";
import {
  saveInputId,
  saveOutputId,
  savedInputId,
  savedOutputId,
} from "@/lib/audioDevices";

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

// Связка тренажёра по частям. «Сохранённое» — то, что лежит в localStorage
// этого браузера под ключами выбора устройств
interface ВариантТренажёра {
  key: string;
  label: string;
  /** Захват как в тренажёре (MicRecorder) или простой getUserMedia */
  recorder: boolean;
  /** Брать сохранённый микрофон */
  savedInput: boolean;
  /** Отправлять звук в сохранённый динамик (setSinkId) */
  savedOutput: boolean;
  /** Чем играть: плеер тренажёра (MediaSource), простой <audio>,
   *  поток через MediaStreamDestination (путь звонков) или Web Audio */
  how: "player" | "element" | "stream" | "webaudio";
}

const ВАРИАНТЫ_ТРЕНАЖЁРА: ВариантТренажёра[] = [
  { key: "G", label: "Тренажёр целиком: его захват, его плеер, сохранённые микрофон и динамик", recorder: true, savedInput: true, savedOutput: true, how: "player" },
  { key: "H", label: "Тренажёр без сохранённого: его захват и плеер, устройства по умолчанию", recorder: true, savedInput: false, savedOutput: false, how: "player" },
  { key: "I", label: "Только сохранённый динамик: обычный микрофон, <audio> в сохранённый динамик", recorder: false, savedInput: false, savedOutput: true, how: "element" },
  { key: "J", label: "Только сохранённый микрофон: он же с эхоподавлением, обычный <audio>", recorder: false, savedInput: true, savedOutput: false, how: "element" },
  { key: "K", label: "Сохранённый микрофон, звук через поток (путь звонков)", recorder: false, savedInput: true, savedOutput: false, how: "stream" },
  { key: "L", label: "Сохранённый микрофон, звук через Web Audio", recorder: false, savedInput: true, savedOutput: false, how: "webaudio" },
];

function base64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function обработка(mode: Режим): MediaTrackConstraints {
  if (mode === "aec") return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (mode === "ns") return { echoCancellation: false, noiseSuppression: true, autoGainControl: true };
  return { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
}

export default function AudioTestPage() {
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MicRecorder | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const [status, setStatus] = useState("Нажмите вариант — прозвучат пять коротких сигналов");
  const [devices, setDevices] = useState<{ kind: string; label: string; id: string }[]>([]);
  const [saved, setSaved] = useState<{ input: string | null; output: string | null }>({
    input: null,
    output: null,
  });

  function stopMic() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void recorder.current?.stop();
    recorder.current = null;
    player.current?.reset();
    player.current = null;
  }

  async function refreshDevices() {
    setSaved({ input: savedInputId(), output: savedOutputId() });
    const all = await navigator.mediaDevices?.enumerateDevices();
    setDevices(
      (all ?? []).map((d) => ({ kind: d.kind, label: d.label || "(без подписи)", id: d.deviceId }))
    );
  }

  // Сохранённое устройство словами: подпись из списка браузера, если нашлась
  function назвать(
    id: string | null,
    kind: string,
    list: { kind: string; label: string; id: string }[] = devices
  ): string {
    if (!id) return "не сохранён — берётся по умолчанию";
    const device = list.find((d) => d.id === id && d.kind === kind);
    return device ? `«${device.label}» (${id.slice(0, 8)})` : `нет в списке (${id.slice(0, 8)})`;
  }

  async function playTrainer(вариант: ВариантТренажёра) {
    try {
      setStatus(`Вариант ${вариант.key}: включаю…`);
      stopMic();
      const inputId = вариант.savedInput ? savedInputId() : null;
      const outputId = вариант.savedOutput ? savedOutputId() : null;
      if (вариант.recorder) {
        recorder.current = new MicRecorder();
        await recorder.current.start(() => {}, { deviceId: inputId });
      } else {
        stream.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            ...(inputId ? { deviceId: { exact: inputId } } : {}),
          },
        });
      }
      void refreshDevices();
      // Свежий список: состояние в этом замыкании ещё прежнее
      const list = ((await navigator.mediaDevices.enumerateDevices()) ?? []).map((d) => ({
        kind: d.kind,
        label: d.label || "(без подписи)",
        id: d.deviceId,
      }));
      await new Promise((r) => setTimeout(r, 1200));
      const mp3 = await (await fetch("/audio-test-tone.mp3")).arrayBuffer();
      if (вариант.how === "player") {
        player.current = new AudioPlayer();
        player.current.setOutputDevice(outputId);
        player.current.pushChunk(base64(mp3));
        player.current.endUtterance();
      } else if (вариант.how === "stream" || вариант.how === "webaudio") {
        const ctx = new AudioContext();
        await ctx.resume();
        const source = ctx.createBufferSource();
        source.buffer = await ctx.decodeAudioData(mp3.slice(0));
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
      } else {
        const audio = new Audio(URL.createObjectURL(new Blob([mp3], { type: "audio/mpeg" })));
        if (outputId && typeof audio.setSinkId === "function") await audio.setSinkId(outputId);
        await audio.play();
      }
      setStatus(
        `Вариант ${вариант.key} звучит (сигнал три секунды). Микрофон: ${назвать(inputId, "audioinput", list)}; ` +
          `динамик: ${назвать(outputId, "audiooutput", list)}. Где слышно?`
      );
    } catch (error) {
      const name = (error as { name?: string } | null)?.name ?? "ошибка";
      setStatus(`Вариант ${вариант.key}: не получилось — ${name}`);
    }
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

  const кнопка =
    "flex min-h-[56px] items-center gap-3 rounded-xl border border-line-strong bg-surface-card px-4 py-3 text-left text-[15px] font-medium text-ink active:bg-surface-bubble";

  return (
    <main className="mx-auto min-h-dvh max-w-[520px] bg-surface px-4 py-6">
      <h1 className="text-[22px] font-semibold text-ink">Куда идёт звук</h1>
      <p className="mt-2 text-[15px] leading-normal text-ink-muted">
        Подключите Bluetooth-наушники и нажимайте варианты по очереди. Про
        каждый запомните: сигнал в наушниках или в динамике телефона.
      </p>

      {/* Второй заход: A–F все звучали в наушниках, ищем, чем отличается тренажёр */}
      <div className="mt-5 rounded-xl border border-line bg-surface-card px-4 py-3 text-[14.5px] leading-normal text-ink-body">
        <div className="font-semibold text-ink">Сохранено в этом браузере</div>
        <div className="mt-1">Микрофон: {назвать(saved.input, "audioinput")}</div>
        <div>Динамик: {назвать(saved.output, "audiooutput")}</div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {ВАРИАНТЫ_ТРЕНАЖЁРА.map((вариант) => (
          <button key={вариант.key} type="button" onClick={() => void playTrainer(вариант)} className={кнопка}>
            <span className="font-mono text-[18px] font-semibold text-brand">{вариант.key}</span>
            {вариант.label}
          </button>
        ))}
      </div>

      <p className="mt-4 rounded-xl bg-surface-card px-4 py-3 text-[15px] leading-normal text-ink-body">
        {status}
      </p>

      <button
        type="button"
        onClick={() => {
          stopMic();
          saveInputId(null);
          saveOutputId(null);
          void refreshDevices();
          setStatus("Сохранённые микрофон и динамик забыты: тренажёр возьмёт устройства по умолчанию");
        }}
        className="mt-4 min-h-11 w-full rounded-xl border border-line-strong bg-surface-card px-4 text-[15px] font-semibold text-ink"
      >
        Забыть сохранённые микрофон и динамик
      </button>

      <div className="mt-8 text-[15px] font-semibold text-ink">Первый заход (A–F)</div>
      <div className="mt-3 flex flex-col gap-2.5">
        {ВАРИАНТЫ.map((вариант) => (
          <button key={вариант.key} type="button" onClick={() => void play(вариант)} className={кнопка}>
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

      <div className="mt-5 break-all font-mono text-[12px] leading-relaxed text-ink-subtle">
        {devices.map((d, index) => (
          <div key={index}>
            {d.kind}: {d.label} ({d.id.slice(0, 8) || "без id"})
          </div>
        ))}
      </div>
    </main>
  );
}
