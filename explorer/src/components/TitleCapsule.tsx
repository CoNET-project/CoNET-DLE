import type { ReactNode } from 'react'
import { FOOTER_RESERVE_STYLE } from './Footer'
import { useScrollCapsuleOpacity } from '../hooks/useScrollCapsuleOpacity'
import { DleLogo } from './DleLogo'

const capsuleChrome =
  'rounded-full border border-cyan-400/25 bg-[#07111f]/80 shadow-[0_0_24px_rgba(0,180,255,0.22)] backdrop-blur-md'

export const CAPSULE_SPACER_STYLE = {
  paddingTop: 'calc(max(1rem, env(safe-area-inset-top, 0px)) + 5rem)',
} as const

export function MainPageShell({
  title,
  trailing,
  children,
}: {
  title: string
  trailing?: ReactNode
  children: ReactNode
}) {
  const { opacity, onScroll, setRef } = useScrollCapsuleOpacity(true)
  const pointer = opacity < 0.05 ? 'none' : 'auto'

  return (
    <div ref={setRef} onScroll={onScroll} className="dle-page-glow min-h-0 flex-1 overflow-y-auto">
      <div
        className="pointer-events-none fixed left-4 right-4 z-40 flex items-center justify-between gap-2 transition-opacity duration-300"
        style={{ top: 'max(1rem, env(safe-area-inset-top, 0px))', opacity }}
      >
        <div className={`flex items-center gap-2.5 py-1.5 pl-1.5 pr-4 ${capsuleChrome}`} style={{ pointerEvents: pointer }}>
          <DleLogo size={40} />
          <span className="text-[15px] font-bold tracking-tight text-white">{title}</span>
        </div>
        {trailing ? <div style={{ pointerEvents: pointer }}>{trailing}</div> : null}
      </div>
      <div className="mx-auto max-w-6xl px-4" style={{ ...CAPSULE_SPACER_STYLE, ...FOOTER_RESERVE_STYLE }}>
        {children}
      </div>
    </div>
  )
}
