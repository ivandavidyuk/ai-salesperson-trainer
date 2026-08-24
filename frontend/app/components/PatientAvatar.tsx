// Кружок пациента: портрет, а если его нет — инициалы, как было раньше.
//
// Один компонент на все места вывода. Размер, цвет и типографику задаёт
// вызывающий — те же классы, что стояли на кружке с инициалами до портретов.
// Компонент добавляет только форму: круг, центрирование и обрезку картинки
// по кругу.

import { initials } from "@/lib/format";
import { portraitFor } from "@/lib/patientAvatars";

interface PatientAvatarProps {
  name: string | null;
  /** Классы размера, фона и текста — те же, что были на кружке с инициалами */
  className?: string;
  /** В длинных списках картинку грузим по мере прокрутки */
  lazy?: boolean;
}

export default function PatientAvatar({
  name,
  className = "",
  lazy = false,
}: PatientAvatarProps) {
  const portrait = portraitFor(name);

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
    >
      {portrait ? (
        // Обычный img, не next/image: конфигурация ради собственной статики
        // из public/ — ровно та же причина, что у фото профиля
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={portrait}
          alt=""
          aria-hidden="true"
          loading={lazy ? "lazy" : undefined}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
