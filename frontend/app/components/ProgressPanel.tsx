// Панель «Прогресс»: средние оценки по этапам сделки за текущую неделю
// с изменением к прошлой, плюс сильная сторона и точка роста
// из последнего разбора.
//
// Этапы — пронумерованные строки, растянутые по высоте панели
// (justify-between): так видно, что этапы идут по порядку, подписям
// хватает ширины, и пустоты между оценками и выводами не остаётся.

import type { ProgressMetric } from "@/lib/home";

interface ProgressPanelProps {
  metrics: ProgressMetric[];
  strength: string | null;
  growthPoint: string | null;
}

// Изменение к прошлой неделе: рост — зелёный, падение — красный,
// «без изменений» и отсутствие данных не показываем вовсе.
//
// Пустая плашка сохраняет высоту: без неё строка без дельты стала бы ниже
// соседних. У новых пользователей дельт нет ни у одного этапа, так что это
// обычное состояние, а не редкий случай.
function Delta({ delta }: { delta: number | null }) {
  const visible = delta !== null && delta !== 0;
  const up = (delta ?? 0) > 0;

  return (
    <span className="flex h-[18px] items-center">
      {visible && (
        <span
          className={`rounded-full px-[7px] py-0.5 text-[10.5px] font-semibold ${
            up ? "bg-good-surface text-good" : "bg-danger-soft text-danger-strong"
          }`}
        >
          {up ? "▲" : "▼"} {Math.abs(delta as number)}
        </span>
      )}
    </span>
  );
}

export default function ProgressPanel({
  metrics,
  strength,
  growthPoint,
}: ProgressPanelProps) {
  const hasData = metrics.some((metric) => metric.value !== null);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-2.5 flex items-baseline justify-between">
        <div className="text-base font-semibold text-ink">Прогресс</div>
        <div className="text-xs text-ink-subtle">неделя к неделе</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[14px] border border-line bg-surface-card px-5 py-[18px]">
        {/* Блок считает окно в семь суток, а не всё время. Прежний текст
            «проведите первую тренировку» читался как «вы никогда
            не тренировались», и 04.08 пользователь принял пустой блок
            за поломку статистики — у него было 18 разговоров, просто все
            старше недели. Текст обязан называть окно, иначе он врёт. */}
        {!hasData && (
          <p className="text-[13.5px] leading-normal text-ink-muted">
            За последние семь дней разговоров нет. Проведите тренировку —
            оценки по этапам появятся здесь после разбора.
          </p>
        )}

        {hasData && (
          <>
            <div className="mb-3.5 flex items-baseline justify-between">
              <span className="font-mono text-[10.5px] uppercase tracking-[.12em] text-brand-hover">
                Оценка по этапам
              </span>
              <span className="font-mono text-[10.5px] text-ink-placeholder">
                0 – 10
              </span>
            </div>

            {/* Строки, а не столбцы. Столбцы упирались в ширину: пятому
                этапу доставалось ~57px на подпись, из-за чего названия
                пришлось сокращать и переносить мягким дефисом. В строке
                под подпись есть вся ширина панели, и заодно нумерация
                1–5 показывает, что этапы идут по порядку, а не стоят рядом */}
            <div className="flex min-h-0 flex-1 flex-col justify-between gap-2.5">
              {metrics.map((metric, index) => (
                <div key={metric.key} className="flex items-center gap-[11px]">
                  <span className="w-[13px] shrink-0 text-right font-mono text-[11px] text-ink-placeholder">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-[5px] flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium tracking-[-.005em] text-ink-body">
                        {metric.label}
                      </span>
                      <span
                        className={`shrink-0 font-mono text-xl font-medium leading-none ${
                          metric.value === null ? "text-ink-placeholder" : "text-ink"
                        }`}
                      >
                        {metric.value ?? "—"}
                      </span>
                      {/* Ширина под плашку резервируется всегда: без неё
                          строки без дельты сдвигали бы оценку вправо */}
                      <span className="flex w-[50px] shrink-0 justify-end">
                        <Delta delta={metric.delta} />
                      </span>
                    </div>
                    {/* «Не измеряли» и «ноль» обязаны различаться с одного
                        взгляда: полоса у обоих пустая, поэтому пустую дорожку
                        рисуем пунктиром, а число делаем бледным. Этап, по
                        которому за неделю не было ни одной тренировки, —
                        не то же самое, что этап, проваленный в ноль */}
                    {metric.value === null ? (
                      <div className="h-2 rounded-full border border-dashed border-line-strong" />
                    ) : (
                      <div className="h-2 overflow-hidden rounded-full bg-surface-bubble">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand-bar-top to-brand"
                          // Шкала 0–10, оценка напрямую переводится в проценты
                          style={{ width: `${(metric.value / 10) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {(strength || growthPoint) && (
          <>
            <div className="mb-3.5 mt-5 h-px shrink-0 bg-line-soft" />

            {/* Источник выводов подписан намеренно. Они берутся из ОДНОГО
                последнего разбора, а не усредняются за неделю, — но лежат
                внутри панели с заголовком «неделя к неделе», и без подписи
                читаются как итог недели. Тогда конкретная формулировка
                («перебили, когда она заговорила про мужа») выглядит
                непонятной, хотя она точная */}
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[.12em] text-ink-placeholder">
              По последнему разговору
            </div>

            {strength && (
              <div className="mb-2">
                <span className="rounded-full bg-good-surface px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[.08em] text-good">
                  Сильная сторона
                </span>
                <p className="mt-1.5 text-pretty text-[13.5px] leading-snug text-ink-body">
                  {strength}
                </p>
              </div>
            )}

            {growthPoint && (
              <div>
                <span className="rounded-full bg-warn-surface px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[.08em] text-warn">
                  Точка роста
                </span>
                <p className="mt-1.5 text-pretty text-[13.5px] leading-snug text-ink-body">
                  {growthPoint}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
