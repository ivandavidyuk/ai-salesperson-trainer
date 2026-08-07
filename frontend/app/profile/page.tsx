"use client";

// Раздел «Профиль»: фото, личные данные и смена пароля.
// Слева карточка с фото и выходом, справа прокручиваемые формы.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import AppShell, { PROFILE_UPDATED_EVENT } from "@/app/components/AppShell";
import Alert from "@/app/components/Alert";
import Button from "@/app/components/Button";
import Loader from "@/app/components/Loader";
import { compressAvatar } from "@/lib/avatar";
import { initials } from "@/lib/format";

interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  // Роль решает, показывать ли карточку клиники: отрасль и прайс —
  // данные организации, менеджеру их менять нечего
  role: "manager" | "head";
  jobTitle: string | null;
  clinic: string | null;
  avatarUpdatedAt: string | null;
}

interface ServiceRow {
  name: string;
  price: string;
  description: string;
}

interface Organization {
  id: string;
  name: string;
  industry: string;
  services: ServiceRow[];
  casesTotal: number;
  casesReady: number;
  // Идёт ли сборка прямо сейчас. Сервер отдаёт не голый флаг, а живость:
  // задачу мог оборвать рестарт, и снять флаг тогда уже некому
  casesRunning: boolean;
}

/** Прогресс пересборки: сколько пациентов готово из скольких. */
interface Progress {
  ready: number;
  total: number;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          if (res.status === 401) router.push("/login");
          return;
        }
        const data = (await res.json()) as Profile;
        if (!cancelled) setProfile(data);
      } catch {
        if (!cancelled) setLoadError("Не удалось загрузить профиль");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <AppShell title="Профиль">
      <div className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 gap-[22px] px-10 py-[26px]">
        {!profile && !loadError && (
          <div className="flex flex-1 justify-center py-16">
            <Loader />
          </div>
        )}

        {loadError && (
          <p className="flex-1 py-16 text-center text-sm text-danger-text">
            {loadError}
          </p>
        )}

        {profile && (
          <>
            <AvatarCard profile={profile} onChange={setProfile} />

            <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1.5">
              {profile.role === "head" && <ClinicForm />}
              <PersonalForm profile={profile} onChange={setProfile} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

// Топбар живёт в AppShell со своей копией данных — сообщаем ему,
// что имя или фото поменялись
function notifyProfileUpdated() {
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
}

// Ссылка на фото с версией: после смены адрес другой, поэтому вечный
// кеш на роуте картинки не мешает увидеть новое фото
function avatarUrl(profile: Profile): string | null {
  if (!profile.avatarUpdatedAt) return null;
  return `/api/users/${profile.id}/avatar?v=${encodeURIComponent(profile.avatarUpdatedAt)}`;
}

interface CardProps {
  profile: Profile;
  onChange: (profile: Profile) => void;
}

function AvatarCard({ profile, onChange }: CardProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const photo = avatarUrl(profile);

  async function handleFile(file: File) {
    setError("");
    setBusy(true);
    try {
      const compressed = await compressAvatar(file);
      const form = new FormData();
      // Имя файла обязательно: без него сервер получит строку, а не File
      form.append("file", compressed, "avatar.jpg");

      const res = await fetch("/api/profile/avatar", {
        method: "PUT",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось загрузить фото");
        return;
      }
      onChange({ ...profile, avatarUpdatedAt: data.avatarUpdatedAt });
      notifyProfileUpdated();
    } catch {
      setError("Не удалось обработать файл");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!res.ok) {
        setError("Не удалось удалить фото");
        return;
      }
      onChange({ ...profile, avatarUpdatedAt: null });
      notifyProfileUpdated();
    } catch {
      setError("Не удалось удалить фото");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex w-[296px] shrink-0 flex-col gap-4">
      <div className="flex flex-col items-center rounded-2xl border border-line bg-surface-card px-[22px] py-[26px] text-center">
        <div className="relative">
          <div className="h-[118px] w-[118px] overflow-hidden rounded-full border-[3px] border-surface-accent">
            {photo ? (
              // Обычный img: next/image ради картинки из собственного роута
              // только добавил бы конфигурацию
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt="Фото профиля"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-brand-soft text-[38px] font-semibold text-brand">
                {initials(`${profile.firstName} ${profile.lastName}`)}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Изменить фото"
            aria-label="Изменить фото"
            className="absolute bottom-0.5 right-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-full border-[3px] border-surface-card bg-brand text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-brand-muted"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
              <circle cx="12" cy="13" r="3.4" />
            </svg>
          </button>
        </div>

        <div className="mt-4 text-lg font-semibold text-ink">
          {profile.firstName} {profile.lastName}
        </div>
        <div className="mt-[3px] text-[13.5px] text-ink-subtle">
          {profile.jobTitle || "Должность не указана"}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Сбрасываем значение: иначе повторный выбор того же файла
            // не вызовет onChange
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mt-[18px] w-full rounded-input bg-brand py-[11px] text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-brand-muted"
        >
          {busy ? "Загружаем…" : "Изменить фото"}
        </button>

        {photo && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="mt-2 w-full rounded-input border border-danger-border bg-surface-card py-2.5 text-[13.5px] font-medium text-danger-strong transition-colors hover:bg-danger-wash disabled:cursor-not-allowed"
          >
            Удалить фото
          </button>
        )}

        <div className="mt-3 text-[11.5px] leading-snug text-locked-text">
          JPG или PNG, до 5 МБ.
          <br />
          Рекомендуемый размер 400×400.
        </div>

        {error && <Alert className="mt-3 text-left">{error}</Alert>}
      </div>

      <button
        type="button"
        onClick={handleLogout}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-card py-[13px] text-sm font-semibold text-danger-strong transition-colors hover:bg-danger-wash"
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
          aria-hidden="true"
        >
          <path d="M15 4h3a1 1 0 011 1v14a1 1 0 01-1 1h-3" />
          <path d="M10 8l-4 4 4 4" />
          <path d="M6 12h11" />
        </svg>
        Выйти из аккаунта
      </button>
    </div>
  );
}

// Личные данные вместе со сменой пароля.
//
// Отдельной карточки «Смена пароля» больше нет: по макету пароль живёт здесь
// строкой с кнопкой «Изменить», которая разворачивает форму на месте. Так
// правая колонка перестала быть лестницей из трёх почти одинаковых карточек.
function PersonalForm({ profile, onChange }: CardProps) {
  // Имя и фамилия — одно поле, как в макете, а в базе две колонки. Режем
  // по первому пробелу: «Анна Мария Петрова» станет именем «Анна» и фамилией
  // «Мария Петрова». Не идеально, зато устойчиво — обратная склейка даёт
  // ровно исходную строку, и повторное сохранение ничего не портит
  const [fullName, setFullName] = useState(
    `${profile.firstName} ${profile.lastName}`.trim()
  );
  const [email, setEmail] = useState(profile.email);
  const [jobTitle, setJobTitle] = useState(profile.jobTitle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);

    const trimmed = fullName.trim();
    const space = trimmed.indexOf(" ");
    if (space < 0) {
      setError("Укажите имя и фамилию");
      return;
    }
    const firstName = trimmed.slice(0, space);
    const lastName = trimmed.slice(space + 1).trim();

    setBusy(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, jobTitle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось сохранить");
        return;
      }
      onChange({ ...profile, ...data });
      notifyProfileUpdated();
      setSaved(true);
    } catch {
      setError("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-line bg-surface-card px-6 py-[22px]"
    >
      <div className="text-[15.5px] font-semibold text-ink">Личные данные</div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5">
        <div>
          <FieldLabel>Имя и фамилия</FieldLabel>
          <TextInput
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div>
          <FieldLabel>E-mail</FieldLabel>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div>
          <FieldLabel>Должность</FieldLabel>
          <TextInput
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="Менеджер по продажам"
          />
        </div>
        <div>
          <FieldLabel>Пароль</FieldLabel>
          {/* Пока форма развёрнута, ячейка остаётся на месте, но пустеет:
              управление уезжает вниз, к самим полям, и второй кнопки,
              делающей то же самое, не появляется */}
          <div className="flex h-[43px] items-center gap-3 rounded-[11px] border border-line-strong pl-3.5 pr-1.5">
            <span className="min-w-0 flex-1 text-[13.5px] text-ink-muted">••••••••</span>
            {!changingPassword && (
              <button
                type="button"
                onClick={() => setChangingPassword(true)}
                className="shrink-0 whitespace-nowrap rounded-lg border border-line-strong bg-surface-card px-3.5 py-[7px] text-[13px] font-semibold text-ink transition-colors hover:bg-surface-bubble"
              >
                Изменить
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <Alert className="mt-4">{error}</Alert>}

      <div className="mt-[18px] flex items-center justify-end gap-3">
        {saved && !error && (
          <span className="text-[13px] font-medium text-good">Сохранено</span>
        )}
        <Button type="submit" loading={busy} className="px-6 py-[11px] text-[14.5px]">
          Сохранить
        </Button>
      </div>

      {changingPassword && (
        <PasswordFields onDone={() => setChangingPassword(false)} />
      )}
    </form>
  );
}

// Смена пароля. Живёт внутри карточки личных данных и разворачивается
// по кнопке: отдельной карточкой она занимала треть колонки ради действия,
// которое совершают раз в год.
//
// Своей формы у неё нет — она внутри формы личных данных, и вложенные <form>
// в HTML недопустимы. Поэтому отправка по кнопке, а не по submit.
function PasswordFields({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    // Совпадение проверяем здесь: серверу второй экземпляр не нужен
    if (newPassword !== repeat) {
      setError("Пароли не совпадают");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось обновить пароль");
        return;
      }
      onDone();
    } catch {
      setError("Не удалось обновить пароль");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      // Поля лежат внутри формы личных данных, и Enter в них отправил бы её —
      // пользователь менял пароль, а сохранились бы имя и почта
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!busy) void handleSave();
      }}
      className="mt-5 border-t border-line-soft pt-[18px]"
    >
      <div className="text-[13.5px] font-semibold text-ink">Смена пароля</div>
      <p className="mt-1 text-[12.5px] text-ink-subtle">
        Не менее 8 символов, буквы и цифры.
      </p>

      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5">
        <div className="col-span-2">
          <FieldLabel>Текущий пароль</FieldLabel>
          <TextInput
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div>
          <FieldLabel>Новый пароль</FieldLabel>
          <TextInput
            type="password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div>
          <FieldLabel>Повторите пароль</FieldLabel>
          <TextInput
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
          />
        </div>
      </div>

      {error && <Alert className="mt-3.5">{error}</Alert>}

      <div className="mt-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onDone}
          className="text-[13.5px] font-medium text-ink-muted hover:text-ink"
        >
          Отмена
        </button>
        <Button
          type="button"
          onClick={handleSave}
          loading={busy}
          className="px-5 py-[10px] text-[14px]"
        >
          Обновить пароль
        </Button>
      </div>
    </div>
  );
}

// Подпись поля в стиле макета: моноширинная, капсом, тиловая.
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[.1em] text-brand-hover">
      {children}
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full rounded-[11px] border border-line-strong px-3.5 py-[11px] text-[14.5px] text-ink outline-none transition-colors placeholder:text-ink-placeholder focus:border-brand focus:ring-[3px] focus:ring-brand-soft ${className}`}
    />
  );
}

// Карточка клиники: отрасль и услуги. По ним собирается слой «случай»
// у пациентов, поэтому от качества этих данных зависит, во что играет
// тренажёр — карточка стоит первой в колонке.
function ClinicForm() {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Пересборка: null — не идёт, иначе прогресс с сервера
  const [progress, setProgress] = useState<Progress | null>(null);
  const [outcome, setOutcome] = useState<"done" | "failed" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/organization");
    if (!res.ok) return null;
    return (await res.json()) as Organization | null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await load();
      if (cancelled) return;
      if (data) {
        setSaved(data);
        setName(data.name);
        setIndustry(data.industry);
        setServices(data.services);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Пока сборка идёт, спрашиваем прогресс. Ждать ответа PUT нельзя: сотня
  // пациентов — это минуты, а такой запрос оборвут и Caddy, и браузер
  useEffect(() => {
    if (progress === null) return;
    const timer = setInterval(async () => {
      const data = await load();
      if (!data) return;
      setSaved(data);
      setProgress({ ready: data.casesReady, total: data.casesTotal });
      // Конец сборки виден по флагу, а не по счётчику: счётчик замирает
      // и когда часть пациентов не собралась, и лоадер крутился бы вечно.
      // Флаг снимает сама сборка, а протухший гасит сервер по времени
      if (!data.casesRunning) {
        setProgress(null);
        setOutcome(data.casesReady >= data.casesTotal ? "done" : "failed");
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [progress === null, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const filled =
    name.trim() !== "" &&
    industry.trim() !== "" &&
    services.length > 0 &&
    services.every((s) => s.name.trim() && s.price.trim());
  const changed =
    !saved ||
    saved.name !== name ||
    saved.industry !== industry ||
    JSON.stringify(saved.services) !== JSON.stringify(services);

  async function handleSave() {
    setError("");
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/organization", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, industry, services }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось сохранить");
        return;
      }
      setSaved(data);
      setServices(data.services ?? []);
      setProgress({ ready: data.casesReady, total: data.casesTotal });
    } catch {
      setError("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    setOutcome(null);
    await fetch("/api/organization/rebuild", { method: "POST" });
    const data = await load();
    if (data) setProgress({ ready: data.casesReady, total: data.casesTotal });
  }

  function stopWaiting() {
    // Перестали ждать — это не обрыв: сборка на сервере продолжается.
    // Поэтому окно просто закрывается, а «Сборка прервалась» показывается
    // только когда сборка правда кончилась — это решает флаг с сервера.
    // Сколько собрано, видно по плашке в карточке
    setProgress(null);
    setOutcome(null);
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-line bg-surface-card px-6 py-[22px]">
        <div className="text-[15.5px] font-semibold text-ink">Клиника и услуги</div>
        <p className="mt-3 text-[13.5px] text-ink-muted">Загружаем…</p>
      </div>
    );
  }

  const done = saved && saved.casesTotal > 0 && saved.casesReady >= saved.casesTotal;
  const partial = saved && saved.casesTotal > 0 && saved.casesReady < saved.casesTotal;

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface-card">
        {outcome === "done" && done && (
          <div className="flex items-center gap-2.5 border-b border-good-surface bg-good-surface px-6 py-[11px] text-[13.5px] font-medium text-brand-hover">
            Пациенты пересобраны под «{saved.industry}» — все {saved.casesTotal}.
          </div>
        )}
        {/* Плашка говорит о состоянии, а не о нажатой кнопке: недособранная
            организация должна быть видна и после перезагрузки страницы,
            иначе часть пациентов молча останется с чужой отраслью */}
        {partial && !progress && (
          <div className="flex items-start gap-2.5 border-b border-warn-border bg-warn-surface px-6 py-[13px] text-[13.5px] leading-normal text-warn">
            <div>
              <span className="font-semibold">
                Пересобрали {saved.casesReady} из {saved.casesTotal}.
              </span>{" "}
              Остальные пока с прежними историями.
              <button
                type="button"
                onClick={handleRetry}
                className="ml-1.5 font-semibold underline"
              >
                Собрать заново
              </button>
            </div>
          </div>
        )}

        <div className="px-6 pb-6 pt-[22px]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[15.5px] font-semibold text-ink">Клиника и услуги</div>
              <p className="mt-1 max-w-[520px] text-[13px] leading-normal text-ink-muted">
                По этому описанию тренажёр собирает пациентов: с чем они приходят,
                что спрашивают и о чём торгуются.
              </p>
            </div>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-brand-soft px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[.06em] text-brand-hover">
              Только руководитель
            </span>
          </div>

          <div className="mt-[18px] grid grid-cols-2 gap-x-4 gap-y-3.5">
            <div>
              <FieldLabel>Название клиники</FieldLabel>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Как называется клиника"
              />
            </div>
            <div>
              <FieldLabel>Специализация клиники</FieldLabel>
              <TextInput
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Например: стоматология — терапия и имплантация"
              />
              <p className="mt-1.5 text-[11.5px] leading-snug text-ink-muted">
                Укажите точную отрасль вашей компании. От этого зависит качество
                генерации карточек пациентов
              </p>
            </div>
          </div>

          <div className="mt-5">
            <FieldLabel>Услуги</FieldLabel>
            {services.length > 0 ? (
              <div className="flex items-center gap-4 rounded-xl border border-line-soft bg-surface px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold text-ink">
                    {pluralServices(services.length)}
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-ink-muted">
                    {services.map((s) => s.name || "Без названия").join(" · ")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="shrink-0 whitespace-nowrap rounded-[9px] border border-line-strong bg-surface-card px-4 py-2.5 text-[13.5px] font-semibold text-brand-hover transition-colors hover:bg-surface-bubble"
                >
                  Показать все услуги
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-4 rounded-xl border-[1.5px] border-dashed border-line-accent bg-surface px-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold text-ink">
                    Пока ни одной услуги
                  </div>
                  <div className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">
                    Добавьте услуги, которые оказывает ваша клиника. Это напрямую
                    влияет на карточки пациентов
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setServices([{ name: "", price: "", description: "" }]);
                    setModalOpen(true);
                  }}
                  className="shrink-0 whitespace-nowrap rounded-[9px] bg-brand px-4 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-hover"
                >
                  Добавить первую услугу
                </button>
              </div>
            )}
          </div>

          {error && <Alert className="mt-4">{error}</Alert>}

          <div className="mt-5 flex items-center justify-between gap-5 border-t border-line-soft pt-[18px]">
            <p className="max-w-[520px] text-[12.5px] leading-normal text-ink-muted">
              {!filled
                ? "Чтобы сохранить, заполните название и специализацию клиники, а в каждой услуге — название и цену."
                : !changed
                  ? "Изменений нет — пациенты уже собраны по этим данным."
                  : "После сохранения тренажёр пересоберёт всех пациентов под вашу специализацию. На двадцати пациентах это занимает несколько минут — страницу можно закрыть, сборка не прервётся."}
            </p>
            <Button
              type="button"
              onClick={handleSave}
              loading={busy}
              disabled={!filled || !changed}
              className="shrink-0 px-6 py-[11px] text-[14.5px]"
            >
              Сохранить
            </Button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <ServicesModal
          services={services}
          onChange={setServices}
          onClose={() => setModalOpen(false)}
        />
      )}
      {progress && <RebuildModal progress={progress} industry={industry} onGiveUp={stopWaiting} />}
      {outcome === "failed" && partial && !progress && (
        <FailedModal
          ready={saved.casesReady}
          total={saved.casesTotal}
          onLater={() => setOutcome(null)}
          onRetry={handleRetry}
        />
      )}
    </>
  );
}

function pluralServices(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} услуга`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} услуги`;
  return `${n} услуг`;
}

// Модальное окно со списком услуг.
//
// Список вынесен из карточки в окно намеренно: три поля разной длины в сетку
// карточки не выстраиваются, а здесь пара «крупное слева / цена справа»
// читается сверху вниз и не ломается ни на трёх словах, ни на пятнадцати.
function ServicesModal({
  services,
  onChange,
  onClose,
}: {
  services: ServiceRow[];
  onChange: (rows: ServiceRow[]) => void;
  onClose: () => void;
}) {
  // Удаление без подтверждения: подтверждать каждую строку — издевательство,
  // а случайно снесённая строка это потерянная работа. Поэтому «Вернуть»
  const [removed, setRemoved] = useState<{ row: ServiceRow; at: number } | null>(null);

  function update(index: number, patch: Partial<ServiceRow>) {
    onChange(services.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-10">
      <div className="flex max-h-full w-[760px] flex-col overflow-hidden rounded-[18px] bg-surface-card shadow-2xl">
        <div className="flex shrink-0 items-start gap-4 border-b border-line-soft px-7 pb-[18px] pt-6">
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-semibold text-ink">Услуги клиники</div>
            <p className="mt-1 text-[13px] leading-normal text-ink-muted">
              Добавьте услуги, которые оказывает ваша клиника. Это напрямую влияет
              на карточки пациентов
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-ink-muted transition-colors hover:bg-surface-bubble"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-7 pb-1 pt-4">
          {services.map((service, index) => (
            <div
              key={index}
              className="group shrink-0 rounded-xl border border-line-soft p-3 transition-colors hover:border-line-strong"
            >
              <div className="flex items-start gap-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    <input
                      value={service.name}
                      onChange={(e) => update(index, { name: e.target.value })}
                      placeholder="Название услуги"
                      className="min-w-0 flex-1 rounded-[9px] border border-line-strong px-3 py-2 text-[14.5px] font-semibold text-ink outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
                    />
                    <input
                      value={service.price}
                      onChange={(e) => update(index, { price: e.target.value })}
                      placeholder="Цена"
                      className="w-[236px] shrink-0 rounded-[9px] border border-line-strong px-3 py-2 text-right font-mono text-[13px] text-brand-hover outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
                    />
                  </div>
                  <input
                    value={service.description}
                    onChange={(e) => update(index, { description: e.target.value })}
                    placeholder="Что входит: сколько визитов, что включено"
                    className="rounded-[9px] border border-line-strong px-3 py-2 text-[13px] text-ink-muted outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
                  />
                </div>
                <button
                  type="button"
                  title="Удалить услугу"
                  onClick={() => {
                    setRemoved({ row: service, at: index });
                    onChange(services.filter((_, i) => i !== index));
                  }}
                  className="mt-1 h-[30px] w-[30px] shrink-0 rounded-lg text-ink-icon opacity-0 transition hover:bg-danger-surface hover:text-danger-text group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          {services.length === 0 && (
            <div className="shrink-0 rounded-xl border-[1.5px] border-dashed border-line-accent bg-surface p-6 text-center">
              <div className="text-[14px] font-semibold text-ink">Список пуст</div>
              <div className="mt-1 text-[13px] text-ink-muted">
                Хватит и одной услуги, чтобы попробовать.
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => onChange([...services, { name: "", price: "", description: "" }])}
            className="mt-0.5 shrink-0 self-start rounded-[9px] border border-line-strong bg-surface-card px-4 py-2.5 text-[13.5px] font-semibold text-brand-hover transition-colors hover:bg-surface-bubble"
          >
            + Добавить услугу
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-3.5 border-t border-line-soft px-7 pb-5 pt-4">
          {removed ? (
            <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-surface-bubble px-3 py-2.5">
              <span className="truncate text-[13.5px] text-ink-body">
                Удалили «{removed.row.name || "новая услуга"}»
              </span>
              <button
                type="button"
                onClick={() => {
                  const rows = services.slice();
                  rows.splice(removed.at, 0, removed.row);
                  onChange(rows);
                  setRemoved(null);
                }}
                className="ml-auto shrink-0 text-[13.5px] font-semibold text-brand-hover"
              >
                Вернуть
              </button>
            </div>
          ) : (
            <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-muted">
              Изменения попадут в тренажёр после «Сохранить» в профиле.
            </p>
          )}
          <Button
            type="button"
            onClick={onClose}
            className="shrink-0 px-6 py-[11px] text-[14px]"
          >
            Готово
          </Button>
        </div>
      </div>
    </div>
  );
}

// Окно ожидания. Тревогу снимает не смягчённая формулировка, а понятность:
// вместо «не закрывайте окно» — что именно случится, если закрыть.
function RebuildModal({
  progress,
  industry,
  onGiveUp,
}: {
  progress: Progress;
  industry: string;
  onGiveUp: () => void;
}) {
  const pct = progress.total > 0 ? Math.round((progress.ready / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50">
      <div className="w-[520px] rounded-[18px] bg-surface-card px-[34px] pb-7 pt-8 shadow-2xl">
        <div className="flex items-center gap-4">
          <Loader />
          <div>
            <div className="text-[18px] font-semibold text-ink">
              Собираем пациентов под «{industry}»
            </div>
            <div className="mt-0.5 text-[13.5px] text-ink-muted">
              Готово {progress.ready} из {progress.total}
            </div>
          </div>
        </div>

        <div className="mt-[22px] h-1.5 overflow-hidden rounded-full bg-line-soft">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Сборка живёт на сервере, а не в этой вкладке: закрытие браузера
            её не трогает. Раньше здесь просили не закрывать вкладку — обещание
            было ложным и стоило руководителю двадцати минут сидения над
            страницей, которая только смотрит */}
        <p className="mt-[18px] text-[13px] leading-relaxed text-ink-muted">
          Сборка идёт на сервере — вкладку можно закрыть, она не прервётся.
          Заглянете сюда позже, прогресс и результат будут на этой странице.
        </p>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onGiveUp}
            className="text-[13.5px] font-medium text-ink-muted hover:text-ink"
          >
            Перестать ждать
          </button>
        </div>
      </div>
    </div>
  );
}

// Обрыв — не ошибка, а промежуточный результат: сколько собрано, сколько нет,
// чем это грозит и кнопка продолжить.
function FailedModal({
  ready,
  total,
  onLater,
  onRetry,
}: {
  ready: number;
  total: number;
  onLater: () => void;
  onRetry: () => void;
}) {
  const pct = total > 0 ? (ready / total) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50">
      <div className="w-[520px] rounded-[18px] bg-surface-card px-[34px] pb-7 pt-8 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-warn-surface text-[20px] text-warn">
            !
          </div>
          <div>
            <div className="text-[18px] font-semibold text-ink">Сборка прервалась</div>
            <div className="mt-0.5 text-[13.5px] text-ink-muted">
              Успели {ready} из {total}
            </div>
          </div>
        </div>

        <div className="mt-[22px] flex h-1.5 overflow-hidden rounded-full bg-line-soft">
          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
          <div className="h-full flex-1 bg-warn-border" />
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-ink-muted">
          <span>{ready} — собраны</span>
          <span>{total - ready} — не собраны</span>
        </div>

        <p className="mt-4 text-[13.5px] leading-relaxed text-ink-muted">
          Часть пациентов осталась несобранной. Повторите попытку — сборка
          продолжит с того места, где остановилась.
        </p>

        <div className="mt-[22px] flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onLater}
            className="rounded-[10px] border border-line-strong bg-surface-card px-5 py-[11px] text-[14px] font-semibold text-ink transition-colors hover:bg-surface-bubble"
          >
            Позже
          </button>
          <Button type="button" onClick={onRetry} className="px-[22px] py-[11px] text-[14px]">
            Собрать заново
          </Button>
        </div>
      </div>
    </div>
  );
}
