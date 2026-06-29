// Аватар-заглушка собеседника по центру экрана.
// При pulsing=true вокруг аватара показываются анимированные кольца —
// визуальный индикатор того, что идёт разговор.

interface CallAvatarProps {
  pulsing?: boolean;
}

export default function CallAvatar({ pulsing = false }: CallAvatarProps) {
  return (
    <div className="relative flex h-48 w-48 items-center justify-center">
      {/* Пульсирующие кольца (только во время активного звонка) */}
      {pulsing && (
        <>
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400/40 animate-pulse-ring" />
          <span
            className="absolute inline-flex h-full w-full rounded-full bg-blue-400/30 animate-pulse-ring"
            style={{ animationDelay: "0.9s" }}
          />
        </>
      )}

      {/* Сам аватар: серый круг с силуэтом человека */}
      <div className="relative flex h-40 w-40 items-center justify-center rounded-full bg-gray-200 shadow-inner">
        <svg
          className="h-24 w-24 text-gray-400"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 12c2.7 0 4.9-2.2 4.9-4.9S14.7 2.2 12 2.2 7.1 4.4 7.1 7.1 9.3 12 12 12zm0 2.4c-3.3 0-9.8 1.6-9.8 4.9v2.5h19.6v-2.5c0-3.3-6.5-4.9-9.8-4.9z" />
        </svg>
      </div>
    </div>
  );
}
