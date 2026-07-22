// Индикатор загрузки: кольцо с прозрачным сегментом.
// Цвет наследуется от текста родителя (currentColor), поэтому спиннер
// подходит и на кнопке, и на светлом фоне.

interface SpinnerProps {
  className?: string;
}

export default function Spinner({ className = "" }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Загрузка"
      className={`inline-block h-[17px] w-[17px] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
