import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

export interface Series {
  key: string
  label: string
  /** CSS colour, supplied by the caller from validated chart tokens. */
  color: string
  values: number[]
}

/**
 * Two-series trend line.
 *
 * Deliberate choices:
 *  - one y-axis only (both series are ticket counts)
 *  - legend AND end-of-line direct labels: the two hues sit in the 6–8 tritan
 *    separation band, which is only legal with secondary encoding
 *  - crosshair + tooltip on hover; a table view is available for the same data
 */
export function LineChart({
  labels, series, height = 180, valueSuffix = '',
}: {
  labels: string[]
  series: Series[]
  height?: number
  valueSuffix?: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const W = 720
  const H = height
  const pad = { top: 14, right: 54, bottom: 22, left: 30 }
  const plotW = W - pad.left - pad.right
  const plotH = H - pad.top - pad.bottom

  const max = useMemo(() => {
    const m = Math.max(1, ...series.flatMap((s) => s.values))
    return Math.ceil(m / 2) * 2
  }, [series])

  const x = (i: number) => pad.left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW)
  const y = (v: number) => pad.top + plotH - (v / max) * plotH

  const ticks = [0, max / 2, max]

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - pad.left) / plotW) * (labels.length - 1))
    setHover(Math.max(0, Math.min(labels.length - 1, i)))
  }

  const shortDay = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  return (
    <div className="relative">
      {/* Legend — always present for 2+ series, so identity is never colour alone. */}
      <div className="mb-2 flex items-center gap-4">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="h-0.5 w-3.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Trend of ${series.map((s) => s.label).join(' and ')} over ${labels.length} days`}
      >
        {/* Recessive grid */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)}
              stroke="rgb(var(--chart-grid))" strokeWidth={1}
            />
            <text
              x={pad.left - 7} y={y(t) + 3} textAnchor="end"
              className="fill-[rgb(var(--text-subtle))] text-[9px]"
            >
              {t}
            </text>
          </g>
        ))}

        {/* x labels: first, middle, last only — never one per point */}
        {[0, Math.floor(labels.length / 2), labels.length - 1].map((i) => (
          <text
            key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
            className="fill-[rgb(var(--text-subtle))] text-[9px]"
          >
            {shortDay(labels[i]!)}
          </text>
        ))}

        {hover != null && (
          <line
            x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH}
            stroke="rgb(var(--border-strong))" strokeWidth={1} strokeDasharray="3 3"
          />
        )}

        {series.map((s) => (
          <g key={s.key}>
            <polyline
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none" stroke={s.color} strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round"
            />
            {/* Direct label at the line end — the secondary encoding the palette requires */}
            <text
              x={W - pad.right + 7} y={y(s.values[s.values.length - 1] ?? 0) + 3}
              className="text-[9px] font-semibold" fill={s.color}
            >
              {s.label}
            </text>
            {hover != null && (
              <circle
                cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5}
                fill={s.color} stroke="rgb(var(--surface))" strokeWidth={2}
              />
            )}
          </g>
        ))}
      </svg>

      {hover != null && (
        <div
          className="pointer-events-none absolute top-6 z-10 min-w-[128px] rounded-lg border border-line bg-surface p-2 shadow-pop"
          style={{
            left: `calc(${((x(hover) - pad.left) / (W - pad.left - pad.right)) * 100}% * ${(W - pad.left - pad.right) / W} + ${(pad.left / W) * 100}%)`,
            transform: hover > labels.length / 2 ? 'translateX(-108%)' : 'translateX(8%)',
          }}
        >
          <p className="mb-1 text-2xs font-semibold text-ink-subtle">{shortDay(labels[hover]!)}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 text-ink-muted">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {s.values[hover]}{valueSuffix}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** Accessible equivalent of the chart above — same numbers, no colour needed. */
export function SeriesTable({ labels, series }: { labels: string[]; series: Series[] }) {
  return (
    <div className="max-h-60 overflow-auto rounded-lg border border-line">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-2">
          <tr>
            <th className="px-3 py-2 text-left font-semibold text-ink-muted">Day</th>
            {series.map((s) => (
              <th key={s.key} className="px-3 py-2 text-right font-semibold text-ink-muted">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((d, i) => (
            <tr key={d} className="border-t border-line">
              <td className="px-3 py-1.5 text-ink-muted">
                {new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </td>
              {series.map((s) => (
                <td key={s.key} className="px-3 py-1.5 text-right font-medium tabular-nums text-ink">
                  {s.values[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Horizontal magnitude bar. Always paired with a visible text label. */
export function BarRow({
  label, value, max, color, hint, className,
}: {
  label: React.ReactNode
  value: number
  max: number
  color: string
  hint?: string
  className?: string
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className={cn('group flex items-center gap-3 py-1', className)} title={hint}>
      <span className="w-[118px] shrink-0 truncate text-[13px] text-ink">{label}</span>
      <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(pct, value > 0 ? 3 : 0)}%`, backgroundColor: color }}
        />
      </span>
      <span className="w-8 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink">{value}</span>
    </div>
  )
}
