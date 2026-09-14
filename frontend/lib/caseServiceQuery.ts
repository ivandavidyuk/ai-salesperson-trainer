// Поиск услуги случая в базе — для расшифровки и для экрана звонка
// в упражнении.
//
// Отдельным файлом от lib/caseService.ts, потому что тот импортируют
// клиентские компоненты (фраза «не подобрана» нужна на экране), а этот
// тянет Prisma, которой в браузерной сборке не место.

import { prisma } from "@/lib/db";
import type { CaseService } from "@/lib/caseService";

/**
 * Услуга случая с ценой из прайса. null — «не подобрана»: у случая нет
 * услуги вовсе (диагноз без лечащей услуги) либо её уже удалили из прайса.
 * Для менеджера это одно состояние: продать то, чего нет в прайсе, нельзя,
 * а имя без цены читалось бы как подсказка.
 */
export async function caseService(
  patientId: string | null,
  organizationId: string | null
): Promise<CaseService | null> {
  if (!patientId || !organizationId) return null;
  const patientCase = await prisma.patientCase.findUnique({
    where: { patientId_organizationId: { patientId, organizationId } },
    select: { serviceName: true },
  });
  if (!patientCase?.serviceName) return null;
  const service = await prisma.service.findFirst({
    where: { organizationId, name: patientCase.serviceName },
    select: { name: true, price: true },
  });
  return service ? { name: service.name, price: service.price } : null;
}
