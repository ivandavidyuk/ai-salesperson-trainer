// Панель «Прогресс»: средние оценки по этапам сделки за текущую неделю
// с изменением к прошлой, плюс сильная сторона и точка роста
// из последнего разбора.
//
// Этапы показаны вертикальными столбцами: они тянутся на всю свободную
// высоту панели, поэтому пустоты между графиком и выводами не остаётся —
// раньше шкалы были горизонтальными и жались кверху.

import type { ProgressMetric } from "@/lib/home";

interface ProgressPanelProps {
  metrics: ProgressMetric[];
  strength: string | null;
  growthPoint: string | null;
}

// Изменение к прошлой неделе: рост — зелёный, падение — красный,
// «без изменений» и отсутствие данных не показываем вовсе.
//
// Место под плашку резервируется всегда: столбцы стоят в одной строке и
// выравниваются по низу, поэтому колонка без дельты иначе подняла бы свою
// дорожку выше соседних. У новых пользователей дельт нет ни у одного этапа,
// так что это обычное состояние, а не редкий случай.
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
        {!hasData && (
          <p className="text-[13.5px] leading-normal text-ink-muted">
            Оценки появятся после разбора разговоров — проведите первую
            тренировку.
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

            {/* min-h-0 и на обёртке, и на строке столбцов: без него flex-1
                у дорожки не сможет сжаться и панель вылезет за экран */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 items-stretch gap-3.5">
                {metrics.map((metric) => (
                  <div
                    key={metric.key}
                    className="flex min-w-0 flex-1 flex-col items-center gap-2"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-mono text-xl font-medium leading-none text-ink">
                        {metric.value ?? "—"}
                      </span>
                      <Delta delta={metric.delta} />
                    </div>

                    <div className="flex w-full max-w-[58px] flex-1 items-end overflow-hidden rounded-[11px] bg-surface-bubble">
                      <div
                        className="w-full rounded-t-lg bg-gradient-to-b from-brand-bar-top to-brand shadow-[inset_0_1px_0_rgba(255,255,255,.3)]"
                        // Шкала 0–10, поэтому оценка напрямую переводится в проценты
                        style={{ height: `${((metric.value ?? 0) / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Подписи — отдельной строкой под дорожками: внутри колонок
                  разная длина названий сдвигала бы низ столбцов */}
              <div className="mt-3.5 flex gap-3.5">
                {metrics.map((metric) => (
                  <div
                    key={metric.key}
                    className="min-w-0 flex-1 text-balance text-center text-[12.5px] font-medium leading-[1.35] tracking-[-.005em] text-ink-body"
                  >
                    {metric.label}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {(strength || growthPoint) && (
          <>
            <div className="mb-3.5 mt-5 h-px shrink-0 bg-line-soft" />

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
