import { useTranslation } from 'react-i18next'
import type { SelfieGesture } from '~/lib/api-types'
import { cn } from '~/lib/utils'

/** The hand of each gesture, drawn next to the face (12 section 4.2 "a simple line drawing"). */
const HANDS: Record<SelfieGesture, string[]> = {
  // Two raised fingers beside the cheek.
  peace_sign: [
    'M118 118 v-22 a6 6 0 0 1 12 0 v22',
    'M122 98 l-6 -30 a5 5 0 0 1 10 -2 l5 28',
    'M128 96 l4 -32 a5 5 0 0 1 10 1 l-3 33',
    'M112 120 q-2 26 14 30 h10 q14 -4 12 -30 q0 -10 -10 -10 h-18 q-8 0 -8 10 z',
  ],
  // A fist with the thumb pointing up.
  thumbs_up: [
    'M112 112 h30 a8 8 0 0 1 0 16 h-30 z',
    'M112 128 h28 a8 8 0 0 1 0 16 h-28 z',
    'M112 144 h24 a7 7 0 0 1 0 14 h-24 z',
    'M112 112 l6 -30 a6 6 0 0 1 12 2 l-4 28',
  ],
  // The open palm with five fingers.
  open_palm: [
    'M110 150 q-6 -30 0 -48 h34 q6 18 0 48 z',
    'M112 102 v-26 a4 4 0 0 1 8 0 v26',
    'M121 102 v-34 a4 4 0 0 1 8 0 v34',
    'M130 102 v-32 a4 4 0 0 1 8 0 v32',
    'M139 104 v-24 a4 4 0 0 1 8 0 v30',
    'M110 120 l-12 -14 a4 4 0 0 1 6 -6 l8 8',
  ],
  // One hand flat on top of the head, the arm coming up from the shoulder.
  hand_on_head: [
    'M40 18 h44 q8 0 8 6 q0 6 -8 6 h-44 q-6 0 -6 -6 q0 -6 6 -6 z',
    'M92 26 q24 10 22 70 q0 24 -10 44',
  ],
}

/** A line drawing of a face and the requested gesture, with the instruction as its name. */
export function GestureIllustration({
  gesture,
  className,
}: {
  gesture: SelfieGesture
  className?: string
}) {
  const { t } = useTranslation('verification')
  const instruction = t(`gesture.${gesture}`)
  return (
    <svg
      role="img"
      aria-label={t('gesture.illustration', { instruction })}
      viewBox="0 0 170 190"
      data-gesture={gesture}
      className={cn('h-40 w-auto text-primary', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Head, face and shoulders. */}
      <ellipse cx="62" cy="70" rx="32" ry="38" />
      <circle cx="51" cy="64" r="2.5" fill="currentColor" />
      <circle cx="73" cy="64" r="2.5" fill="currentColor" />
      <path d="M52 86 q10 8 20 0" />
      <path d="M14 188 q0 -60 48 -66 q48 6 48 66" />
      {HANDS[gesture].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
