"use client";

// Раздел «Профиль»: фото, личные данные и смена пароля.
// Слева карточка с фото и выходом, справа прокручиваемые формы.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import AppShell, { PROFILE_UPDATED_EVENT } from "@/app/components/AppShell";
import Alert from "@/app/components/Alert";
import Button from "@/app/components/Button";
import Field from "@/app/components/Field";
import Spinner from "@/app/components/Spinner";
import { compressAvatar } from "@/lib/avatar";
import { initials } from "@/lib/format";

interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  clinic: string | null;
  avatarUpdatedAt: string | null;
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
          <div className="flex flex-1 justify-center py-16 text-ink-muted">
            <Spinner />
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
              <PersonalForm profile={profile} onChange={setProfile} />
              <PasswordForm />
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

function PersonalForm({ profile, onChange }: CardProps) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [email, setEmail] = useState(profile.email);
  const [jobTitle, setJobTitle] = useState(profile.jobTitle ?? "");
  const [clinic, setClinic] = useState(profile.clinic ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, jobTitle, clinic }),
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
        <Field
          label="Имя"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          autoComplete="given-name"
        />
        <Field
          label="Фамилия"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          autoComplete="family-name"
        />
        <Field
          label="E-mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <Field
          label="Должность"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Менеджер по продажам"
        />
        <Field
          label="Клиника"
          value={clinic}
          onChange={(e) => setClinic(e.target.value)}
          placeholder="Название клиники"
          className="col-span-2"
        />
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
    </form>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setDone(false);

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
      setCurrent("");
      setNew("");
      setRepeat("");
      setDone(true);
    } catch {
      setError("Не удалось обновить пароль");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-line bg-surface-card px-6 py-[22px]"
    >
      <div className="text-[15.5px] font-semibold text-ink">Смена пароля</div>
      <div className="mt-1 text-[13px] text-ink-subtle">
        Не менее 8 символов, буквы и цифры.
      </div>

      <div className="mt-4 flex flex-col gap-3.5">
        <Field
          label="Текущий пароль"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Новый пароль"
            type="password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            placeholder="Введите новый пароль"
            autoComplete="new-password"
          />
          <Field
            label="Повторите пароль"
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            placeholder="Повторите новый пароль"
            autoComplete="new-password"
          />
        </div>
      </div>

      {error && <Alert className="mt-4">{error}</Alert>}

      <div className="mt-[18px] flex items-center justify-end gap-3">
        {done && !error && (
          <span className="text-[13px] font-medium text-good">
            Пароль обновлён
          </span>
        )}
        <Button type="submit" loading={busy} className="px-6 py-[11px] text-[14.5px]">
          Обновить пароль
        </Button>
      </div>
    </form>
  );
}
