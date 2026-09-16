// Политика обработки персональных данных.
//
// Нужна форме заявки на лендинге /start: по 152-ФЗ согласие на обработку
// ссылается на опубликованную политику. Страница публичная (PUBLIC_PATHS
// в middleware.ts) и не зависит от входа.

import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/app/components/Logo";
import { OPERATOR, PRIVACY_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Политика обработки персональных данных — podhod.tech",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-[21px] font-semibold text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-base text-ink-body">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface px-5 pb-20 pt-6 md:px-8">
      <div className="mx-auto max-w-[760px]">
        <Link href="/start" aria-label="podhod.tech — на главную лендинга">
          <Logo size="sm" />
        </Link>

        <h1 className="mt-10 text-[30px] font-semibold leading-tight text-ink md:text-[38px]">
          Политика обработки персональных данных
        </h1>
        <p className="mt-3 text-sm text-ink-muted">Редакция от {PRIVACY_UPDATED}</p>

        <Section title="1. Кто обрабатывает данные">
          <p>
            Оператор персональных данных — {OPERATOR.name}, ИНН {OPERATOR.inn}{" "}
            (далее — оператор). Сервис — голосовой тренажёр для отделов продаж
            podhod.tech.
          </p>
          <p>
            По всем вопросам об обработке данных пишите на{" "}
            <a className="text-brand underline" href={`mailto:${OPERATOR.email}`}>
              {OPERATOR.email}
            </a>
            .
          </p>
        </Section>

        <Section title="2. Какие данные мы получаем">
          <p>Через форму заявки на странице podhod.tech/start:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>имя;</li>
            <li>ник или номер телефона в Telegram;</li>
            <li>сфера деятельности компании;</li>
            <li>количество менеджеров в отделе продаж.</li>
          </ul>
          <p>
            Мы не собираем данные через cookie для аналитики и рекламы. IP-адрес
            отправителя не сохраняется: чтобы ограничить число заявок с одного
            адреса, в памяти сервера на один час остаётся только его
            необратимый хеш.
          </p>
        </Section>

        <Section title="3. Зачем мы их обрабатываем">
          <p>
            Чтобы связаться с вами в Telegram, выдать демо-доступ к тренажёру
            и ответить на вопросы о нём. Для других целей данные
            не используются и третьим лицам для их целей не передаются.
          </p>
        </Section>

        <Section title="4. Основание">
          <p>
            Ваше согласие, которое вы даёте, отмечая галочку в форме заявки
            (пункт 1 части 1 статьи 6 Федерального закона № 152-ФЗ
            «О персональных данных»).
          </p>
        </Section>

        <Section title="5. Как мы обрабатываем данные">
          <p>
            Данные сохраняются в базе данных на сервере, расположенном
            в Российской Федерации.
          </p>
          <p>
            Чтобы оператор сразу узнал о заявке, её содержимое отправляется
            письмом на рабочую почту оператора. Почтовый ящик размещён
            у российского почтового сервиса. Трансграничная передача
            персональных данных не осуществляется.
          </p>
          <p>
            Действия с данными: сбор, запись, хранение, использование для связи
            с вами, отправка уведомления на рабочую почту оператора, удаление.
          </p>
        </Section>

        <Section title="6. Сколько мы храним данные">
          <p>
            До достижения цели обработки, но не дольше трёх лет с момента
            заявки, либо до отзыва согласия — что наступит раньше. После этого
            данные удаляются.
          </p>
        </Section>

        <Section title="7. Ваши права">
          <p>
            Вы можете узнать, какие ваши данные хранятся, потребовать их
            уточнения или удаления и отозвать согласие. Для этого напишите на{" "}
            <a className="text-brand underline" href={`mailto:${OPERATOR.email}`}>
              {OPERATOR.email}
            </a>
            . Мы ответим в течение 10 рабочих дней.
          </p>
        </Section>

        <Section title="8. Изменения политики">
          <p>
            Действующая редакция всегда опубликована на этой странице. Дата
            последнего изменения указана в начале.
          </p>
        </Section>
      </div>
    </div>
  );
}
