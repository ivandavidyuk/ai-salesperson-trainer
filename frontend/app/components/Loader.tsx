// Лоадер для загрузки страниц и секций: три тиловые точки, поднимающиеся
// по очереди. Перекликается с точкой на кнопках «Начать» и с индикатором
// речи в разговоре — загрузка выглядит частью того же языка, а не системным
// спиннером.
//
// Для кнопок и мелких мест остаётся Spinner: он наследует currentColor
// и умеет быть белым на тиловой заливке, чего точкам не нужно.

interface LoaderProps {
  /** Подпись под точками. Без неё лоадер остаётся молчаливым. */
  label?: string;
  className?: string;
}

// Сдвиг фазы: точки поднимаются волной, а не разом
const DELAYS = ["0ms", "160ms", "320ms"];

export default function Loader({ label, className = "" }: LoaderProps) {
  return (
    <div
      role="status"
      aria-label={label ?? "Загрузка"}
      className={`flex flex-col items-center justify-center gap-3 ${className}`}
    >
      <span className="flex items-end gap-[7px]">
        {DELAYS.map((delay) => (
          <span
            key={delay}
            style={{ animationDelay: delay }}
            className="inline-block h-2 w-2 rounded-full bg-brand animate-dotwave"
          />
        ))}
      </span>
      {label && <span className="text-[13px] text-ink-subtle">{label}</span>}
    </div>
  );
}
