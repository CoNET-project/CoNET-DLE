import { Award, Braces, LayoutDashboard, ScrollText, Server } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useScrollFooterOpacity } from '../hooks/useScrollFooterOpacity'
import { formatEventTime } from '../lib/format'
import { DLE_LAB_CHAIN_ID_HEX, DLE_TESTNET_CHAIN_NAME } from '../protocol'
import { useExplorer } from '../providers/ExplorerProvider'

export const FOOTER_RESERVE_STYLE = {
  paddingBottom: 'calc(7.25rem + env(safe-area-inset-bottom, 0px))',
} as const

const tabs = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/events', label: 'Events', icon: ScrollText, end: false },
  { to: '/archives', label: 'Archives', icon: Server, end: false },
  { to: '/certificates', label: 'Certs', icon: Award, end: false },
  { to: '/rpc', label: 'RPC', icon: Braces, end: false },
] as const

export function Footer() {
  const { snapshot } = useExplorer()
  const opacity = useScrollFooterOpacity(true)
  const pointer = opacity < 0.05 ? 'none' : 'auto'
  const updated = snapshot.fetchedAt && Date.parse(snapshot.fetchedAt) > 0 ? formatEventTime(snapshot.fetchedAt) : '—'

  return (
    <footer
      className="fixed inset-x-0 bottom-0 z-40 border-t border-cyan-400/15 bg-[#060b14]/95 backdrop-blur-md transition-[opacity,transform] duration-300 ease-out"
      style={{
        paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))',
        opacity,
        transform: `translateY(${(1 - opacity) * 100}%)`,
        pointerEvents: pointer,
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-[11px] text-slate-400">
        <p>
          {DLE_TESTNET_CHAIN_NAME} · Chain ID{' '}
          <span className="dle-mono text-cyan-300">{DLE_LAB_CHAIN_ID_HEX}</span>
          <span className="mx-2 text-cyan-500/40">•</span>
          <span className={snapshot.live ? 'text-[#00ffa3]' : 'text-amber-300'}>
            {snapshot.live ? 'Archive reachable' : 'Last trusted / fixture'}
          </span>
        </p>
        <p>Last updated {updated}</p>
      </div>
      <nav aria-label="Explorer sections">
        <ul className="mx-auto grid max-w-6xl grid-cols-5 px-2 pb-1">
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-semibold ${
                    isActive ? 'text-[#00b4ff]' : 'text-slate-500'
                  }`
                }
              >
                <tab.icon className="h-5 w-5" strokeWidth={2.1} aria-hidden />
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  )
}
