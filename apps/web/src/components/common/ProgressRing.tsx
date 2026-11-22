import { cn } from '~/lib/utils'

/*
 * The two rings of DESIGN.md 6.5 and of Home, drawn in their own units: the box is in rem, so
 * the number inside grows with the reader's text.
 */
const RINGS = {
  match: {
    box: 'size-[10rem]',
    size: 160,
    radius: 68,
    stroke: 11,
    track: 'stroke-success-soft',
    bar: 'stroke-success',
    caption: 'fill-success',
    figure: 42,
  },
  completeness: {
    box: 'size-[7.25rem]',
    size: 116,
    radius: 48,
    stroke: 10,
    // Shows on the background and on sand, so the ring reads the same in either band.
    track: 'stroke-primary-soft',
    bar: 'stroke-primary',
    caption: 'fill-primary',
    figure: 26,
  },
} as const

/**
 * A percentage as a ring with the number inside. Without a `label` it is decoration: use that
 * only where the same number is written beside it.
 */
export function ProgressRing({
  value,
  kind,
  label,
  caption,
  className,
}: {
  /** 0 to 100. */
  value: number
  kind: keyof typeof RINGS
  /** The accessible name ("87% match"). */
  label?: string
  /** A word under the number ("match"). */
  caption?: string
  className?: string
}) {
  const ring = RINGS[kind]
  const percent = Math.round(Math.min(100, Math.max(0, value)))
  const middle = ring.size / 2
  const length = 2 * Math.PI * ring.radius
  const name = label ? ({ role: 'img', 'aria-label': label } as const) : { 'aria-hidden': true }

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: role="img" with aria-label, or aria-hidden (`name`).
    <svg
      data-slot="progress-ring"
      viewBox={`0 0 ${ring.size} ${ring.size}`}
      className={cn('max-w-full', ring.box, className)}
      {...name}
    >
      <circle
        cx={middle}
        cy={middle}
        r={ring.radius}
        fill="none"
        strokeWidth={ring.stroke}
        className={ring.track}
      />
      {/* A round cap would draw a dot at zero. */}
      {percent > 0 ? (
        <circle
          cx={middle}
          cy={middle}
          r={ring.radius}
          fill="none"
          strokeWidth={ring.stroke}
          strokeLinecap="round"
          strokeDasharray={`${(percent / 100) * length} ${length}`}
          transform={`rotate(-90 ${middle} ${middle})`}
          className={ring.bar}
        />
      ) : null}
      <text
        x={middle}
        y={caption ? middle + 4 : middle + ring.figure / 3}
        textAnchor="middle"
        direction="ltr"
        fontSize={ring.figure}
        className="fill-foreground font-sans font-bold tabular-nums"
      >
        {`${percent}%`}
      </text>
      {caption ? (
        <text
          x={middle}
          y={middle + 28}
          textAnchor="middle"
          fontSize={17}
          className={cn('font-sans font-semibold', ring.caption)}
        >
          {caption}
        </text>
      ) : null}
    </svg>
  )
}
