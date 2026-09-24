"use client";

// Экран звонка — главный экран продукта.
// Одна спокойная колонка по центру: максимум внимания к тому, кто сейчас
// на линии. Управляет сессией через REST API и WebSocket, захватывает
// микрофон (PCM 16 кГц) и воспроизводит голосовой ответ ИИ.
//
// Состояния: до старта · соединение · разговор (говорит клиент / слушаю вас)
// · пауза · нет доступа к микрофону · завершение.

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AudioDevicePicker from "@/app/components/AudioDevicePicker";
import BackLink from "@/app/components/BackLink";
import CallAvatar from "@/app/components/CallAvatar";
import CaseServiceBlock from "@/app/components/CaseServiceBlock";
import CaseServiceToggle from "@/app/components/CaseServiceToggle";
import DiagnosticsDocument from "@/app/components/DiagnosticsDocument";
import { useIndustry, useWords } from "@/app/components/IndustryProvider";
import Logo from "@/app/components/Logo";
import PatientAvatar from "@/app/components/PatientAvatar";
import SpeakerPill from "@/app/components/SpeakerPill";
import Timer from "@/app/components/Timer";
import type { CaseService } from "@/lib/caseService";
import { AudioPlayer, MicRecorder, primeAudioElement } from "@/lib/voiceClient";
import {
  listDevices,
  describeMicError,
  наAndroid,
  onDevicesChanged,
  saveInputId,
  saveOutputId,
  savedInputId,
  savedOutputId,
  type AudioDevice,
  type MicErrorInfo,
} from "@/lib/audioDevices";

// Порог голоса — тот же, что на бэкенде (_MIN_VOICE_RMS в services/stt.py)
const VOICE_RMS = 500;

// Порог «хоть какой-то сигнал». Живой микрофон даже в тихой комнате даёт
// шум в несколько десятков; ровный ноль — это отключённый вход.
const SIGNAL_RMS = 15;

// Два разных случая, и спешить в них нужно по-разному.
// Полная тишина — устройство мертво, ошибиться тут почти невозможно.
const NO_SIGNAL_MS = 5_000;
// Сигнал есть, но до голоса не дотягивает — микрофон работает, просто тихо.
// Тут спешить нельзя: человек мог просто задуматься.
const TOO_QUIET_MS = 20_000;

type MicAlert = "no-signal" | "too-quiet" | null;

type ScreenState =
  | "idle"
  | "check"
  | "connecting"
  | "active"
  | "paused"
  | "micError"
  | "completing";

// Сколько молчания на экране проверки, прежде чем объяснить, что вход глухой.
// Раньше объяснение стояло состоянием по умолчанию — человек читал упрёк
// до того, как успевал открыть рот.
const CHECK_SILENCE_MS = 6_000;

interface Patient {
  id: string;
  name: string;
  description: string | null;
  anamnesis: string | null;
}

// Упражнение, а не полный разговор. Приходит в ответе на «Начать»
interface Drill {
  title: string;
  // Кнопка «Показать услугу» — в упражнениях с середины разговора
  showsService: boolean;
  // null — «услуга не подобрана»
  service: CaseService | null;
}

// Как часто спрашиваем плеер, звучит ли ответ ИИ. Четверти секунды хватает,
// чтобы индикатор переключался незаметно для глаза и не грузил страницу.
const SPEAKER_POLL_MS = 250;

// Сколько ждём открывающую реплику пациента, прежде чем перестать показывать
// «говорит клиент». Обычная задержка — полторы-две секунды (модель плюс
// синтез); восемь с запасом покрывают повтор у провайдера, а дальше честнее
// вернуть экран в «слушаю вас», чем держать менеджера в неведении.
const PATIENT_OPENS_TIMEOUT_MS = 8000;

// useSearchParams требует границы Suspense, иначе страница не соберётся
// статически. Сам экран — во вложенном компоненте.
export default function SessionPage() {
  return (
    <Suspense>
      <SessionScreen />
    </Suspense>
  );
}

function SessionScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const слова = useWords();
  // Сценки диагностики нет у неклиник: покупатель квартиры «к врачу
  // не ходит», и документ для него не собирается (см. sessions/start)
  const естьДиагностика = useIndustry() === "медицина";
  // Параметры из мастера настройки. Их может не быть: на /session можно
  // зайти напрямую — тогда работает прежний путь с активным пациентом.
  const chosenPatientId = searchParams.get("patient");
  const chosenType = searchParams.get("type");
  // Полный разговор: тип «full» из мастера либо прямой заход без типа
  // (сессии до мастера — полные, backend считает так же через COALESCE).
  // Только в нём есть сценка диагностики и кнопка результата
  const fullConversation = !chosenType || chosenType === "full";
  // Задание, по которому запущен разговор: закроется при завершении
  const assignmentId = searchParams.get("assignment");

  const [screenState, setScreenState] = useState<ScreenState>("idle");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // Услуга к документу: приходит тем же событием. null — «не подобрана»
  const [diagnosticsService, setDiagnosticsService] = useState<CaseService | null>(null);
  // Результат диагностики: null — не показан, строка — документ на экране.
  // waiting — кнопка нажата, ждём ответа сервера (или повтор при pending)
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [diagnosticsWaiting, setDiagnosticsWaiting] = useState(false);
  // Телефон: документ диагностики — лист снизу, его можно свернуть обратно
  // в кнопку и развернуть снова. На компьютере карточка стоит в колонке
  // и не сворачивается
  const [листДиагностики, setЛистДиагностики] = useState(true);
  // Название упражнения и услуга к нему; у полного разговора null
  const [drill, setDrill] = useState<Drill | null>(null);
  // Звучит ли сейчас ответ ИИ — от этого зависит индикатор и вид аватара
  const [aiSpeaking, setAiSpeaking] = useState(false);
  // Та же величина ссылкой: сторож тишины опрашивает её из интервала,
  // и пересоздавать интервал на каждое переключение речи незачем
  const aiSpeakingRef = useRef(false);
  // Пациент заговорит первым — сервер предупреждает об этом до того, как
  // пойдёт звук. Полторы-две секунды между предупреждением и первым чанком
  // экран обязан показывать «говорит клиент», иначе он зовёт менеджера
  // говорить ровно тогда, когда начинает пациент
  const patientOpensRef = useRef(false);

  // Ссылки на активные ресурсы разговора
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  // --- Аудио-устройства -----------------------------------------------------
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [inputId, setInputId] = useState<string | null>(savedInputId());
  const [outputId, setOutputId] = useState<string | null>(savedOutputId());
  const [micError, setMicError] = useState<MicErrorInfo | null>(null);
  // Громкость последнего блока и момент, когда в неё последний раз попал голос
  const [level, setLevel] = useState(0);
  const lastVoiceAtRef = useRef(Date.now());
  const lastSoundAtRef = useRef(Date.now());
  const [micAlert, setMicAlert] = useState<MicAlert>(null);
  /**
   * Микрофон уже перешагивал порог голоса на этом экране.
   *
   * Пока не перешагнул, «Начать разговор» неактивна. Ждать дешевле, чем
   * разговор вхолостую: именно так у нас прошёл звонок через линейный вход
   * звуковой карты — браузер выбрал его по умолчанию, а интерфейс молчал.
   *
   * Сбрасывается при смене устройства: новый вход надо доказывать заново.
   */
  const [micProven, setMicProven] = useState(false);
  /**
   * Молчание на экране проверки затянулось — пора объяснить, что вход глухой.
   *
   * Отдельно от micProven: у плашки три состояния, а не два. Пока человек
   * не начал говорить, она молчит и ждёт; упрёк «этот вход почти не слышит»
   * появляется, только когда ждать уже нечего.
   */
  const [checkSilent, setCheckSilent] = useState(false);
  // На проверке звука от микрофона не пришло ни звука — не тихо, а ноль.
  // На Android это почти всегда запрет у самого Chrome (см. наAndroid)
  const [checkDead, setCheckDead] = useState(false);
  // Узнаём в эффекте, а не при рендере: сервер про устройство не знает,
  // и разметка первого кадра должна совпасть
  const [android, setAndroid] = useState(false);
  // Инструкцию для Android можно свернуть: на узком экране она длинная,
  // а прочитав, человек уходит в настройки и возвращается уже за кнопкой
  const [инструкцияОткрыта, setИнструкцияОткрыта] = useState(true);
  // «Повторить» на шаге проверки: заново запросить микрофон, не уходя
  // с экрана, — после того как человек поправил разрешение в настройках
  const [попыткаПроверки, setПопыткаПроверки] = useState(0);
  useEffect(() => setAndroid(наAndroid()), []);
  // Проверочный захват на экране до разговора
  const previewRef = useRef<MicRecorder | null>(null);

  const noteLevel = useCallback((rms: number) => {
    setLevel(rms);
    const now = Date.now();
    // Сигнал и голос отмечаем раздельно: по их сочетанию сторож различает
    // мёртвое устройство и просто тихий микрофон
    if (rms >= SIGNAL_RMS) lastSoundAtRef.current = now;
    if (rms >= VOICE_RMS) {
      lastVoiceAtRef.current = now;
      setMicAlert(null);
      // Микрофон доказал, что он живой. Флаг залипающий: человек сказал
      // «раз-два», замолчал — и кнопка не должна снова гаснуть
      setMicProven(true);
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const { inputs: ins, outputs: outs } = await listDevices();
    setInputs(ins);
    setOutputs(outs);
  }, []);

  // Пациент, с которым пойдёт разговор: либо выбранный в мастере,
  // либо первый активный при прямом заходе на страницу
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (chosenPatientId) {
          const res = await fetch("/api/patients");
          if (!res.ok) return;
          const list = (await res.json()) as Patient[];
          const found = list.find((item) => item.id === chosenPatientId);
          if (found && !cancelled) {
            setPatient(found);
            return;
          }
        }
        const res = await fetch("/api/patients/active");
        if (!res.ok) return;
        const data = (await res.json()) as Patient;
        if (!cancelled) setPatient(data);
      } catch {
        // молча: без карточки пациента разговор всё равно можно начать
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chosenPatientId]);

  // Проверочный захват — на шаге проверки звука, а не при открытии страницы.
  // Так разрешение у браузера спрашивается по нажатию кнопки, а не молча
  // на входе, и именно здесь вскрывается случай, когда браузер выбрал не тот
  // вход: человек видит, какое устройство его слушает и слышат ли его.
  useEffect(() => {
    if (screenState !== "check") return;

    let cancelled = false;
    const recorder = new MicRecorder();

    (async () => {
      try {
        await recorder.start(() => {}, {
          deviceId: savedInputId(),
          onLevel: (rms) => {
            if (!cancelled) noteLevel(rms);
          },
          // Сохранённого устройства больше нет — забываем его, чтобы
          // не спотыкаться о него при каждом заходе
          onDeviceMissing: () => {
            saveInputId(null);
            setInputId(null);
          },
        });
        if (cancelled) {
          await recorder.stop();
          return;
        }
        previewRef.current = recorder;
        setMicError(null);
        // Подписи устройств появляются только после выданного разрешения
        await refreshDevices();
      } catch (error) {
        if (!cancelled) setMicError(describeMicError(error));
      }
    })();

    return () => {
      cancelled = true;
      // Останавливаем именно текущий захват: смена микрофона заменяет его
      // на новый, и остановка исходного оставила бы устройство занятым
      const active = previewRef.current ?? recorder;
      previewRef.current = null;
      void active.stop();
    };
  }, [screenState, noteLevel, refreshDevices, попыткаПроверки]);

  // Устройства втыкают и вынимают прямо во время работы
  useEffect(() => onDevicesChanged(() => void refreshDevices()), [refreshDevices]);

  // Свой отсчёт на экране проверки: молчим — и через несколько секунд
  // объясняем, почему полоса не двигается. До этого плашка ничего не требует
  useEffect(() => {
    if (screenState !== "check" || micProven) {
      setCheckSilent(false);
      setCheckDead(false);
      return;
    }
    const id = setTimeout(() => {
      setCheckSilent(true);
      // Звука не было ни разу за всё время проверки — не тихий вход, а ноль
      setCheckDead(Date.now() - lastSoundAtRef.current >= CHECK_SILENCE_MS);
    }, CHECK_SILENCE_MS);
    return () => clearTimeout(id);
  }, [screenState, micProven, inputId]);

  // Сторож тишины: если микрофон долго не слышит ничего, человек об этом
  // узнает сразу, а не через десять минут разговора с пустотой
  useEffect(() => {
    if (screenState !== "active") {
      setMicAlert(null);
      return;
    }
    lastVoiceAtRef.current = Date.now();
    lastSoundAtRef.current = Date.now();

    const id = setInterval(() => {
      const now = Date.now();
      // Пока говорит ИИ, менеджер молчит по делу — иначе плашка вылезала бы
      // на длинном ответе
      if (aiSpeakingRef.current) {
        lastVoiceAtRef.current = now;
        lastSoundAtRef.current = now;
        return;
      }
      if (now - lastSoundAtRef.current > NO_SIGNAL_MS) {
        setMicAlert("no-signal");
      } else if (now - lastVoiceAtRef.current > TOO_QUIET_MS) {
        setMicAlert("too-quiet");
      } else {
        setMicAlert(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [screenState]);

  // Таймер идёт во время разговора; на паузе замирает, но не сбрасывается
  useEffect(() => {
    if (screenState !== "active") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [screenState]);

  // Опрашиваем плеер: говорит ИИ или ждёт нас
  useEffect(() => {
    if (screenState !== "active") {
      setAiSpeaking(false);
      aiSpeakingRef.current = false;
      return;
    }
    const id = setInterval(() => {
      // Пациент собирается заговорить первым — держим «говорит клиент»,
      // пока не пошёл звук. Иначе экран просит менеджера говорить ровно
      // в ту секунду, когда начинает пациент, и первое же слово его перебьёт
      const speaking =
        (playerRef.current?.isPlaying() ?? false) || patientOpensRef.current;
      setAiSpeaking(speaking);
      aiSpeakingRef.current = speaking;
    }, SPEAKER_POLL_MS);
    return () => clearInterval(id);
  }, [screenState]);

  // Пациент вот-вот заговорит первым: держим на экране «говорит клиент»,
  // пока не пошёл звук. Иначе менеджер видит «Слушаю вас» и начинает
  // говорить ровно тогда, когда начинает пациент, — и перебивает его.
  //
  // Страховка по времени обязательна: если реплика так и не зазвучала
  // (модель молчит, сеть отвалилась), экран не должен ждать её вечно.
  const ждёмОткрывающуюРеплику = useCallback(() => {
    patientOpensRef.current = true;
    setAiSpeaking(true);
    aiSpeakingRef.current = true;
    setTimeout(() => {
      patientOpensRef.current = false;
    }, PATIENT_OPENS_TIMEOUT_MS);
  }, []);

  // Полная очистка ресурсов разговора (микрофон, воспроизведение, сокет)
  const teardown = useCallback(() => {
    void recorderRef.current?.stop();
    recorderRef.current = null;
    playerRef.current?.reset();
    playerRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  // Закрываем всё при уходе со страницы
  useEffect(() => teardown, [teardown]);

  // Безопасная отправка сообщения в WebSocket (если соединение открыто)
  function sendWs(message: Record<string, unknown>) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // «Начать тренировку»: создаём сессию, подключаем WebSocket, микрофон и плеер
  async function handleStart() {
    // Строго до первого await: на iPhone звук разрешается только элементу,
    // проигранному в обработчике нажатия. На компьютере — null
    const primed = primeAudioElement();
    setBusy(true);
    setErrorMsg("");
    setScreenState("connecting");
    try {
      const res = await fetch("/api/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: chosenPatientId ?? undefined,
          trainingType: chosenType ?? undefined,
          assignmentId: assignmentId ?? undefined,
        }),
      });
      if (!res.ok) {
        if (res.status === 401) router.push("/login");
        // 400 — выбранный пациент или тип недоступен, или у организации нет
        // случая этого клиента: причину называет сервер, показываем её
        if (res.status === 400) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          setErrorMsg(body?.error ?? "Этот вариант тренировки пока недоступен");
        }
        // 402 — часы кончились или демо истекло: сервер прислал текст,
        // молчаливый возврат в idle выглядел бы поломкой
        if (res.status === 402) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          setErrorMsg(body?.error ?? "Разговоры сейчас недоступны");
        }
        setScreenState("idle");
        return;
      }
      const {
        sessionId: id,
        wsUrl,
        opensDialog,
        drill: drillInfo,
      } = (await res.json()) as {
        sessionId: string;
        wsUrl: string;
        opensDialog?: boolean;
        drill?: Drill | null;
      };
      setDrill(drillInfo ?? null);

      // Пациент заговорит первым — экран обязан сказать это сразу по нажатию
      // кнопки. Сокет открывается, поднимает распознавание и синтез, и только
      // потом бэкенд успевает предупредить: те самые полторы секунды, в которые
      // менеджер видел «Слушаю вас» и мог заговорить поверх пациента
      if (opensDialog) ждёмОткрывающуюРеплику();

      // Одноразовый ws-токен (основной JWT в httpOnly cookie недоступен из JS)
      const tokenRes = await fetch("/api/auth/ws-token");
      if (!tokenRes.ok) {
        if (tokenRes.status === 401) router.push("/login");
        if (tokenRes.status === 402) {
          const body = (await tokenRes.json().catch(() => null)) as
            | { error?: string }
            | null;
          setErrorMsg(body?.error ?? "Разговоры сейчас недоступны");
        } else {
          setErrorMsg("Не удалось авторизовать голосовое соединение");
        }
        setScreenState("idle");
        return;
      }
      const { wsToken } = (await tokenRes.json()) as { wsToken: string };

      setSessionId(id);
      setSeconds(0);

      // Готовим плеер для голосовых ответов ИИ
      // Диагностика плеера уходит в тот же серверный лог, что и тайминги
      // ходов: клиентский сбой воспроизведения иначе неотличим от серверного
      playerRef.current = new AudioPlayer(
        (data) => sendWs({ type: "client_audio", ...data }),
        primed
      );
      playerRef.current.setOutputDevice(outputId);

      // Проверочный захват больше не нужен — освобождаем устройство,
      // иначе на разговор пойдёт второй параллельный захват
      if (previewRef.current) {
        await previewRef.current.stop();
        previewRef.current = null;
      }

      // Открываем WebSocket с ws-токеном в query
      const url = `${wsUrl}?token=${encodeURIComponent(wsToken)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      // При открытии соединения запрашиваем микрофон и переходим в разговор
      ws.onopen = async () => {
        try {
          const recorder = new MicRecorder();
          recorderRef.current = recorder;
          await recorder.start(
            (base64) => sendWs({ type: "audio_chunk", data: base64 }),
            {
              deviceId: inputId,
              onLevel: noteLevel,
              onDeviceMissing: () => {
                saveInputId(null);
                setInputId(null);
              },
            }
          );
          setScreenState("active");
        } catch (error) {
          // Без микрофона разговор невозможен — показываем причину отказа,
          // а не общий экран, из которого ничего не понять
          setMicError(describeMicError(error));
          setScreenState("micError");
        }
      };

      // Роутинг входящих сообщений сервера
      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          switch (msg.type) {
            case "patient_opens":
              // Подтверждение с сервера. Обычно экран уже ждёт открывающую
              // реплику — флаг пришёл в ответе на «Начать разговор», — но
              // при переподключении к живой сессии это единственный сигнал
              ждёмОткрывающуюРеплику();
              break;
            case "audio_chunk":
              // Звук пошёл — дальше состояние считает плеер, как обычно
              patientOpensRef.current = false;
              playerRef.current?.pushChunk(msg.data);
              break;
            case "audio_end":
              playerRef.current?.endUtterance();
              break;
            case "barge_in":
              // Подтверждение сервера: хвост отменённого ответа уже не придёт
              playerRef.current?.confirmInterrupt();
              break;
            case "error":
              patientOpensRef.current = false;
              setErrorMsg(msg.message || "Ошибка сервера");
              break;
            case "diagnostics_result":
              // Документ готов: карточка остаётся до конца разговора
              setDiagnostics(String(msg.text || ""));
              setDiagnosticsService(
                msg.service && typeof msg.service.name === "string"
                  ? { name: msg.service.name, price: String(msg.service.price ?? "") }
                  : null
              );
              setDiagnosticsWaiting(false);
              break;
            case "diagnostics_pending":
              // Генерация ещё идёт (стартовала на «Начать») — повторяем сами,
              // менеджеру достаточно «готовим…» на кнопке
              setTimeout(() => sendWs({ type: "diagnostics" }), 2500);
              break;
            case "session_ended":
              break;
            // transcript_user / transcript_ai на экране не показываем —
            // полный текст доступен на странице расшифровки после разговора
            default:
              break;
          }
        } catch {
          // некорректное сообщение — игнорируем
        }
      };

      ws.onerror = () => {
        console.warn("Ошибка WebSocket-соединения");
      };

      // Сервер сам закрывает сокет только после нашего «стоп» — а своё
      // закрытие handleStop снимает сокет из ref раньше, чем придёт это
      // событие. Всё прочее — настоящий обрыв: пропала сеть, телефон усыпил
      // вкладку. Раньше экран в этом случае продолжал «идти» и молчал
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        setErrorMsg(
          "Связь с тренажёром прервалась. Завершите разговор — всё сказанное сохранится в расшифровке."
        );
      };
    } finally {
      setBusy(false);
    }
  }

  // «Пауза»: перестаём слать аудио и сообщаем серверу
  function handlePause() {
    recorderRef.current?.pause();
    sendWs({ type: "pause" });
    setScreenState("paused");
  }

  // «Продолжить»: возобновляем отправку аудио
  function handleResume() {
    recorderRef.current?.resume();
    sendWs({ type: "resume" });
    setScreenState("active");
  }

  // «Завершить разговор»: стоп по WS, освобождение ресурсов, переход к расшифровке
  function handleDiagnostics() {
    // Сценку менеджер уже отыграл голосом — кнопка только выдаёт документ.
    // Ответ придёт событием diagnostics_result (или pending с авто-повтором)
    setDiagnosticsWaiting(true);
    sendWs({ type: "diagnostics" });
  }

  async function handleStop() {
    setBusy(true);
    setScreenState("completing");
    try {
      sendWs({ type: "stop" });
      await recorderRef.current?.stop();
      recorderRef.current = null;
      playerRef.current?.reset();
      playerRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;

      if (sessionId) {
        await fetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
        // replace, а не push: разговор уже завершён, и возвращаться на этот
        // экран бессмысленно — он поднялся бы в исходном состоянии и предложил
        // начать заново, создав новый разговор. «Назад» с расшифровки должно
        // уводить туда, откуда пришли запускать тренировку.
        router.replace(`/transcript/${sessionId}`);
      } else {
        setScreenState("idle");
      }
    } finally {
      setBusy(false);
    }
  }


  /**
   * Смена микрофона. До разговора переоткрываем проверочный захват,
   * во время — только захват, не трогая ни WebSocket, ни саму сессию:
   * человек не должен терять разговор из-за не того устройства.
   */
  const changeInput = useCallback(
    async (id: string) => {
      saveInputId(id);
      setInputId(id);
      setLevel(0);
      lastVoiceAtRef.current = Date.now();
      lastSoundAtRef.current = Date.now();
      setMicAlert(null);
      // Новый вход надо доказать заново: он может оказаться таким же
      // глухим, как прежний
      setMicProven(false);

      const restart = async (recorder: MicRecorder | null, live: boolean) => {
        if (!recorder) return;
        await recorder.stop();
        const next = new MicRecorder();
        await next.start(
          live
            ? (base64) => sendWs({ type: "audio_chunk", data: base64 })
            : () => {},
          { deviceId: id, onLevel: noteLevel }
        );
        if (live) recorderRef.current = next;
        else previewRef.current = next;
      };

      try {
        if (screenState === "active" || screenState === "paused") {
          await restart(recorderRef.current, true);
        } else {
          await restart(previewRef.current, false);
        }
        setMicError(null);
      } catch (error) {
        setMicError(describeMicError(error));
      }
    },
    [screenState, noteLevel]
  );

  const changeOutput = useCallback((id: string) => {
    saveOutputId(id);
    setOutputId(id);
    playerRef.current?.setOutputDevice(id);
  }, []);

  const inCall = screenState === "active" || screenState === "paused";

  // Пока идёт разговор, экран не гаснет: телефон, погасивший экран, усыпляет
  // вкладку, и разговор обрывается. Блокировка снимается системой, когда
  // вкладку сворачивают, — берём её заново, когда вкладка снова на виду.
  // На компьютере то же самое: не уходить в сон посреди звонка
  useEffect(() => {
    if (!inCall || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const take = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        // Отказали (режим энергосбережения) — разговор идёт и так
      }
    };
    void take();
    const onVisible = () => void take();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [inCall]);
  // Уйти со страницы можно, пока разговор не начался. Проверка звука сюда
  // тоже входит: с неё есть своя «Назад», но и общий выход должен работать
  const canLeave =
    screenState === "idle" ||
    screenState === "check" ||
    screenState === "micError";

  return (
    <main className="flex h-screen flex-col bg-surface-card max-md:h-dvh">
      {/* Топбар: логотип и «Назад», справа — таймер во время разговора.
          Высота и отступы те же, что в AppShell: экран разговора выпадает
          из общей оболочки, но выглядеть должен её продолжением. */}
      <header className="flex h-[66px] shrink-0 items-center justify-between border-b border-line bg-surface-card px-7 max-md:h-14 max-md:px-5">
        <div className="flex items-center gap-3.5">
          <Link href="/" title="На главную" className="shrink-0 max-md:inline-flex max-md:min-h-11 max-md:items-center">
            <Logo size="sm" />
          </Link>
          {/* Уйти можно только до начала разговора: во время него переход
              оборвал бы живую сессию, поэтому ссылки там нет */}
          {canLeave && (
            <>
              <span className="h-5 w-px bg-line max-md:hidden" aria-hidden="true" />
              <BackLink className="max-md:hidden" />
            </>
          )}
        </div>

        {/* На телефоне «Назад» справа, как в макете: слева только логотип */}
        {canLeave && (
          <BackLink className="inline-flex min-h-11 items-center px-1 text-[15px] md:hidden" />
        )}

        {inCall && <Timer seconds={seconds} paused={screenState === "paused"} size="lg" />}

        {screenState === "completing" && (
          <span className="font-mono text-[16.5px] text-ink-subtle">
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")}
          </span>
        )}
      </header>

      {/* min-h-0 — чтобы колонка ужималась в высоту экрана, а не вылезала
          из main: иначе с открытой карточкой диагностики кнопки уезжали
          под низ, и страница начинала скроллить. Ужимается только документ
          внутри карточки; если экран ниже ~760 px и не помещаются даже
          аватар с кнопками — прокручивается сама колонка (overflow-y-auto),
          а «safe center» не даёт ей обрезать верх при переполнении */}
      {/* Обёртка — опора для листа диагностики на телефоне. На компьютере
          её геометрия та же, что была у колонки */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-10 py-10 [justify-content:safe_center] max-md:px-4 max-md:py-6">
        {/* --- До старта --- */}
        {screenState === "idle" && (
          <>
            <CallAvatar name={patient?.name ?? null} state="idle" />
            <div className="mt-[18px] text-center text-[23.5px] font-semibold text-ink max-md:text-[22px]">
              {patient?.name ?? слова.Клиент}
            </div>
            {patient?.description && (
              <div className="mt-1 text-sm text-ink-muted">
                {patient.description}
              </div>
            )}

            {/* Высота ограничена, длинный анамнез прокручивается ВНУТРИ
                карточки. Без потолка карточка росла вниз вместе с текстом
                и уносила за экран кнопку «Начать тренировку»: у самого
                длинного анамнеза 2242 знака при медиане 929, и на нём
                кнопки просто не видно. Потолок в долях экрана, а не в
                пикселях, — единственное место, где доля уместна: размер
                диктует экран, а не содержимое. Короткий анамнез в потолок
                не упирается и карточку не растягивает.

                50vh, а не больше: замерено на 1440×800, 1440×900 и 1920×1080 —
                при 56vh на самом низком экране кнопка снова уезжает, при 42vh
                прокручивается даже средний анамнез (медиана 929 знаков) */}
            {patient?.anamnesis && (
              <div className="mt-[22px] flex max-h-[50vh] w-full max-w-[440px] flex-col rounded-xl border border-line bg-surface px-[18px] py-4">
                <div className="mb-1.5 shrink-0 text-[12.5px] font-semibold uppercase tracking-[.08em] text-ink-subtle">
                  {слова.Заявка}
                </div>
                <div className="min-h-0 overflow-y-auto text-sm leading-normal text-ink-label">
                  {patient.anamnesis}
                </div>
              </div>
            )}

            {/* С карточки уходим на проверку звука, а не сразу в разговор.
                Проверка — отдельный шаг: здесь и так карточка пациента
                с анамнезом, и вдвоём они не помещались в экран */}
            <button
              type="button"
              onClick={() => setScreenState("check")}
              className="mt-6 inline-flex items-center gap-2.5 rounded-input bg-brand px-[30px] py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-hover max-md:hidden"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-white" />
              Начать тренировку
            </button>
            <p className="mt-3 text-[14px] text-ink-placeholder max-md:hidden">
              Понадобится доступ к микрофону
            </p>
          </>
        )}

        {/* --- Проверка звука: отдельный шаг между карточкой и разговором --- */}
        {screenState === "check" && (
          <>
            <div className="text-[22.5px] font-semibold text-ink max-md:self-stretch max-md:text-[22px]">
              Проверим, что вас слышно
            </div>
            <p className="mt-2 max-w-[420px] text-pretty text-center text-[16px] leading-normal text-ink-muted max-md:self-stretch max-md:text-left max-md:text-[15px]">
              Скажите вслух пару слов. Полоса должна перешагивать засечку —
              тогда разговор пойдёт как надо.
            </p>

            <div className="mt-6 w-full max-w-[440px] rounded-xl border border-line bg-surface px-[18px] py-[18px]">
              <AudioDevicePicker
                inputs={inputs}
                inputId={inputId}
                onInputChange={changeInput}
                outputs={outputs}
                outputId={outputId}
                onOutputChange={changeOutput}
                level={level}
                status={
                  micError
                    ? "off"
                    : micProven
                    ? "heard"
                    : checkSilent
                      ? android && checkDead && !micError
                        ? "no-signal"
                        : "silent"
                      : "waiting"
                }
                onRefresh={() => void refreshDevices()}
              />
              {micError && (
                <p className="mt-3 text-[14px] leading-normal text-danger-text">
                  {micError.text}
                </p>
              )}
              {/* Шаги — прямо здесь: до 24.09 на шаге проверки была только
                  строка причины, а шаги жили на экране отказа, куда попадают
                  лишь по «Начать» */}
              {micError && micError.steps.length > 0 && (
                <ol className="mt-2 list-inside list-decimal text-[14px] leading-relaxed text-ink-label">
                  {micError.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {micError && (
                <button
                  type="button"
                  onClick={() => {
                    setMicError(null);
                    setПопыткаПроверки((n) => n + 1);
                  }}
                  className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-line-strong bg-surface-card px-4 text-[15px] font-semibold text-ink"
                >
                  {micError.retryLabel}
                </button>
              )}
            </div>

            {/* Android: микрофон виден, а звука ноль — значит, телефон не
                пускает к нему сам Chrome. Разрешение сайту тут не поможет,
                нужно разрешение приложению в настройках телефона. Упрётся
                в это любой, кто когда-то нажал «Не разрешать» */}
            {!micProven && checkSilent && checkDead && android && !micError && (
              <div className="mt-4 w-full max-w-[440px] rounded-xl border border-warn-border bg-warn-surface px-[18px] py-2 text-left">
                <button
                  type="button"
                  onClick={() => setИнструкцияОткрыта((было) => !было)}
                  aria-expanded={инструкцияОткрыта}
                  className="flex min-h-11 w-full items-center gap-2 text-left text-[15px] font-semibold text-warn"
                >
                  <span className="flex-1">Дайте Chrome доступ к микрофону телефона</span>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`shrink-0 transition-transform ${инструкцияОткрыта ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {инструкцияОткрыта && (
                <div className="pb-2">
                <p className="text-[14.5px] leading-normal text-ink-body">
                  Сайт видит микрофон, но слышит тишину: у самого Chrome нет
                  разрешения на микрофон. То же бывает, если Chrome раз за разом
                  показывает окно с кнопкой «Продолжить».
                </p>
                <ol className="mt-2.5 list-inside list-decimal text-[14.5px] leading-relaxed text-ink-body">
                  <li>
                    Откройте настройки телефона → «Приложения» → «Chrome» →
                    «Разрешения» → «Микрофон»
                  </li>
                  <li>Выберите «Разрешить только во время использования приложения»</li>
                  <li>
                    Проверьте в шторке плитку «Доступ к микрофону» — она должна
                    быть включена
                  </li>
                  <li>Вернитесь сюда и обновите страницу</li>
                </ol>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-line-strong bg-surface-card px-4 text-[15px] font-semibold text-ink"
                >
                  Обновить страницу
                </button>
                </div>
                )}
              </div>
            )}

            <div className="mt-6 flex items-center gap-3 max-md:hidden">
              {/* Блокируем только когда микрофон работает, но молчит:
                  это и есть случай линейного входа. При запрете доступа
                  или отсутствии устройства уровень измерить нечем, порог
                  не перешагнётся никогда — и блокировка заперла бы человека
                  на экране без объяснения и без выхода. Там кнопка ведёт
                  на экран отказа с инструкцией */}
              {/* Просто «Начать», без точки: точка стоит на «Начать
                  тренировку» шагом раньше, и повторять её здесь — значит
                  предлагать одно и то же действие дважды */}
              <button
                type="button"
                onClick={handleStart}
                disabled={busy || (!micProven && !micError)}
                className="rounded-input bg-brand px-[30px] py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-disabled"
              >
                Начать
              </button>
              <button
                type="button"
                onClick={() => setScreenState("idle")}
                className="rounded-input border border-line-strong bg-surface-card px-6 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-surface"
              >
                Назад
              </button>
            </div>

            <p className="mt-3 text-[13.5px] text-ink-placeholder max-md:hidden">
              Выбор устройств запомним для следующих разговоров
            </p>
          </>
        )}

        {/* --- Соединение --- */}
        {screenState === "connecting" && (
          <>
            <div className="relative flex h-[120px] w-[120px] items-center justify-center">
              <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand" />
              <div className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-brand-soft text-[35px] font-semibold text-brand opacity-70">
                {patient?.name ? patient.name.slice(0, 1) : "—"}
              </div>
            </div>
            <div className="mt-5 text-xl font-semibold text-ink">Подключаемся…</div>
            <div className="mt-5 flex w-full max-w-[440px] items-start gap-3 rounded-xl border border-[#BCD8D3] bg-brand-soft px-4 py-3.5">
              <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-brand text-[14.5px] text-white">
                🎙
              </span>
              <div className="text-[15px] leading-snug text-brand-hover">
                Разрешите доступ к микрофону в окне браузера, чтобы начать
                разговор.
              </div>
            </div>
          </>
        )}

        {/* --- Разговор и пауза --- */}
        {inCall && (
          <>
            <CallAvatar
              name={patient?.name ?? null}
              // Пока документ на экране, аватар сжимается: менеджер уже
              // не смотрит на портрет, он читает — карточке нужно место
              size={diagnostics ? "md" : "lg"}
              state={
                screenState === "paused"
                  ? "paused"
                  : aiSpeaking
                    ? "speaking"
                    : "listening"
              }
            />
            <div className="mt-[30px] text-center text-[31px] font-semibold text-ink max-md:mt-5 max-md:text-[24px]">
              {patient?.name ?? слова.Клиент}
            </div>
            {/* Название упражнения — моноширинной подписью, а не обычным
                серым набором. Обычным оно читалось бы второй строкой
                о пациенте, как «62 года · диагностика зрения» до старта,
                и сошло бы за причину визита. Без описания задачи: только
                название, чтобы не спорить с тем, кто на линии */}
            {drill && (
              <div className="mt-[11px] font-mono text-[13.5px] font-medium uppercase tracking-[.12em] text-ink-muted">
                {drill.title}
              </div>
            )}
            <div className={drill ? "mt-3.5" : "mt-3"}>
              <SpeakerPill
                size="lg"
                state={
                  screenState === "paused"
                    ? "paused"
                    : aiSpeaking
                      ? "speaking"
                      : "listening"
                }
              />
            </div>

            {/* Разговор идёт и выглядит рабочим, а микрофон молчит. Без этой
                плашки человек узнавал бы о проблеме через десять минут */}
            {micAlert && (
              <div className="mt-6 w-full max-w-[440px] rounded-xl border border-warn-border bg-warn-surface px-[18px] py-4">
                <div className="text-sm font-semibold text-warn">
                  {micAlert === "no-signal"
                    ? "Микрофон не даёт сигнала"
                    : "Вас плохо слышно"}
                </div>
                <p className="mt-1 text-[14.5px] leading-normal text-ink-body">
                  {micAlert === "no-signal"
                    ? "Похоже, выбрано не то устройство: звука нет совсем. Переключите микрофон — разговор не прервётся."
                    : "Звук есть, но слишком тихий для распознавания. Говорите громче, придвиньтесь к микрофону или прибавьте его громкость в настройках системы."}
                </p>
                {/* Список нужен только когда устройство молчит: при тихом
                    сигнале менять его незачем, дело в громкости */}
                {micAlert === "no-signal" && (
                  <div className="mt-3.5">
                    <AudioDevicePicker
                      compact
                      inputs={inputs}
                      inputId={inputId}
                      onInputChange={changeInput}
                      outputs={[]}
                      outputId={outputId}
                      onOutputChange={changeOutput}
                      level={level}
                      status={level >= VOICE_RMS ? "heard" : "waiting"}
                    />
                  </div>
                )}
              </div>
            )}

            {errorMsg && (
              <p className="mt-4 max-w-[440px] text-center text-sm text-danger-text">
                {errorMsg}
              </p>
            )}

            {/* Документ диагностики. Карточка, а не модалка: менеджер читает
                её между репликами, не теряя аватар и таймер. Появившись,
                остаётся до конца разговора */}
            {diagnostics && (
              // Карточка держит размер содержимого; в высоту экрана она
              // вписывается тем, что документ внутри ограничен остатком
              // экрана и прокручивается сам (см. его класс ниже)
              <div className="mt-6 flex w-full max-w-[440px] flex-col rounded-xl border border-line bg-surface-card px-[18px] py-4 text-left shadow-card max-md:hidden">
                <div className="mb-2.5 shrink-0 text-[12.5px] font-medium uppercase tracking-[.1em] text-ink-subtle">
                  Результат диагностики
                </div>
                {/* Услуга — над документом и своим блоком: документ читают
                    не весь, а услугу менеджер должен увидеть обязательно */}
                <div className="shrink-0">
                  <CaseServiceBlock service={diagnosticsService} variant="card" />
                </div>
                <div className="mb-2 mt-4 shrink-0 text-[12.5px] font-medium uppercase tracking-[.1em] text-ink-subtle">
                  Документ врача
                </div>
                {/* Высота документа — остаток экрана: 750 px занимают шапка,
                    аватар, имя, плашка, обвязка карточки и кнопки (замерено).
                    Через flex этого не сделать: карточке с min-h-0 ничто
                    не мешает ужаться ниже содержимого, и текст вылезает под
                    кнопки. Нижний предел 120 px — шесть строк читаемы всегда,
                    дальше прокручивается колонка */}
                <DiagnosticsDocument
                  text={diagnostics}
                  className="max-h-[calc(100vh-750px)] min-h-[120px] overflow-y-auto font-mono text-[13.5px] leading-snug text-ink-label"
                />
              </div>
            )}

            {/* В упражнении под именем стоит ещё и название, и с плашкой
                «Микрофон не даёт сигнала» и списком устройств колонка
                на 1280×800 вылезала на 6 px — появлялась прокрутка. Отступ
                над кнопками в этом состоянии меньше, как в макете */}
            {/* Телефон: результат диагностики и услуга — кнопками во всю
                ширину в колонке, «Пауза» и «Завершить» — в панели внизу */}
            {fullConversation && естьДиагностика && !(diagnostics && листДиагностики) && (
              <button
                type="button"
                onClick={() => {
                  setЛистДиагностики(true);
                  if (!diagnostics) handleDiagnostics();
                }}
                disabled={diagnosticsWaiting}
                className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center gap-[9px] rounded-xl border border-line-strong bg-white px-5 text-[16px] font-semibold text-ink disabled:text-ink-muted md:hidden"
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-brand"
                  aria-hidden="true"
                >
                  <path d="M6 3h8l4 4v14H6z" />
                  <path d="M9.5 12h5M9.5 16h3.5" />
                </svg>
                {diagnosticsWaiting ? "Готовим…" : "Результат диагностики"}
              </button>
            )}
            {drill?.showsService && (
              <div className="mt-6 w-full md:hidden">
                <CaseServiceToggle service={drill.service} phone />
              </div>
            )}

            <div className={`${drill && micAlert ? "mt-7" : "mt-10"} flex gap-3.5 max-md:hidden`}>
              {/* Результат диагностики — только в полном разговоре и до
                  показа. Маркера «сценка отыграна» нет намеренно: менеджер
                  сам решает, когда пациент «сходил», — сценку он всё равно
                  отыгрывает голосом, кнопка лишь выдаёт документ */}
              {fullConversation && естьДиагностика && !diagnostics && (
                <button
                  type="button"
                  onClick={handleDiagnostics}
                  disabled={diagnosticsWaiting}
                  className="rounded-input-lg border border-line-strong bg-white px-8 py-[15px] text-base font-semibold text-brand-hover transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-muted"
                >
                  {diagnosticsWaiting ? "Готовим…" : "Результат диагностики"}
                </button>
              )}

              {/* Услуга по кнопке — в упражнениях с середины разговора:
                  знакомство и расспрос будто бы позади, и узнать, что на
                  столе и почём, менеджеру больше неоткуда */}
              {drill?.showsService && <CaseServiceToggle service={drill.service} />}

              {screenState === "active" ? (
                <button
                  type="button"
                  onClick={handlePause}
                  disabled={busy}
                  className="rounded-input-lg border border-line-strong bg-white px-8 py-[15px] text-base font-semibold text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed"
                >
                  Пауза
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResume}
                  disabled={busy}
                  className="rounded-input-lg bg-brand px-8 py-[15px] text-base font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed"
                >
                  Продолжить
                </button>
              )}

              <button
                type="button"
                onClick={handleStop}
                disabled={busy}
                className={`rounded-input-lg px-8 py-[15px] text-base font-semibold transition-colors disabled:cursor-not-allowed ${
                  screenState === "paused"
                    ? "border border-[#E3C9C6] bg-white text-danger hover:bg-danger-wash"
                    : "bg-danger text-white hover:bg-danger/90"
                }`}
              >
                Завершить разговор
              </button>
            </div>
          </>
        )}

        {/* --- Нет доступа к микрофону --- */}
        {/* Экран отказа собирается по причине, а не один на все случаи.
            Действия разные по существу: при запрете человек идёт в настройки
            сайта, при отсутствии устройства разрешать нечего — надо сначала
            его подключить, и шаги про замок только сбили бы с толку */}
        {screenState === "micError" && micError && (
          <>
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-danger-border bg-danger-surface text-[41px] text-danger">
              🎙
            </div>
            <div className="mt-[18px] text-[22.5px] font-semibold text-ink">
              {micError.title}
            </div>
            <p className="mt-2 max-w-[420px] text-pretty text-center text-[16px] leading-normal text-ink-muted">
              {micError.text}
            </p>

            {micError.steps.length > 0 && (
              <ol className="mt-5 w-full max-w-[440px] list-inside list-decimal rounded-xl border border-line bg-surface px-4 py-3.5 text-[14.5px] leading-relaxed text-ink-label">
                {micError.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}

            <div className="mt-6 flex items-center gap-3 max-md:hidden">
              <button
                type="button"
                onClick={handleStart}
                disabled={busy}
                className="rounded-input bg-brand px-7 py-3 text-[16.5px] font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-disabled"
              >
                {micError.retryLabel}
              </button>
              {micError.kind === "missing" && (
                <button
                  type="button"
                  onClick={() => void refreshDevices()}
                  className="rounded-input border border-line-strong bg-surface-card px-5 py-3 text-[16.5px] font-semibold text-ink transition-colors hover:bg-surface"
                >
                  Обновить список
                </button>
              )}
            </div>

            {micError.note && (
              <p className="mt-3 max-w-[420px] text-center text-[14px] leading-snug text-ink-placeholder max-md:hidden">
                {micError.note}
              </p>
            )}
          </>
        )}

        {/* --- Завершение --- */}
        {screenState === "completing" && (
          <>
            <div className="relative flex h-[88px] w-[88px] items-center justify-center">
              <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand" />
              <span className="text-3xl text-brand">✓</span>
            </div>
            <div className="mt-[22px] text-[22.5px] font-semibold text-ink">
              Разговор завершён
            </div>
            <div className="mt-1.5 text-[16px] text-ink-muted">
              Готовим расшифровку…
            </div>
          </>
        )}
      </div>

      {/* Телефон: результат диагностики — лист поверх колонки. Над ним
          остаётся строка «кто на линии» — аватар, имя и кто говорит, —
          чтобы, читая документ, не перебить пациента */}
      {inCall && diagnostics && листДиагностики && (
        <div className="absolute inset-0 z-20 flex flex-col bg-surface md:hidden">
          <div className="flex shrink-0 items-center gap-3.5 px-5 py-3.5">
            <PatientAvatar
              name={patient?.name ?? null}
              className="h-14 w-14 border-2 border-brand bg-brand-soft text-lg font-semibold text-brand"
            />
            <div className="min-w-0">
              <div className="truncate text-[19px] font-semibold text-ink">
                {patient?.name ?? слова.Клиент}
              </div>
              <div className="mt-1">
                <SpeakerPill
                  state={
                    screenState === "paused"
                      ? "paused"
                      : aiSpeaking
                        ? "speaking"
                        : "listening"
                  }
                />
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-t-[24px] bg-surface-card shadow-[0_-18px_50px_-24px_rgba(12,26,24,.45)]">
            <div className="flex justify-center pt-2" aria-hidden="true">
              <span className="h-[5px] w-9 rounded-[3px] bg-[#D5DDDB]" />
            </div>
            <div className="flex min-h-[48px] items-center gap-2.5 pl-5 pr-2">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-brand"
                aria-hidden="true"
              >
                <path d="M6 3h8l4 4v14H6z" />
                <path d="M9.5 12h5M9.5 16h3.5" />
              </svg>
              <div className="flex-1 text-[18px] font-semibold text-ink">
                Результат диагностики
              </div>
              <button
                type="button"
                onClick={() => setЛистДиагностики(false)}
                title="Свернуть"
                aria-label="Свернуть"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-muted"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">
              <CaseServiceBlock service={diagnosticsService} variant="card" />
              <div className="mb-2 mt-4 font-mono text-[13px] uppercase tracking-[.1em] text-ink-subtle">
                Документ врача
              </div>
              <DiagnosticsDocument
                text={diagnostics}
                className="font-mono text-[13.5px] leading-snug text-ink-label"
              />
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Телефон: действия закреплены внизу экрана — большой палец
          достаёт до них, не прокручивая колонку */}
      {(screenState === "idle" ||
        screenState === "check" ||
        inCall ||
        (screenState === "micError" && micError)) && (
        <div className="flex shrink-0 flex-col gap-2.5 border-t border-line bg-surface-card px-4 pb-4 pt-3 md:hidden">
          {screenState === "idle" && (
            <>
              <button
                type="button"
                onClick={() => setScreenState("check")}
                className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-brand px-5 text-[16px] font-semibold text-white active:bg-brand-hover disabled:cursor-not-allowed disabled:bg-disabled"
              >
                <span className="inline-block h-2 w-2 rounded-full bg-white" />
                Начать тренировку
              </button>
              <p className="text-center text-[13px] text-ink-placeholder">
                Понадобится доступ к микрофону
              </p>
            </>
          )}

          {screenState === "check" && (
            <>
              <button
                type="button"
                onClick={handleStart}
                disabled={busy || (!micProven && !micError)}
                className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-brand px-5 text-[16px] font-semibold text-white active:bg-brand-hover disabled:cursor-not-allowed disabled:bg-disabled"
              >
                Начать
              </button>
              <button
                type="button"
                onClick={() => setScreenState("idle")}
                className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border border-line-strong bg-surface-card px-5 text-[16px] font-semibold text-ink active:bg-surface"
              >
                Назад
              </button>
              {/* Динамика на телефоне не выбирают — запоминаем только микрофон */}
              <p className="text-center text-[13px] text-ink-placeholder">
                Выбор микрофона запомним для следующих разговоров
              </p>
            </>
          )}

          {inCall && (
            <div className="flex gap-2.5">
              {screenState === "active" ? (
                <button
                  type="button"
                  onClick={handlePause}
                  disabled={busy}
                  className="inline-flex min-h-[52px] flex-1 items-center justify-center rounded-xl border border-line-strong bg-white px-3 text-[16px] font-semibold text-ink disabled:cursor-not-allowed"
                >
                  Пауза
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResume}
                  disabled={busy}
                  className="inline-flex min-h-[52px] flex-1 items-center justify-center rounded-xl bg-brand px-3 text-[16px] font-semibold text-white disabled:cursor-not-allowed"
                >
                  Продолжить
                </button>
              )}
              <button
                type="button"
                onClick={handleStop}
                disabled={busy}
                className={`inline-flex min-h-[52px] flex-[1.6] items-center justify-center rounded-xl px-3 text-[16px] font-semibold leading-tight disabled:cursor-not-allowed ${
                  screenState === "paused"
                    ? "border border-[#E3C9C6] bg-white text-danger"
                    : "bg-danger text-white"
                }`}
              >
                Завершить разговор
              </button>
            </div>
          )}

          {screenState === "micError" && micError && (
            <>
              <button
                type="button"
                onClick={handleStart}
                disabled={busy}
                className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-brand px-5 text-[16px] font-semibold text-white active:bg-brand-hover disabled:cursor-not-allowed disabled:bg-disabled"
              >
                {micError.retryLabel}
              </button>
              {micError.kind === "missing" && (
                <button
                  type="button"
                  onClick={() => void refreshDevices()}
                  className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl border border-line-strong bg-surface-card px-5 text-[16px] font-semibold text-ink active:bg-surface"
                >
                  Обновить список
                </button>
              )}
              {micError.note && (
                <p className="text-center text-[13px] leading-snug text-ink-placeholder">
                  {micError.note}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
