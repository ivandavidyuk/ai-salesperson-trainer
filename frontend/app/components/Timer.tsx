// Презентационный компонент таймера. Получает количество секунд
// и выводит их в формате MM:SS (например, 03:07). Логика отсчёта
// находится в родительском компоненте (странице сессии).

interface TimerProps {
  seconds: number;
}

// Форматирует число секунд в строку вида "MM:SS"
function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(minutes)}:${pad(secs)}`;
}

export default function Timer({ seconds }: TimerProps) {
  return (
    <div className="font-mono text-3xl tabular-nums text-gray-800">
      {formatTime(seconds)}
    </div>
  );
}
