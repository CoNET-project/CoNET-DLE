import { ChevronLeft } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

type Props = {
  onClick: () => void
  variant?: 'onLight' | 'onDark'
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'children'>

export const BEAMIO_CIRCULAR_BACK_ROW_CLASS = 'relative h-11'

export function BeamioCircularBackButton({
  onClick,
  variant = 'onLight',
  className = '',
  ...rest
}: Props) {
  const isDark = variant === 'onDark'
  const disc = isDark
    ? 'border border-white/40 bg-white/20 text-white/80 shadow-[0_2px_10px_rgba(0,0,0,0.28),0_1px_3px_rgba(0,0,0,0.18)]'
    : 'border border-black/[0.08] bg-white/90 text-[#2c2f31] shadow-[0_2px_10px_rgba(0,0,0,0.16),0_1px_3px_rgba(0,0,0,0.12)]'

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Back"
      onClick={onClick}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full backdrop-blur-md transition active:scale-[0.96] ${disc} ${className}`}
      {...rest}
    >
      <ChevronLeft className="h-[17px] w-[17px] stroke-[2.5]" aria-hidden />
    </button>
  )
}
