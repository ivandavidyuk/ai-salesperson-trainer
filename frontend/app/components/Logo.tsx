// Логотип продукта: вордмарк «podhod» + пилюля «.tech».
// Шрифт — Manrope (font-brand), используется только здесь.

interface LogoProps {
  /** На каком фоне размещается логотип. */
  tone?: "on-brand" | "on-light";
  className?: string;
}

export default function Logo({ tone = "on-light", className = "" }: LogoProps) {
  // На тиловой панели — белый вордмарк и белая пилюля с тиловым текстом,
  // на светлом фоне — наоборот.
  const wordClass = tone === "on-brand" ? "text-white" : "text-ink";
  const pillClass =
    tone === "on-brand" ? "bg-white text-brand" : "bg-brand text-white";

  return (
    <span
      className={`inline-flex items-baseline gap-px font-brand ${className}`}
    >
      <span className={`text-[22px] font-extrabold ${wordClass}`}>podhod</span>
      <span
        className={`relative -top-0.5 rounded-[5px] px-1.5 py-[3px] text-[15px] font-semibold leading-none ${pillClass}`}
      >
        .tech
      </span>
    </span>
  );
}
