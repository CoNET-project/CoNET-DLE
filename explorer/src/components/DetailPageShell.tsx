import type { ReactNode } from 'react'
import { BeamioCircularBackButton, BEAMIO_CIRCULAR_BACK_ROW_CLASS } from './BeamioCircularBackButton'

export function DetailPageShell({
  eyebrow,
  title,
  onBack,
  pills,
  children,
}: {
  eyebrow: string
  title: string
  onBack: () => void
  pills?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className="dle-page-glow min-h-0 flex-1 overflow-y-auto px-4 pb-8"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}
    >
      <div className="mx-auto max-w-6xl">
        <div className={`${BEAMIO_CIRCULAR_BACK_ROW_CLASS} mb-2`}>
          <BeamioCircularBackButton variant="onDark" onClick={onBack} />
        </div>
        <header className="pb-7 pt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/70">{eyebrow}</p>
          <h1 className="mt-2 break-all text-3xl font-semibold text-white">{title}</h1>
          {pills ? <div className="mt-3 flex flex-wrap gap-2">{pills}</div> : null}
        </header>
        {children}
      </div>
    </div>
  )
}
