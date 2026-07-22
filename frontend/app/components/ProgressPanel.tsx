// Панель «Прогресс»: средние оценки по этапам сделки за текущую неделю
// с изменением к прошлой, плюс сильная сторона и точка роста
// из последнего разбора.

import type { ProgressMetric } from "@/lib/home";

interface ProgressPanelProps {
  metrics: ProgressMetric[];
  strength: string | null;
  growthPoint: string | null;
}

// Изменение к прошлой неделе: рост — зелёный, падение — красный,
// «без изменений» и отсутствие данных не показываем вовсе.
function Delta({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className={`rounded-full px-[7px] py-0.5 text-[11px] font-semibold ${
        up ? "bg-good-surface text-good" : "bg-danger-soft text-danger-strong"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(delta)}
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

      <div className="flex-1 rounded-[14px] border border-line bg-surface-card px-5 py-[18px]">
        {!hasData && (
          <p className="text-[13.5px] leading-normal text-ink-muted">
            Оценки появятся после разбора разговоров — проведите первую
            тренировку.
          </p>
        )}

        {hasData &&
          metrics.map((metric) => (
            <div key={metric.key} className="mb-2 last:mb-0">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="whitespace-nowrap text-[13px] text-ink-body">
                  {metric.label}
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-[13px] text-ink">
                    {metric.value ?? "—"}
                  </span>
                  <Delta delta={metric.delta} />
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                <div
                  className="h-full rounded-full bg-brand"
                  // Шкала 0–10, поэтому оценка напрямую переводится в проценты
                  style={{ width: `${((metric.value ?? 0) / 10) * 100}%` }}
                />
              </div>
            </div>
          ))}

        {(strength || growthPoint) && (
          <>
            <div className="my-[11px] h-px bg-line-soft" />

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
