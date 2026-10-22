// Снимки настоящих экранов для справки «Как пользоваться» (/help) и места
// меток на них. Только для ЛОКАЛЬНОГО dev-сервера: вход — токеном из
// локального JWT_SECRET прямо в локальный Redis; пароли не вводятся.
// Нужны: npm run dev, docker compose (PostgreSQL + Redis), Chrome и сиды
// seed:demo и seed:team (демо-менеджер, руководитель и их разговоры).
//
//   npm run help:shots               — снять всё, записать картинки и shots.ts
//   node scripts/help-shots.mjs probe <путь> <почта> [шаги-json]
//                                    — разведка: заголовки и кнопки с координатами
//   ONLY=sheet,dossier DEVICE=компьютер npm run help:shots
//                                    — переснять выборочно (shots.ts не пишется)
//
// Учётки недвижимости — HELP_REALTY_MANAGER и HELP_REALTY_HEAD (почты
// менеджера и руководителя любой организации недвижимости в локальной базе).
//
// Пишет frontend/public/howto/<отрасль>/<снимок>.webp и
// frontend/app/help/shots.ts (места меток в процентах от кадра). Метки
// ставятся по DOM, а не на глаз: поменялся экран — перезапусти скрипт,
// и метки встанут на новые места сами.
//
// Звонок — с поддельным голосовым сокетом: без backend
// и без денег. Документ диагностики — настоящий документ случая из базы.
// Свой headless Chrome на порту 9338 и --mute-audio; Chrome пользователя
// не трогаем.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const FRONT = resolve(import.meta.dirname, "..");
const require = createRequire(join(FRONT, "package.json"));
const BASE = process.env.APP_URL || "http://localhost:3000";
const PORT = 9338;
const W = 390;
const H = 844;
const OUT_IMG = join(FRONT, "public/howto");
const OUT_TS = join(FRONT, "app/help/shots.ts");
const TMP = join(tmpdir(), "podhod-help-shots");
const PROFILE = join(TMP, "chrome-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function env() {
  const out = {};
  for (const line of readFileSync(join(FRONT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const e = env();
process.env.DATABASE_URL = e.DATABASE_URL;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function mint(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`нет пользователя ${email}`);
  const { SignJWT } = require("jose");
  const token = await new SignJWT({ email, firstName: user.firstName, lastName: user.lastName })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(e.JWT_SECRET));
  const { createClient } = require("redis");
  const redis = createClient({ url: e.REDIS_URL });
  await redis.connect();
  await redis.set(`auth:token:${createHash("sha256").update(token).digest("hex")}`, user.id, { EX: 7200 });
  await redis.quit();
  return { token, user };
}

// Документ диагностики и услуга первого пациента клиники — для поддельного
// звонка: в справке должен стоять настоящий документ, а не образец
async function fakeDoc(user, patientName) {
  const patient = await prisma.patient.findFirst({ where: { name: patientName }, select: { id: true } });
  const c = await prisma.patientCase.findFirst({
    where: { patientId: patient.id, organizationId: user.organizationId },
  });
  if (!c?.diagnosticsPreset) return null;
  const s = await prisma.service.findFirst({ where: { organizationId: user.organizationId, name: c.serviceName ?? "" } });
  return { service: s ? { name: s.name, price: s.price, description: s.description ?? "" } : null, text: c.diagnosticsPreset };
}

async function chrome() {
  const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--mute-audio", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "--hide-scrollbars", "--no-first-run", "--force-device-scale-factor=1",
    // Поддельный микрофон: проверка звука слышит сигнал
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 120; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(250); }
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  // Любой шаг — не дольше 30 секунд: зависший промис на странице иначе
  // держал прогон бесконечно (19.10 — двадцать минут на «Статистике»)
  const evaluate = async (expr) => {
    const r = await Promise.race([
      send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }),
      sleep(30000).then(() => { throw new Error("шаг на странице не ответил за 30 с"); }),
    ]);
    if (r.result?.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  const close = async () => { try { await send("Browser.close"); } catch {} proc.kill(); };
  return { send, evaluate, close };
}

// Поддельный голосовой сокет:
// экран звонка переходит в разговор без backend. На запрос диагностики
// отвечает документом из window.__fakeDoc. Плюс: старт разговора отвечает
// «метку не показывать» — в справке экран опытного менеджера, без метки
const FAKE = `
  const RealFetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await RealFetch(...args);
    if (String(args[0]).includes("/api/sessions/start") && res.ok) {
      const body = await res.clone().json();
      body.diagnosticsHint = false;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return res;
  };
  const RealWS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    if (String(url).includes("_next")) return new RealWS(url, protocols);
    return new FakeWS();
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  class FakeWS {
    constructor() {
      this.readyState = 0;
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 150);
    }
    addEventListener() {}
    removeEventListener() {}
    send(raw) {
      const m = JSON.parse(raw);
      if (m.type === "diagnostics" && window.__fakeDoc)
        setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(Object.assign({ type: "diagnostics_result" }, window.__fakeDoc)) }), 300);
    }
    close() { this.readyState = 3; }
  };
`;

// Помощники на странице: найти видимый элемент по тексту и снять его рамку
const HELPERS = `
  window.__h = {
    norm: (t) => (t || "").trim().replace(/\\s+/g, " "),
    vis: (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; },
    // Без учёта регистра: подписи разделов набраны капслоком через CSS,
    // и innerText отдаёт их заглавными
    same: (a, b, prefix) => { a = a.toLowerCase(); b = b.toLowerCase(); return prefix ? a.startsWith(b) : a === b; },
    // Самый глубокий видимый элемент, чей текст равен t (или начинается с t)
    find(t, { prefix = false, sel = "*", nth = 0 } = {}) {
      const all = [...document.querySelectorAll(sel)].filter((el) => this.vis(el) && this.same(this.norm(el.innerText), t, prefix));
      const deepest = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
      // nth: -1 — последний: кнопка в окне идёт в разметке после такой же под ним
      return deepest[nth < 0 ? deepest.length + nth : nth] || null;
    },
    rect(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; },
    click(t, opts) { const el = this.find(t, opts); if (!el) return false; (el.closest("button, a, [role=button], label") || el).click(); return true; },
  };
`;

// keep — не глушить анимации: печать исхода в разборе проявляется анимацией
const SETTLE = (keep) => `(async () => {
  if (!${keep}) document.head.insertAdjacentHTML('beforeend', '<style>*,*::before,*::after{transition:none !important;animation:none !important;caret-color:transparent !important}</style>');
  document.querySelectorAll('img[loading="lazy"]').forEach(i => i.loading = 'eager');
  // Не дольше 5 секунд: аватар, который так и не догрузился, вешал прогон
  await Promise.race([
    Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))),
    new Promise(r => setTimeout(r, 5000)),
  ]);
  await document.fonts.ready;
  return true;
})()`;

// Шаг повторяется, пока не сработает: фиксированных пауз не хватало —
// то страница ещё не ожила после загрузки, то окно не успело открыться,
// и прогон падал через раз. until — проверка, что шаг дал результат
async function run(c, steps) {
  for (const st of steps) {
    if (st.wait) { await sleep(st.wait); continue; }
    const action = st.js
      ? `(() => { ${HELPERS_INLINE} return (${st.js}); })()`
      : `(() => { ${HELPERS_INLINE} return __h.click(${JSON.stringify(st.click)}, ${JSON.stringify(st.opts || {})}); })()`;
    let done = false;
    for (let attempt = 0; attempt < 12 && !done; attempt++) {
      const ok = await c.evaluate(action);
      if (ok === false || ok === null || ok === undefined) { await sleep(500); continue; }
      if (st.log) console.log("  js:", JSON.stringify(ok));
      await sleep(st.after ?? 900);
      done = !st.until || (await c.evaluate(`(() => { ${HELPERS_INLINE} return !!(${st.until}); })()`));
    }
    if (!done) throw new Error(`шаг не сработал: ${(st.click || st.js).slice(0, 120)}`);
  }
}
const HELPERS_INLINE = `if (!window.__h) { ${HELPERS} }`;

async function open(c, path, steps, keepAnim = false) {
  await c.send("Page.navigate", { url: BASE + path });
  await sleep(4500);
  await c.evaluate(SETTLE(keepAnim));
  await run(c, steps || []);
  await c.evaluate(SETTLE(keepAnim));
  await sleep(500);
}

// ---------------------------------------------------------------- разведка
async function probe(path, email, stepsJson) {
  const { token } = await mint(email);
  const c = await chrome();
  await c.send("Network.enable");
  await c.send("Network.setCookie", { name: "token", value: token, url: BASE, httpOnly: true });
  await c.send("Page.enable");
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE });
  // DESK=1 — разведка компьютерного экрана 1440×900
  const desk = Boolean(process.env.DESK);
  await c.send("Emulation.setDeviceMetricsOverride", desk ? { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false } : { width: W, height: H, deviceScaleFactor: 1, mobile: true });
  await c.send("Emulation.setTouchEmulationEnabled", { enabled: !desk, maxTouchPoints: desk ? 0 : 5 });
  await open(c, path, stepsJson ? JSON.parse(stepsJson) : []);
  const list = await c.evaluate(`(() => { ${HELPERS_INLINE}
    const out = [];
    for (const el of document.querySelectorAll("h1, h2, h3, button, a, label, [role=button], [role=dialog], section, select")) {
      if (!__h.vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      out.push(el.tagName.toLowerCase() + " [" + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "×" + Math.round(r.height) + "] " + __h.norm(el.innerText).slice(0, 60));
    }
    return out;
  })()`);
  console.log(list.join("\n"));
  const shot = await c.send("Page.captureScreenshot", { format: "png" });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, "probe.png"), Buffer.from(shot.result.data, "base64"));
  console.log(`снимок: ${join(TMP, "probe.png")}`);
  await c.close();
  await prisma.$disconnect();
}

// ---------------------------------------------------------------- снимки
// Кадр — полоса во всю ширину экрана: y0..y1 считает выражение на странице.
// Метки — точки на странице; в shots.ts они уходят процентами от кадра.
// Выражение возвращает { y0, y1, marks: [[x, y], …] }
const ОКНО = `document.querySelector('[role=dialog]')`;
const ДАЛЕЕ_АКТИВНА = `!__h.find('Далее ›', { sel: 'button' })?.disabled`;
// Окно открывается сразу, а карточки типов приходят запросом — ждём карточку
const МАСТЕР = { click: "Начать тренировку", opts: { sel: "button" }, after: 1400, until: `[...document.querySelectorAll('[role=dialog] button')].some(e => __h.norm(e.innerText).startsWith('Полный разговор'))` };
const ПОЛНЫЙ = { js: `(() => { const el = [...document.querySelectorAll('[role=dialog] button')].filter(e => __h.vis(e) && __h.norm(e.innerText).startsWith('Полный разговор')).pop(); el?.click(); return !!el; })()`, after: 600, until: ДАЛЕЕ_АКТИВНА };
const К_ПАЦИЕНТУ = { click: "Далее ›", after: 1200, until: `document.querySelector('[role=dialog] .flex.flex-col.gap-2 > div button')` };
// Первый пациент списка: строка выбирается кликом по ней, имя открывает анамнез
const ПЕРВЫЙ = { js: `(() => { const b = document.querySelector('[role=dialog] .flex.flex-col.gap-2 > div button'); const row = b && b.parentElement; row?.click(); return !!row; })()`, after: 600, until: ДАЛЕЕ_АКТИВНА };
const К_ОБЗОРУ = { click: "Далее ›", after: 1200, until: `/Шаг 3/.test(${ОКНО}?.innerText || '')` };
// Кнопки «Начать тренировку» в окне и под ним совпадают текстом — жмём последнюю
const ВОКНЕ = (t, after, until) => ({ click: t, opts: { sel: "button", nth: -1 }, after, until });
const К_ПРОВЕРКЕ = [МАСТЕР, ПОЛНЫЙ, К_ПАЦИЕНТУ, ПЕРВЫЙ, К_ОБЗОРУ,
  ВОКНЕ("Начать тренировку", 4000, `location.pathname === '/session'`),
  ВОКНЕ("Начать тренировку", 3000, `__h.find('Проверим, что вас слышно')`)];
// Поддельные устройства Chrome называются «Fake Default Audio Input/Output» —
// в справке показываем имена, какие увидит человек
const ИМЯ_МИКРОФОНА = { js: `(() => { const [m, d] = document.querySelectorAll('select'); if (!m) return false; m.options[m.selectedIndex].text = 'Микрофон гарнитуры'; if (d) d.options[d.selectedIndex].text = 'Наушники гарнитуры'; return true; })()`, after: 200 };
const К_РАЗГОВОРУ = [...К_ПРОВЕРКЕ, { click: "Начать", opts: { sel: "button" }, after: 3500, until: `__h.find('Завершить разговор', { sel: 'button' })` }];

// Метка на кнопке «Результат диагностики», если она есть: у клиник это
// вторая метка шага «Говорите», у недвижимости кнопки нет
const МЕТКА_ДИАГНОСТИКИ = `const кнопкаДиаг = __h.find('Результат диагностики', { sel: 'button' }); const диаг = кнопкаДиаг ? [[__h.rect(кнопкаДиаг).x + 6, __h.rect(кнопкаДиаг).y + __h.rect(кнопкаДиаг).h / 2]] : [];`;

// Плашка «Слушаю вас» целиком: подпись внутри неё, слева эквалайзер
const ПЛАШКА = `(() => { const t = __h.find('Слушаю вас'); let p = t; while (p && p.getBoundingClientRect().width < t.getBoundingClientRect().width + 30) p = p.parentElement; return p; })()`;

// Прокрутить ближайший прокручиваемый контейнер так, чтобы элемент встал на y
const ПРОКРУТИТЬ = (text, y) => ({ js: `(() => {
  const t = __h.find(${JSON.stringify(text)});
  if (!t) return false;
  let p = t.parentElement;
  while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
  if (!p) return false;
  p.scrollTop += t.getBoundingClientRect().top - ${y};
  return true;
})()`, after: 600 });

// Карточка вокруг заголовка: ближайший предок во всю ширину колонки
// Стрелка строки менеджера в статистике: кнопка без подписи у правого края
const СТРЕЛКА = `[...document.querySelectorAll('main button')].filter(e => __h.vis(e) && !__h.norm(e.innerText) && e.getBoundingClientRect().left > 300)[0]`;
const ПУСТОЕ_НАЗВАНИЕ = (title) => ({ js: `(() => { const t = __h.find(${JSON.stringify(title)}); let p = t; while (p && !p.querySelector('input')) p = p.parentElement; const i = p && p.querySelector('input'); if (!i) return false; i.value = ''; return true; })()`, after: 300 });
const КАРТОЧКА = `(t) => { let p = t; while (p && p.getBoundingClientRect().width < 330) p = p.parentElement; return p; }`;

function shotsFor(accounts, realty) {
  const list = {
    // Шаг 1: мастер, выбор типа. Метки — на кружках двух первых карточек
    type: { email: accounts.manager, path: "/", steps: [МАСТЕР], measure: `(() => {
      const d = document.querySelector('[role=dialog]');
      const cards = [...d.querySelectorAll('button')].filter(e => __h.vis(e) && e.getBoundingClientRect().height > 60);
      const [r1, r2, , r4] = cards.map(__h.rect);
      return { y0: __h.rect(d).y, y1: r4.y + r4.h + 12, marks: [[r1.x + 26, r1.y + r1.h / 2], [r2.x + 26, r2.y + r2.h / 2]] };
    })()` },
    // Шаг 2: выбор пациента. «Лёгкий» и имя выбранного
    pat: { email: accounts.manager, path: "/", steps: [МАСТЕР, ПОЛНЫЙ, К_ПАЦИЕНТУ, ПЕРВЫЙ], measure: `(() => {
      const d = document.querySelector('[role=dialog]');
      const easy = __h.find('Лёгкий', { sel: 'button' });
      const rows = [...d.querySelectorAll('.flex.flex-col.gap-2 > div')].filter(__h.vis);
      const re = __h.rect(easy), rn = __h.rect(rows[0].querySelector('button')), r2 = __h.rect(rows[1]);
      return { y0: __h.rect(d).y, y1: r2.y + r2.h + 10, marks: [[re.x + 4, re.y + 4], [rn.x + 22, rn.y + rn.h / 2]] };
    })()` },
    // Шаг 3: проверка звука с плитками. Микрофон, засечка, «Начать»
    check: { email: accounts.manager, path: "/", steps: [...К_ПРОВЕРКЕ, ИМЯ_МИКРОФОНА], measure: `(() => {
      const title = __h.find('Проверим, что вас слышно');
      const rs = __h.rect(document.querySelector('select'));
      const rm = __h.rect([...document.querySelectorAll('span.absolute.inset-y-0.w-px')].find(__h.vis));
      const rb = __h.rect(__h.find('Начать', { sel: 'button' }));
      return { y0: __h.rect(title).y - 20, y1: innerHeight, marks: [[rs.x - 2, rs.y + rs.h / 2], [rm.x, rm.y - 10], [rb.x + rb.w / 2 - 50, rb.y + rb.h / 2]] };
    })()` },
    // Шаг 4: разговор. «Слушаю вас» и «Завершить разговор»
    listen: { email: accounts.manager, path: "/", steps: К_РАЗГОВОРУ, measure: `(() => {
      const rp = __h.rect(__h.find('Слушаю вас')), rpl = __h.rect(${ПЛАШКА});
      const re = __h.rect(__h.find('Завершить разговор', { sel: 'button' }));
      ${МЕТКА_ДИАГНОСТИКИ}
      return { y0: rp.y - 150, y1: innerHeight, marks: [[rpl.x - 2, rp.y + rp.h / 2], ...диаг, [re.x - 2, re.y + re.h / 2]] };
    })()` },
  };
  if (!realty) {
    // Шаг 5: лист «Результат диагностики» — только у клиник
    // Шаг 5, до нажатия: кнопка «Результат диагностики» в разговоре
    list.button = { email: accounts.manager, path: "/", steps: К_РАЗГОВОРУ, measure: `(() => {
      const rp = __h.rect(__h.find('Слушаю вас'));
      const rb = __h.rect(__h.find('Результат диагностики', { sel: 'button' }));
      return { y0: rp.y - 70, y1: rb.y + rb.h + 24, marks: [[rb.x + 6, rb.y + rb.h / 2]] };
    })()` };
    // Шаг 5, после нажатия: лист с услугой и заключением врача. Кнопки
    // здесь уже нет — метки только на том, что открылось
    list.sheet = { email: accounts.manager, path: "/", fakeDoc: true, steps: [...К_РАЗГОВОРУ, { click: "Результат диагностики", opts: { sel: "button" }, after: 2500 }], measure: `(() => {
      const rs = __h.rect(__h.find('Услуга по диагнозу'));
      const rd = __h.rect(__h.find('Документ врача'));
      return { y0: 56, y1: Math.min(rd.y + 150, innerHeight - 90), marks: [[rs.x - 18, rs.y + rs.h / 2], [rd.x - 18, rd.y + rd.h / 2]] };
    })()` };
    // Шаг 6: разбор. Общий для отраслей: шапку с именем срезаем, а этапы
    // и подписи разбора одни и те же. Анимацию не глушим — ею проявляется
    // печать исхода
    list.review = { email: accounts.manager, path: accounts.review, keepAnim: true, steps: [{ wait: 3500 }], measure: `(() => {
      const ro = __h.rect(__h.find('Сделка закрыта', { prefix: true }) || __h.find('Сделка не закрыта', { prefix: true }));
      const rs = __h.rect(__h.find('Общая оценка'));
      const rg = __h.rect(__h.find('Точка роста'));
      const rm = __h.rect(__h.find('Ещё разговор', { sel: 'button, a' }));
      const rt = __h.rect(__h.find('Разбор', { sel: 'button' }));
      return { y0: rt.y - 10, y1: innerHeight, marks: [[ro.x - 26, ro.y + ro.h / 2], [rs.x - 64, rs.y - 4], [rg.x - 14, rg.y + rg.h / 2], [rm.x + 16, rm.y + rm.h / 2]] };
    })()` };
  }
  // Руководитель: задания — «Создать»
  list.tasks = { email: accounts.head, path: "/tasks", steps: [{ wait: 1500 }], measure: `(() => {
    const rb = __h.rect(__h.find('Создать', { prefix: true, sel: 'button, a' }));
    return { y0: 56, y1: Math.min(rb.y + rb.h + 200, innerHeight - 80), marks: [[rb.x + rb.w / 2 - 44, rb.y + rb.h / 2]] };
  })()` };
  // Статистика — строка первого менеджера
  // За всё время: за неделю у демо-команды разговоров нет, и строки
  // показывали «— нет разговоров» под подписью «Его разговоры и расшифровки»
  // За всё время сверху встаёт пьедестал, и строки менеджеров уходят далеко
  // под экран — прокручиваем к первой строке
  if (!realty) list.stat = { email: accounts.head, path: "/stats", steps: [{ wait: 2000 }, { click: "Всё время", opts: { sel: "button" }, after: 1500 }, { js: `(() => { const a = ${СТРЕЛКА}; if (!a) return false; document.querySelector('main').scrollTop += a.getBoundingClientRect().top - 260; return true; })()`, after: 600 }], measure: `(() => {
    const row = (${КАРТОЧКА})(${СТРЕЛКА});
    const r = __h.rect(row);
    // Одна строка: ниже в локальной базе идут настоящие учётки команды
    return { y0: r.y - 64, y1: r.y + r.h + 14, marks: [[r.x + 82, r.y + r.h / 2]] };
  })()` };
  // Досье пациента — окно «Подробнее», от «Характера» вниз
  list.dossier = { email: accounts.head, path: "/patients", steps: [{ wait: 1500 }, { click: "Подробнее", opts: { sel: "button" }, after: 1500 }, ПРОКРУТИТЬ("Характер", 230)], measure: `(() => {
    const rt = __h.rect(__h.find('Характер'));
    return { y0: rt.y - 18, y1: Math.min(rt.y + 400, innerHeight - 90), marks: [[rt.x - 18, rt.y + rt.h / 2]] };
  })()` };
  // Профиль: часы разговоров и карточка организации
  list.hours = { email: accounts.head, path: "/profile", steps: [{ wait: 1500 }, ПРОКРУТИТЬ("Часы разговоров", 140)], measure: `(() => {
    const t = __h.find('Часы разговоров');
    const rc = __h.rect((${КАРТОЧКА})(t)), rt = __h.rect(t);
    return { y0: rc.y - 8, y1: Math.min(rc.y + rc.h + 8, rc.y + 300), marks: [[rt.x - 14, rt.y + rt.h / 2]] };
  })()` };
  // Название организации стираем: в локальной базе оно тестовое («ЖК
  // Проверочный»), а пустое поле показывает подсказку самого приложения
  list.company = { email: accounts.head, path: "/profile", steps: [{ wait: 1500 }, ПРОКРУТИТЬ(accounts.карточка, 140), ПУСТОЕ_НАЗВАНИЕ(accounts.карточка)], measure: `(() => {
    const t = __h.find(${JSON.stringify(accounts.карточка)});
    const rc = __h.rect((${КАРТОЧКА})(t)), rt = __h.rect(t);
    return { y0: rc.y - 8, y1: Math.min(rc.y + rc.h + 8, rc.y + 280), marks: [[rt.x - 14, rt.y + rt.h / 2]] };
  })()` };
  return list;
}

// Компьютерный набор: тот же путь по экранам, но 1440×900, и кадр режется
// ещё и по ширине — по окну или карточке, а не во всю ширину экрана.
// Окно мастера и досье — ближайший предок шириной от 640 px (карточки
// внутри окна — 612); выше по
// дереву идём, пока ширина та же (иначе кадр начинался бы под шапкой окна)
const ОКНО_ПК = `(el) => { let p = el; while (p && p.getBoundingClientRect().width < 640) p = p.parentElement; while (p && p.parentElement && Math.abs(p.parentElement.getBoundingClientRect().width - p.getBoundingClientRect().width) < 4) p = p.parentElement; return p; }`;
// Карточка на компьютере — ближайший предок с рамкой: строка заголовка
// бывает той же ширины, и кадр получался полосой в 42 px
const КАРТОЧКА_ПК = `(t) => { let p = t; while (p && !(p.getBoundingClientRect().width >= 400 && p.getBoundingClientRect().height >= 100 && parseFloat(getComputedStyle(p).borderTopWidth) >= 1)) p = p.parentElement; return p; }`;

function shotsForDesk(accounts, realty) {
  const list = {
    type: { email: accounts.manager, path: "/", steps: [МАСТЕР], measure: `(() => {
      const full = [...document.querySelectorAll('[role=dialog] button')].find(e => __h.vis(e) && __h.norm(e.innerText).startsWith('Полный разговор'));
      const d = (${ОКНО_ПК})(full);
      const cards = [...d.querySelectorAll('button')].filter(e => __h.vis(e) && e.getBoundingClientRect().height > 60 && e.getBoundingClientRect().width > 500);
      const [r1, r2, , r4] = cards.map(__h.rect);
      const rd = __h.rect(d);
      return { x0: rd.x, x1: rd.x + rd.w, y0: rd.y, y1: r4.y + r4.h + 12, marks: [[r1.x + 26, r1.y + r1.h / 2], [r2.x + 26, r2.y + r2.h / 2]] };
    })()` },
    pat: { email: accounts.manager, path: "/", steps: [МАСТЕР, ПОЛНЫЙ, К_ПАЦИЕНТУ, ПЕРВЫЙ], measure: `(() => {
      const rows = [...document.querySelectorAll('[role=dialog] .flex.flex-col.gap-2 > div')].filter(__h.vis);
      const d = (${ОКНО_ПК})(rows[0]);
      const rd = __h.rect(d), re = __h.rect(__h.find('Лёгкий', { sel: 'button' })), rn = __h.rect(rows[0].querySelector('button')), r2 = __h.rect(rows[1]);
      return { x0: rd.x, x1: rd.x + rd.w, y0: rd.y, y1: r2.y + r2.h + 10, marks: [[re.x + 4, re.y + 4], [rn.x + 22, rn.y + rn.h / 2]] };
    })()` },
    check: { email: accounts.manager, path: "/", steps: [...К_ПРОВЕРКЕ, ИМЯ_МИКРОФОНА], measure: `(() => {
      const sel = document.querySelector('select');
      const rc = __h.rect((${КАРТОЧКА_ПК})(sel)), rs = __h.rect(sel), rt = __h.rect(__h.find('Проверим, что вас слышно'));
      const rm = __h.rect([...document.querySelectorAll('span.absolute.inset-y-0.w-px')].find(__h.vis));
      const rb = __h.rect(__h.find('Начать', { sel: 'button' }));
      const rn = __h.rect(__h.find('Выбор устройств запомним для следующих разговоров'));
      return { x0: rc.x - 32, x1: rc.x + rc.w + 32, y0: rt.y - 24, y1: rn.y + rn.h + 16, marks: [[rs.x - 2, rs.y + rs.h / 2], [rm.x, rm.y - 10], [rb.x - 4, rb.y + rb.h / 2]] };
    })()` },
    listen: { email: accounts.manager, path: "/", steps: К_РАЗГОВОРУ, measure: `(() => {
      const rp = __h.rect(__h.find('Слушаю вас')), rpl = __h.rect(${ПЛАШКА});
      const end = __h.find('Завершить разговор', { sel: 'button' });
      const re = __h.rect(end), rr = __h.rect(end.parentElement);
      ${МЕТКА_ДИАГНОСТИКИ}
      return { x0: rr.x - 40, x1: rr.x + rr.w + 40, y0: rp.y - 330, y1: rr.y + rr.h + 28, marks: [[rpl.x - 2, rp.y + rp.h / 2], ...диаг, [re.x - 2, re.y + re.h / 2]] };
    })()` },
  };
  if (!realty) {
    list.button = { email: accounts.manager, path: "/", steps: К_РАЗГОВОРУ, measure: `(() => {
      const rp = __h.rect(__h.find('Слушаю вас'));
      const btn = __h.find('Результат диагностики', { sel: 'button' });
      const rb = __h.rect(btn), rr = __h.rect(__h.find('Завершить разговор', { sel: 'button' }).parentElement);
      return { x0: rr.x - 40, x1: rr.x + rr.w + 40, y0: rp.y - 70, y1: rr.y + rr.h + 24, marks: [[rb.x + 6, rb.y + rb.h / 2]] };
    })()` };
    list.sheet = { email: accounts.manager, path: "/", fakeDoc: true, steps: [...К_РАЗГОВОРУ, { click: "Результат диагностики", opts: { sel: "button" }, after: 2500, until: `__h.find('Документ врача')` }], measure: `(() => {
      const svc = __h.find('Услуга по диагнозу');
      const rc = __h.rect((${КАРТОЧКА_ПК})(svc)), rs = __h.rect(svc), rd = __h.rect(__h.find('Документ врача'));
      const rt = __h.rect(__h.find('Результат диагностики', { prefix: true }));
      const rp = __h.rect(__h.find('Слушаю вас')), rz = __h.rect(__h.find('Пауза', { sel: 'button' }));
      return { x0: rc.x - 40, x1: rc.x + rc.w + 40, y0: rp.y - 12, y1: rz.y + rz.h + 20, marks: [[rs.x - 18, rs.y + rs.h / 2], [rd.x - 18, rd.y + rd.h / 2]] };
    })()` };
    // Разбор: правая панель и правый край шапки с «Ещё разговор»;
    // имя пациента в шапке слева в кадр не попадает
    list.review = { email: accounts.manager, path: accounts.review, keepAnim: true, steps: [{ wait: 3500 }], measure: `(() => {
      const rpn = __h.rect(__h.find('Разбор разговора'));
      const ro = __h.rect(__h.find('Сделка закрыта', { prefix: true }) || __h.find('Сделка не закрыта', { prefix: true }));
      const rs = __h.rect(__h.find('Общая оценка'));
      const grow = __h.find('Точка роста');
      // У карточки «Точка роста» рамка только слева — ищем её по высоте
      let gc = grow; while (gc && gc.getBoundingClientRect().height < 50) gc = gc.parentElement;
      const rg = __h.rect(grow), rgc = __h.rect(gc);
      const rm = __h.rect(__h.find('Ещё разговор', { sel: 'button, a' }));
      return { x0: rpn.x - 28, x1: innerWidth, y0: 0, y1: rgc.y + rgc.h + 16, marks: [[ro.x - 26, ro.y + ro.h / 2], [rs.x - 64, rs.y - 4], [rg.x - 14, rg.y + rg.h / 2], [rm.x - 4, rm.y + rm.h / 2]] };
    })()` };
    // Статистика за всё время — первая строка: там разговоры и оценки
    // Пьедестал выше экрана 900 px — прокручиваем его к верху
    const К_ПЬЕДЕСТАЛУ = { js: `(() => { let b = __h.find('Смотреть статистику', { prefix: true, sel: 'button' }); while (b && b.getBoundingClientRect().width < 900) b = b.parentElement; if (!b) return false; document.querySelector('main').scrollTop += b.getBoundingClientRect().top - 90; return true; })()`, after: 600 };
    list.stat = { email: accounts.head, path: "/stats", steps: [{ wait: 2000 }, { click: "Всё время", opts: { sel: "button" }, after: 1500 }, К_ПЬЕДЕСТАЛУ], measure: `(() => {
      // За всё время сверху — пьедестал из трёх карточек; метка — на кнопке
      // первого места (она выше остальных)
      const btns = [...document.querySelectorAll('main button')].filter(e => __h.vis(e) && __h.norm(e.innerText).startsWith('Смотреть статистику')).map(__h.rect).slice(0, 3);
      let box = __h.find('Смотреть статистику', { prefix: true, sel: 'button' });
      while (box && box.getBoundingClientRect().width < 900) box = box.parentElement;
      const r = __h.rect(box);
      const first = btns.reduce((a, b) => (b.y < a.y ? b : a));
      const bottom = Math.max(...btns.map(b => b.y + b.h));
      return { x0: r.x - 16, x1: r.x + r.w + 16, y0: r.y - 16, y1: bottom + 24, marks: [[first.x + 24, first.y + first.h / 2]] };
    })()` };
  }
  list.tasks = { email: accounts.head, path: "/tasks", steps: [{ wait: 1500 }], measure: `(() => {
    const rt = __h.rect(__h.find('Выставленные задания'));
    const rb = __h.rect(__h.find('Создать', { prefix: true, sel: 'button, a' }));
    const empty = __h.find('Заданий пока нет');
    const re = empty ? __h.rect((${КАРТОЧКА_ПК})(empty)) : null;
    return { x0: rt.x - 24, x1: rb.x + rb.w + 24, y0: rt.y - 24, y1: re ? re.y + re.h + 16 : rb.y + rb.h + 220, marks: [[rb.x + 28, rb.y + rb.h / 2]] };
  })()` };
  list.dossier = { email: accounts.head, path: "/patients", steps: [{ wait: 1500 }, { click: "Подробнее", opts: { sel: "button" }, after: 1500, until: ОКНО }, ПРОКРУТИТЬ("Характер", 170)], measure: `(() => {
    const t = __h.find('Характер');
    const rd = __h.rect((${ОКНО_ПК})(t)), rt = __h.rect(t), rz = __h.rect(__h.find('Закрыть', { sel: 'button' }));
    return { x0: rd.x, x1: rd.x + rd.w, y0: rt.y - 18, y1: Math.min(rt.y + 380, rz.y - 16), marks: [[rt.x - 20, rt.y + rt.h / 2]] };
  })()` };
  list.hours = { email: accounts.head, path: "/profile", steps: [{ wait: 1500 }, ПРОКРУТИТЬ("Часы разговоров", 160)], measure: `(() => {
    const t = __h.find('Часы разговоров');
    const rc = __h.rect((${КАРТОЧКА_ПК})(t)), rt = __h.rect(t);
    return { x0: rc.x - 8, x1: rc.x + rc.w + 8, y0: rc.y - 8, y1: Math.min(rc.y + rc.h + 8, rc.y + 320), marks: [[rt.x - 22, rt.y + rt.h / 2]] };
  })()` };
  list.company = { email: accounts.head, path: "/profile", steps: [{ wait: 1500 }, ПРОКРУТИТЬ(accounts.карточка, 160), ПУСТОЕ_НАЗВАНИЕ(accounts.карточка)], measure: `(() => {
    const t = __h.find(${JSON.stringify(accounts.карточка)});
    const rc = __h.rect((${КАРТОЧКА_ПК})(t)), rt = __h.rect(t);
    return { x0: rc.x - 8, x1: rc.x + rc.w + 8, y0: rc.y - 8, y1: Math.min(rc.y + rc.h + 8, rc.y + 300), marks: [[rt.x - 22, rt.y + rt.h / 2]] };
  })()` };
  return list;
}

async function shoot(industry, accounts, device) {
  const realty = industry === "недвижимость";
  const pc = device === "компьютер";
  const list = pc ? shotsForDesk(accounts, realty) : shotsFor(accounts, realty);
  // Размер экрана: телефон 390×844, компьютер 1440×900
  const [VW, VH] = pc ? [1440, 900] : [W, H];
  const prefix = pc ? "desk-" : "";
  const folder = realty ? "realty" : "clinic";
  mkdirSync(join(OUT_IMG, folder), { recursive: true });
  const result = {};
  const failed = [];
  for (const [name, spec] of Object.entries(list)) {
    // ONLY=sheet,dossier — переснять выборочно (shots.ts тогда не пишется)
    if (process.env.ONLY && !process.env.ONLY.split(",").includes(name)) continue;
    const { token, user } = await mint(spec.email);
    const c = await chrome();
    await c.send("Network.enable");
    await c.send("Network.setCookie", { name: "token", value: token, url: BASE, httpOnly: true });
    await c.send("Page.enable");
    await c.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE });
    if (spec.fakeDoc) {
      const doc = await fakeDoc(user, accounts.patient);
      await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__fakeDoc = ${JSON.stringify(doc)};` });
    }
    await c.send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 2, mobile: !pc });
    await c.send("Emulation.setTouchEmulationEnabled", { enabled: !pc, maxTouchPoints: pc ? 0 : 5 });
    try {
      await open(c, spec.path, spec.steps, spec.keepAnim);
      const m = await c.evaluate(`(() => { ${HELPERS_INLINE} return ${spec.measure}; })()`);
      const x0 = Math.max(0, Math.round(m.x0 ?? 0));
      const x1 = Math.min(VW, Math.round(m.x1 ?? VW));
      const y0 = Math.max(0, Math.round(m.y0));
      const y1 = Math.min(VH, Math.round(m.y1));
      // Кадр вне экрана или пустой — ошибка: на снимок с такой рамкой Chrome
      // не отвечает вовсе, и прогон висел (19.10, «Статистика»)
      if (y1 - y0 < 40 || x1 - x0 < 40) throw new Error(`кадр ${x0}..${x1} × ${y0}..${y1} вне экрана — элемент не прокручен в видимую часть`);
      const shot = await Promise.race([
        c.send("Page.captureScreenshot", { format: "webp", quality: 82, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, scale: 1 } }),
        sleep(30000).then(() => { throw new Error("снимок не получен за 30 с"); }),
      ]);
      const buf = Buffer.from(shot.result.data, "base64");
      writeFileSync(join(OUT_IMG, folder, `${prefix}${name}.webp`), buf);
      const marks = m.marks.map(([x, y]) => [+((x - x0) / (x1 - x0) * 100).toFixed(1), +((y - y0) / (y1 - y0) * 100).toFixed(1)]);
      const v = createHash("sha1").update(buf).digest("hex").slice(0, 8);
      result[name] = { src: `/howto/${folder}/${prefix}${name}.webp?v=${v}`, w: x1 - x0, h: y1 - y0, marks };
      console.log(`✓ ${industry}/${device}/${name}: ${x1 - x0}×${y1 - y0}, меток ${marks.length}, ${Math.round(buf.length / 1024)} КБ`);
    } catch (err) {
      failed.push(name);
      console.log(`✗ ${industry}/${device}/${name}: ${err.message}`);
      // Снимок провала — тоже с пределом: зависшая страница может не ответить
      const shot = await Promise.race([c.send("Page.captureScreenshot", { format: "png" }), sleep(10000).then(() => null)]);
      mkdirSync(TMP, { recursive: true });
      if (shot?.result) writeFileSync(join(TMP, `fail-${folder}-${prefix}${name}.png`), Buffer.from(shot.result.data, "base64"));
      console.log(`  снимок провала: ${join(TMP, `fail-${folder}-${prefix}${name}.png`)}`);
    }
    await c.close();
  }
  return { result, failed };
}

function writeTs(снимки) {
  const json = (o) => JSON.stringify(o, null, 2).replace(/\[\n\s+([\d.]+),\n\s+([\d.]+)\n\s+\]/g, "[$1, $2]");
  const ts = `// Сгенерировано scripts/help-shots.mjs (npm run help:shots) — руками не правим.
// Поменялся экран — перезапусти скрипт: снимки и места меток обновятся вместе.
// Два набора: телефон (экран 390 px) и компьютер (1440×900, кадр вырезан
// по окну или карточке). Метки — проценты от ширины и высоты кадра.

export interface Снимок {
  src: string;
  w: number;
  h: number;
  marks: [number, number][];
}

export type ИмяСнимка =
  | "type"
  | "pat"
  | "check"
  | "listen"
  | "button"
  | "sheet"
  | "review"
  | "tasks"
  | "stat"
  | "dossier"
  | "hours"
  | "company";

export type Устройство = "телефон" | "компьютер";

type Набор<Имя extends string> = Record<Устройство, Record<Имя, Снимок>>;

export const СНИМКИ: {
  медицина: Набор<ИмяСнимка>;
  // У недвижимости нет диагностики, а разбор и статистика — общие с клиникой
  недвижимость: Набор<Exclude<ИмяСнимка, "button" | "sheet">>;
} = ${json(снимки)};
`;
  mkdirSync(dirname(OUT_TS), { recursive: true });
  writeFileSync(OUT_TS, ts);
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "probe") {
  await probe(rest[0], rest[1], rest[2]);
} else {
  // Разбор — последний разговор демо-менеджера с закрытой сделкой: на нём
  // видны и исход, и оценка, и точка роста
  const demo = "demo@podhod.tech";
  const сРазбором = await prisma.session.findFirst({
    where: { user: { email: demo }, review: { is: { outcome: "paid" } } },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!сРазбором) throw new Error("у демо-менеджера нет разговора с закрытой сделкой — запусти seed:demo");
  const клиника = {
    manager: demo,
    head: "head@podhod.tech",
    patient: "Тамара Михайловна",
    review: `/transcript/${сРазбором.id}`,
    карточка: "Клиника и услуги",
  };
  const недвижимость = {
    manager: process.env.HELP_REALTY_MANAGER || "m1-test-0918@example.com",
    head: process.env.HELP_REALTY_HEAD || "rop-test-0918@example.com",
    карточка: "Компания и прайс",
  };
  // DEVICE=телефон|компьютер — снять один набор (shots.ts тогда не пишется)
  const устройства = process.env.DEVICE ? [process.env.DEVICE] : ["телефон", "компьютер"];
  const снимки = { медицина: {}, недвижимость: {} };
  const failed = [];
  for (const device of устройства) {
    const c = await shoot("медицина", клиника, device);
    const r = await shoot("недвижимость", недвижимость, device);
    failed.push(...c.failed.map((n) => `медицина/${device}/${n}`), ...r.failed.map((n) => `недвижимость/${device}/${n}`));
    снимки.медицина[device] = c.result;
    // Разбор и статистика без отраслевых слов — у недвижимости те же снимки
    снимки.недвижимость[device] = { ...r.result, review: c.result.review, stat: c.result.stat };
  }
  if (process.env.ONLY || process.env.DEVICE) {
    console.log("\nONLY/DEVICE: shots.ts не тронут");
  } else if (failed.length) {
    console.log(`\nshots.ts не тронут: не снялись ${failed.join(", ")}`);
    process.exitCode = 1;
  } else {
    writeTs(снимки);
    console.log(`\nзаписан ${OUT_TS}`);
  }
  await prisma.$disconnect();
}
