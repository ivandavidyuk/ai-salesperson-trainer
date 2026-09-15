// Общие классы и переходы лендинга.
//
// Телефон — основа, десктоп включается с lg (1024 px): между 768 и 1024
// двухколоночные секции не помещаются, а одна колонка на планшете
// ограничена шириной, чтобы строки не растягивались на весь экран.

/** Боковые поля секции */
export const SECTION_X = "px-5 lg:px-[72px]";

/** Колонка контента внутри секции */
export const INNER = "mx-auto w-full max-w-[640px] lg:max-w-[1296px]";

/** Секция = экран: на телефоне почти весь, на десктопе целиком */
export const SCREEN = "flex min-h-[85svh] flex-col justify-center lg:min-h-[100svh]";

/** Заголовок секции */
export const H2 =
  "font-semibold text-ink [text-wrap:pretty] text-[34px] leading-[1.1] tracking-[-0.02em] lg:text-[clamp(44px,4vw,58px)] lg:leading-[1.08] lg:tracking-[-0.03em]";

/** Главная кнопка — одна на всю страницу */
export const CTA =
  "rounded-[12px] bg-brand px-[22px] py-[15px] text-[17px] font-semibold text-white transition-colors hover:bg-brand-hover lg:rounded-[13px] lg:px-[30px] lg:py-[18px] lg:text-[19px]";

/** Якорь формы заявки */
export const FORM_ID = "zayavka";

/** Якорь секции «+20% — это сколько в деньгах?» */
export const MONEY_ID = "dengi";

export function scrollToSection(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}
