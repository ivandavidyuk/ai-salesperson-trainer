// Подвал лендинга: соцсети, политика и оператор данных.
//
// Instagram в макете нет — добавлен по решению Ивана 15.09. Meta признана
// в России экстремистской организацией, поэтому рядом со ссылкой обязательна
// пометка со звёздочкой; убирать её нельзя.

import Link from "next/link";
import Logo from "@/app/components/Logo";
import { OPERATOR } from "@/lib/legal";

const LINK = "text-brand transition-colors hover:text-brand-hover";

const SOCIAL = [
  { label: "Telegram", href: "https://t.me/kimpodhod" },
  { label: "YouTube", href: "https://www.youtube.com/@podhodtech" },
  { label: "Instagram*", href: "https://www.instagram.com/podhod.tech/" },
];

export default function Footer() {
  const operator = `${OPERATOR.name}, ИНН ${OPERATOR.inn}`;
  return (
    <footer className="border-t border-line bg-surface-bubble px-5 pb-24 pt-[30px] lg:px-[72px] lg:pb-14 lg:pt-[46px]">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5 lg:max-w-[1296px] lg:flex-row lg:items-start lg:justify-between lg:gap-12">
        <div className="flex flex-col gap-3">
          <Logo size="sm" />
          <div className="hidden text-[14px] leading-[1.45] text-ink-subtle lg:block">{operator}</div>
        </div>
        <div className="flex flex-col gap-2.5 lg:items-end">
          <nav className="flex flex-wrap gap-x-[18px] gap-y-2 text-[14.5px] lg:justify-end lg:gap-8 lg:text-[16px]">
            {SOCIAL.map((item) => (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK}
              >
                {item.label}
              </a>
            ))}
            <Link href="/privacy" className={LINK}>
              Политика обработки персональных данных
            </Link>
          </nav>
          <p className="text-[12.5px] leading-[1.45] text-ink-subtle lg:text-right lg:text-[13px]">
            * Instagram принадлежит компании Meta, признанной экстремистской организацией
            и запрещённой в России
          </p>
        </div>
        <div className="text-[12.5px] leading-[1.45] text-ink-subtle lg:hidden">{operator}</div>
      </div>
    </footer>
  );
}
