// Оформление мест на подиуме «Статистики» отдела — общее для карточек
// на странице и для шапки модалки, чтобы место выглядело одинаково везде.
//
// Ключ — место в отделе. Всё, что ниже третьего, оформляется нейтрально:
// медалей только три.

/** Градиент баннера карточки и шапки модалки. */
export const PLACE_BANNER: Record<number, string> = {
  1: "bg-gradient-to-br from-podium-gold-banner-from to-podium-gold-banner-to",
  2: "bg-gradient-to-br from-podium-silver-banner-from to-podium-silver-banner-to",
  3: "bg-gradient-to-br from-podium-bronze-banner-from to-podium-bronze-banner-to",
};

const PILL_BASE =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[.03em] shadow-[0_2px_8px_-2px_rgba(20,40,38,.3)]";

/** Плашка с номером места. `other` — для всех, кто ниже третьего. */
export const PLACE_PILL: Record<number | "other", string> = {
  1: `${PILL_BASE} bg-gradient-to-br from-podium-gold-from to-podium-gold-to text-gold-text`,
  2: `${PILL_BASE} bg-gradient-to-br from-podium-silver-from to-podium-silver-to text-podium-silver-text`,
  3: `${PILL_BASE} bg-gradient-to-br from-podium-bronze-from to-podium-bronze-to text-podium-bronze-text`,
  other: `${PILL_BASE} border border-line bg-surface-card text-ink-muted`,
};

export function placeLabel(place: number): string {
  if (place === 1) return "★ 1 место";
  if (place === 2) return "2 место";
  if (place === 3) return "3 место";
  return `№${place}`;
}
