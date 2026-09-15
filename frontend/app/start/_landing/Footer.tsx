// Подвал лендинга: Telegram, политика и оператор данных. YouTube появится,
// когда будет адрес канала; Instagram не упоминаем (реклама на ресурсах
// Meta запрещена с 01.09.2025, см. NOTES).

import Link from "next/link";
import Logo from "@/app/components/Logo";
import { OPERATOR } from "@/lib/legal";

const LINK = "text-brand transition-colors hover:text-brand-hover";

export default function Footer() {
  const operator = `${OPERATOR.name}, ИНН ${OPERATOR.inn}`;
  return (
    <footer className="border-t border-line bg-surface-bubble px-5 pb-24 pt-[30px] lg:px-[72px] lg:pb-14 lg:pt-[46px]">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5 lg:max-w-[1296px] lg:flex-row lg:items-start lg:justify-between lg:gap-12">
        <div className="flex flex-col gap-3">
          <Logo size="sm" />
          <div className="hidden text-[14px] leading-[1.45] text-ink-subtle lg:block">{operator}</div>
        </div>
        <nav className="flex flex-wrap gap-x-[18px] gap-y-2 text-[14.5px] lg:gap-8 lg:text-[16px]">
          <a href="https://t.me/kimpodhod" target="_blank" rel="noopener noreferrer" className={LINK}>
            Telegram
          </a>
          <Link href="/privacy" className={LINK}>
            Политика обработки персональных данных
          </Link>
        </nav>
        <div className="text-[12.5px] leading-[1.45] text-ink-subtle lg:hidden">{operator}</div>
      </div>
    </footer>
  );
}
