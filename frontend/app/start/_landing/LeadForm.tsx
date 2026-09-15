"use client";

// Форма заявки на демо-доступ. Проверка полей общая с роутом
// (lib/leads.ts); здесь — только то, что можно сказать до отправки.

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { TEAM_SIZES, type TeamSize } from "@/lib/leads";
import { CTA, FORM_ID, SECTION_X } from "./ui";

type Status = "idle" | "sending" | "sent";

const INPUT =
  "w-full rounded-[11px] border border-line-strong bg-surface-card px-4 py-3.5 text-[17px] text-ink outline-none transition-[box-shadow,border-color] placeholder:text-ink-placeholder focus:border-brand focus:ring-4 focus:ring-brand/20 focus:ring-offset-0";
const LABEL = "mb-[7px] block text-[14px] text-ink-muted";
const H2_FORM =
  "text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink [text-wrap:pretty] lg:text-[clamp(44px,4vw,58px)] lg:leading-[1.08] lg:tracking-[-0.03em]";

export default function LeadForm() {
  const [name, setName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [industry, setIndustry] = useState("");
  const [teamSize, setTeamSize] = useState<TeamSize | null>(null);
  const [consent, setConsent] = useState(false);
  // Ловушка для ботов: поле спрятано от людей
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name.trim() || !telegram.trim() || !industry.trim()) {
      setError("Заполните имя, Telegram и сферу компании");
      return;
    }
    if (!teamSize) {
      setError("Выберите, сколько менеджеров в отделе");
      return;
    }

    setStatus("sending");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, telegram, industry, teamSize, consent, website }),
      });
      if (res.ok) {
        setStatus("sent");
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Не получилось отправить заявку. Попробуйте ещё раз");
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте ещё раз");
    }
    setStatus("idle");
  }

  return (
    <section
      id={FORM_ID}
      className={`${SECTION_X} flex min-h-[85svh] scroll-mt-14 flex-col items-center justify-center border-t border-line bg-surface-card pb-14 pt-11 lg:min-h-[100svh] lg:scroll-mt-[76px] lg:py-[120px]`}
    >
      <div className="w-full max-w-[520px]">
        {status === "sent" ? (
          <div className="text-center">
            <div className="mx-auto flex h-[68px] w-[68px] items-center justify-center rounded-full bg-good-surface text-good">
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </div>
            <h2 className={`mt-7 ${H2_FORM}`} role="status">
              Спасибо! Дмитрий напишет вам в Telegram
            </h2>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="relative">
            <h2 className={`mb-8 lg:mb-11 ${H2_FORM}`}>Попробуйте тренажёр сами</h2>

            <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
              <label>
                Сайт
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </label>
            </div>

            <div className="flex flex-col gap-5">
              <label className="block">
                <span className={LABEL}>Имя</span>
                <input
                  type="text"
                  autoComplete="given-name"
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={INPUT}
                />
              </label>
              <label className="block">
                <span className={LABEL}>Telegram</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="@имя или номер"
                  maxLength={100}
                  value={telegram}
                  onChange={(event) => setTelegram(event.target.value)}
                  className={INPUT}
                />
              </label>
              <label className="block">
                <span className={LABEL}>Сфера компании</span>
                <input
                  type="text"
                  placeholder="стоматология, автосалон…"
                  maxLength={100}
                  value={industry}
                  onChange={(event) => setIndustry(event.target.value)}
                  className={INPUT}
                />
              </label>

              <fieldset>
                <legend className="mb-[9px] block text-[14px] text-ink-muted">
                  Сколько менеджеров в отделе продаж
                </legend>
                <div className="flex flex-wrap gap-2.5">
                  {TEAM_SIZES.map((size) => {
                    const on = size === teamSize;
                    return (
                      <button
                        key={size}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setTeamSize(size)}
                        className={`rounded-full border px-4 py-2.5 text-[15px] transition-colors lg:px-5 lg:py-[11px] lg:text-[16px] ${
                          on
                            ? "border-brand bg-brand-soft font-semibold text-brand-hover"
                            : "border-line-strong bg-surface-card font-medium text-ink hover:border-brand"
                        }`}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-brand lg:h-[21px] lg:w-[21px]"
                />
                <span className="text-[14.5px] leading-[1.45] text-ink-label lg:text-[16px]">
                  Согласен на обработку{" "}
                  <Link href="/privacy" target="_blank" className="text-brand underline">
                    персональных данных
                  </Link>
                </span>
              </label>

              {error && (
                <p role="alert" className="text-[15.5px] leading-[1.45] text-danger-text">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!consent || status === "sending"}
                className={`${CTA} disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text`}
              >
                {status === "sending" ? "Отправляем…" : "Получить демо-доступ"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
