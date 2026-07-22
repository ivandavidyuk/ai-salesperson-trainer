// Логотип продукта: вордмарк «podhod» + пилюля «.tech».
// Шрифт — Manrope (font-brand), используется только здесь.

interface LogoProps {
  /** На каком фоне размещается логотип. */
  tone?: "on-brand" | "on-light";
  /** Масштаб: sm — боковое меню, md — по умолчанию, lg — экран входа. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

// Размеры из макетов: у каждого экрана свой масштаб логотипа
const SIZES = {
  sm: { word: "text-[18px]", pill: "text-[12px] rounded-[4px] px-[5px] py-[2px] -top-0.5" },
  md: { word: "text-[22px]", pill: "text-[15px] rounded-[5px] px-1.5 py-[3px] -top-0.5" },
  lg: { word: "text-[30px]", pill: "text-[19px] rounded-md px-2 py-[3px] -top-[3px]" },
} as const;

export default function Logo({
  tone = "on-light",
  size = "md",
  className = "",
}: LogoProps) {
  // На тиловой панели — белый вордмарк и белая пилюля с тиловым текстом,
  // на светлом фоне — тёмно-тиловый вордмарк и яркая пилюля.
  const wordClass = tone === "on-brand" ? "text-white" : "text-brand-deep";
  const pillClass =
    tone === "on-brand" ? "bg-white text-brand" : "bg-brand-bright text-white";
  const scale = SIZES[size];

  return (
    <span
      className={`inline-flex items-baseline gap-px font-brand ${className}`}
    >
      <span className={`font-extrabold ${scale.word} ${wordClass}`}>podhod</span>
      <span
        className={`relative font-semibold leading-none ${scale.pill} ${pillClass}`}
      >
        .tech
      </span>
    </span>
  );
}
