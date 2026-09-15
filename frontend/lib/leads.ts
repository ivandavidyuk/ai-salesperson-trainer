// Заявка на демо-доступ с лендинга: поля и их проверка.
//
// Общая для формы на /start и для роута /api/leads: варианты размера
// отдела должны совпадать буква в букву, иначе форма отправит значение,
// которое роут отвергнет.

export const TEAM_SIZES = ["1–2", "3–5", "6–15", "больше 15"] as const;

export type TeamSize = (typeof TEAM_SIZES)[number];

/** Потолок длины текстового поля: имя, ник и сфера в него укладываются с запасом */
export const FIELD_MAX = 100;

export interface LeadInput {
  name: string;
  telegram: string;
  industry: string;
  teamSize: TeamSize;
}

export type ParsedLead =
  | { kind: "ok"; lead: LeadInput }
  | { kind: "invalid"; error: string }
  // Сработала ловушка для ботов: отвечаем успехом и ничего не сохраняем,
  // чтобы бот не понял, что его отсеяли
  | { kind: "trap" };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isTeamSize(value: unknown): value is TeamSize {
  return TEAM_SIZES.some((size) => size === value);
}

export function parseLead(body: unknown): ParsedLead {
  if (!body || typeof body !== "object") {
    return { kind: "invalid", error: "Не переданы данные заявки" };
  }
  const data = body as Record<string, unknown>;

  // Поле скрыто от людей — заполняют его только боты
  if (text(data.website) !== "") {
    return { kind: "trap" };
  }

  const name = text(data.name);
  const telegram = text(data.telegram);
  const industry = text(data.industry);

  if (!name || !telegram || !industry) {
    return { kind: "invalid", error: "Заполните имя, Telegram и сферу компании" };
  }
  if ([name, telegram, industry].some((value) => value.length > FIELD_MAX)) {
    return { kind: "invalid", error: "Слишком длинное значение в одном из полей" };
  }
  if (!isTeamSize(data.teamSize)) {
    return { kind: "invalid", error: "Выберите, сколько менеджеров в отделе" };
  }
  if (data.consent !== true) {
    return {
      kind: "invalid",
      error: "Нужно согласие на обработку персональных данных",
    };
  }

  return { kind: "ok", lead: { name, telegram, industry, teamSize: data.teamSize } };
}
