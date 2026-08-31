// POST /api/organization/rebuild
// «Собрать заново» после обрыва — и «пересобрать всех» по просьбе руководителя.
//
// Отдельный роут, а не повторное сохранение формы: данные клиники
// не менялись, и переписывать их незачем.
//
// Отдельного режима «продолжить с места» больше нет: цель пересборки одна
// и та же у обоих входов — случаи с отметкой устаревания и пациенты без
// случая — см. целиПересборки. Удачная сборка отметку снимает, поэтому
// повторный запуск сам берётся только за недоделанное.
//
// Тело { all: true } помечает устаревшими всех и пересобирает клинику целиком.
// Это не роскошь, а замена того, что делало сохранение формы до выборочной
// пересборки: добавленная услуга не задевает ни одного существующего случая,
// и без этой кнопки под неё было бы не собрать никого никогда.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireHead } from "@/lib/access";
import { rebuildCases, идётСборка, целиПересборки } from "@/lib/cases";
import { ГЕНЕРАЦИЯ_ЗАКРЫТА, этоДемо } from "@/lib/demoAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const head = await requireHead(request);
    if (!head) {
      return NextResponse.json(
        { error: "Доступно только руководителю" },
        { status: 403 }
      );
    }
    if (!head.organizationId) {
      return NextResponse.json({ error: "Клиника не заполнена" }, { status: 400 });
    }

    // Второй замок на том же входе, что и у сохранения формы: этот роут
    // запускает сборку напрямую, минуя её, и без проверки здесь запрет
    // обходился бы одним нажатием «Собрать заново»
    if (await этоДемо(head.organizationId)) {
      return NextResponse.json({ error: ГЕНЕРАЦИЯ_ЗАКРЫТА }, { status: 403 });
    }

    // Вторую сборку поверх живой не запускаем. Кнопка нажимается там же,
    // где показан обрыв, — а нажать её можно и когда обрыва не было:
    // две вкладки, двойной клик, возврат назад. Обе сборки взялись бы
    // за одних и тех же пациентов, заплатив за них дважды, и чей случай
    // останется в базе, решала бы очередь записи
    if (await идётСборка(head.organizationId)) {
      return NextResponse.json({ started: false, alreadyRunning: true });
    }

    // «Пересобрать всех» — единственный способ отдать пациентов новой услуге:
    // сама по себе она ничей случай не портит, значит и в цели никто не попал
    const всех = await request
      .json()
      .then((тело: unknown) => Boolean((тело as { all?: boolean } | null)?.all))
      .catch(() => false);
    if (всех) {
      await prisma.patientCase.updateMany({
        where: { organizationId: head.organizationId },
        data: { staleSince: new Date() },
      });
    }

    const { цели } = await целиПересборки(head.organizationId);
    if (цели.length === 0) {
      return NextResponse.json({ started: false, affected: 0 });
    }

    // Флаг поднимаем до старта, как и при сохранении формы: иначе страница
    // успеет опросить статус между ответом и началом сборки и решит,
    // что сборка уже кончилась
    await prisma.organization.update({
      where: { id: head.organizationId },
      data: {
        casesRunning: true,
        casesTotal: цели.length,
        casesReady: 0,
        casesUpdatedAt: new Date(),
      },
    });

    // Как и при сохранении формы, сборка идёт после ответа: держать HTTP
    // открытым на сотню вызовов модели нельзя, интерфейс опрашивает прогресс
    void rebuildCases(head.organizationId, head.id).catch((error) =>
      console.error("Досборка случаев не удалась:", error)
    );

    return NextResponse.json({ started: true, affected: цели.length });
  } catch (error) {
    console.error("Ошибка в POST /api/organization/rebuild:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
