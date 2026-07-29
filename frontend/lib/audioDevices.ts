"use client";

// Выбор микрофона и динамика для голосового разговора.
//
// Появилось после случая, когда Edge молча взял входом линейный вход звуковой
// карты — в него ничего не воткнуто, и разговор шёл в тишину. Умолчание у
// каждого браузера своё, и до этого интерфейс о выборе устройства не сообщал
// вообще ничего.

/** Устройство в списке: id для getUserMedia и подпись для человека. */
export interface AudioDevice {
  id: string;
  label: string;
}

const INPUT_KEY = "podhod:audio-input";
const OUTPUT_KEY = "podhod:audio-output";

/**
 * Умеет ли браузер выбирать динамик. В Chromium — да, в Firefox и на iOS
 * метода нет, и контрол выхода там просто не показываем.
 */
export function canChooseOutput(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof HTMLMediaElement !== "undefined" &&
    typeof HTMLMediaElement.prototype.setSinkId === "function"
  );
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Приватный режим может запрещать хранилище — работаем без запоминания
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // молча: невозможность запомнить выбор не повод ломать разговор
  }
}

export const savedInputId = () => read(INPUT_KEY);
export const saveInputId = (id: string | null) => write(INPUT_KEY, id);
export const savedOutputId = () => read(OUTPUT_KEY);
export const saveOutputId = (id: string | null) => write(OUTPUT_KEY, id);

/**
 * Списки устройств. Подписи приходят пустыми, пока не выдано разрешение
 * на микрофон, — поэтому вызывать стоит уже после getUserMedia.
 */
export async function listDevices(): Promise<{
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return { inputs: [], outputs: [] };
  }

  const all = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind: MediaDeviceKind, fallback: string) =>
    all
      .filter((device) => device.kind === kind)
      .map((device, index) => ({
        id: device.deviceId,
        // Без разрешения подписи пустые — подставляем хоть что-то осмысленное
        label: device.label || `${fallback} ${index + 1}`,
      }));

  return {
    inputs: pick("audioinput", "Микрофон"),
    outputs: canChooseOutput() ? pick("audiooutput", "Динамик") : [],
  };
}

/** Подписка на втыкание и вынимание устройств прямо во время работы. */
export function onDevicesChanged(handler: () => void): () => void {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return () => {};
  }
  navigator.mediaDevices.addEventListener("devicechange", handler);
  return () =>
    navigator.mediaDevices.removeEventListener("devicechange", handler);
}

/** Чем именно кончилась попытка захватить микрофон. */
export type MicErrorKind = "denied" | "missing" | "busy" | "unknown";

export interface MicErrorInfo {
  kind: MicErrorKind;
  /** Заголовок экрана отказа */
  title: string;
  /** Что случилось и что делать — одним абзацем */
  text: string;
  /** Пошаговая инструкция; пусто, когда шагов нет */
  steps: string[];
  /** Подпись главной кнопки: по смыслу она разная */
  retryLabel: string;
  /** Пояснение под кнопками; null — не нужно */
  note: string | null;
}

/**
 * Разбирает отказ микрофона на состояние экрана.
 *
 * Раньше любой сбой выглядел одинаково — общий экран «нет доступа», из
 * которого нельзя было понять, запрет это, занятое устройство или его
 * отсутствие. Причины требуют разных действий, поэтому и экраны разные:
 * при запрете человек идёт в настройки сайта, а при отсутствии устройства
 * разрешать нечего — сначала надо его подключить.
 */
export function describeMicError(error: unknown): MicErrorInfo {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        kind: "denied",
        title: "Микрофон заблокирован",
        text:
          "Браузер не пустил нас к микрофону. Разрешите доступ в настройках " +
          "сайта — без него разговор не начнётся.",
        steps: [
          "Нажмите на значок замка слева от адреса",
          "Включите «Микрофон»",
          "Вернитесь и нажмите «Повторить»",
        ],
        retryLabel: "Повторить",
        note: null,
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return {
        kind: "missing",
        title: "Микрофон не найден",
        text:
          "Система не видит ни одного микрофона. Подключите гарнитуру или " +
          "включите встроенный микрофон в настройках компьютера — и обновите " +
          "список.",
        steps: [],
        retryLabel: "Искать снова",
        note: "Доступ здесь ни при чём — разрешать нечего, пока устройства нет",
      };
    case "NotReadableError":
      return {
        kind: "busy",
        title: "Микрофон занят",
        text:
          "Микрофон занят другой программой — например, Zoom, Teams или " +
          "Skype. Закройте её и попробуйте снова.",
        steps: [],
        retryLabel: "Повторить",
        note: null,
      };
    default:
      return {
        kind: "unknown",
        title: "Не удалось включить микрофон",
        text: "Проверьте устройство и попробуйте снова.",
        steps: [],
        retryLabel: "Повторить",
        note: null,
      };
  }
}
