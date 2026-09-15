// «Познакомьтесь» — единственная тёмная секция: поворот, знакомство
// с ИИ-клиентом и чем он похож на живого человека.

import { portraitFor } from "@/lib/patientAvatars";
import Marker from "./Marker";
import Reveal from "./Reveal";
import { H2, INNER, SCREEN, SECTION_X } from "./ui";

const TRAITS = [
  "Помнит всё, что ей сказали",
  "Возражает не по скрипту",
  "Не любит, когда ей продают",
  "Замыкается, когда торопят",
  "Оттаивает, если спросить про внуков",
];

const OTHERS = [
  "Рустам Каримович",
  "Юлия Андреевна",
  "Станислав Геннадьевич",
  "Гульсара Рустамовна",
  "Елена Андреевна",
];

export default function MeetTamara() {
  return (
    <section className={`${SECTION_X} ${SCREEN} bg-surface-dark py-11 lg:py-[110px]`}>
      <div className={INNER}>
        <Reveal as="h2" className={`${H2} !text-brand-text-on-dark lg:max-w-[1200px]`}>
          Учиться на живых клиентах <Marker>больше не обязательно</Marker>
        </Reveal>
        <Reveal
          delay={40}
          className="mt-5 text-[19.5px] font-semibold leading-[1.3] text-brand-text-on-dark [text-wrap:pretty] lg:mt-[26px] lg:text-[26px]"
        >
          <span className="text-brand-on-dark">Познакомьтесь:</span> Тамара Михайловна, 62 года.
          Искусственный интеллект
        </Reveal>

        <div className="mt-9 flex flex-col items-center gap-9 lg:mt-14 lg:flex-row lg:gap-14">
          <Reveal kind="visual" delay={60} className="flex flex-col items-center lg:min-w-0 lg:flex-1">
            <div className="relative flex h-[240px] w-[240px] items-center justify-center lg:h-[380px] lg:w-[380px]">
              <span className="absolute inset-5 animate-ringpulse motion-reduce:animate-none rounded-full border-2 border-brand-on-dark lg:inset-[30px]" />
              <span
                className="absolute inset-5 animate-ringpulse motion-reduce:animate-none rounded-full border-2 border-brand-on-dark lg:inset-[30px]"
                style={{ animationDelay: "1.2s" }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={portraitFor("Тамара Михайловна") ?? ""}
                alt="Тамара Михайловна"
                className="relative h-[200px] w-[200px] rounded-full border-2 border-brand-on-dark bg-surface-dark object-cover lg:h-[320px] lg:w-[320px]"
              />
            </div>
            {/* Строка должна уместиться в одну линию: иначе на телефоне «ещё 15» падает
                отдельной строкой, а на десктопе блок портрета перерастает колонку черт.
                Отсюда ступени: до 375 px узкий зазор, с 1024 — 56 px, с 1280 — 64 px */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-1 min-[375px]:gap-2 lg:mt-7 xl:gap-3">
              {OTHERS.map((name) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={name}
                  src={portraitFor(name) ?? ""}
                  alt=""
                  loading="lazy"
                  className="h-11 w-11 shrink-0 rounded-full border-[length:1.5px] border-white/10 object-cover lg:h-14 lg:w-14 xl:h-16 xl:w-16"
                />
              ))}
              <span className="inline-flex h-11 items-center whitespace-nowrap rounded-full bg-white/10 px-3 text-[14px] font-semibold text-brand-on-dark lg:h-14 lg:px-4 lg:text-[16px] xl:h-16 xl:px-5 xl:text-[17.5px]">
                ещё 15
              </span>
            </div>
          </Reveal>

          {/* Высота = портрет 380 + отступ 28 + строка аватаров, чтобы колонки кончались вровень */}
          <div className="flex w-full flex-col gap-4 lg:h-[464px] xl:h-[472px] lg:max-w-[560px] lg:flex-1 lg:justify-between lg:gap-0">
            {TRAITS.map((trait, i) => (
              <div key={trait} className="flex flex-col gap-4 lg:gap-0 lg:contents">
                {i > 0 && <span className="block h-px bg-white/10" />}
                <Reveal
                  delay={i * 90}
                  className="text-[24px] font-medium leading-[1.15] tracking-[-0.025em] text-brand-text-on-dark [text-wrap:pretty] lg:text-[36px]"
                >
                  {trait}
                </Reveal>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
