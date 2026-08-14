import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface ExplorerChromeValue {
  showFooter: boolean
  setShowFooter: (value: boolean) => void
}

const ExplorerChromeContext = createContext<ExplorerChromeValue | null>(null)

export function ExplorerChromeProvider({ children }: { children: ReactNode }) {
  const [showFooter, setShowFooter] = useState(true)
  const value = useMemo(() => ({ showFooter, setShowFooter }), [showFooter])
  return <ExplorerChromeContext.Provider value={value}>{children}</ExplorerChromeContext.Provider>
}

export function useExplorerChrome(): ExplorerChromeValue {
  const value = useContext(ExplorerChromeContext)
  if (value === null) throw new Error('useExplorerChrome requires ExplorerChromeProvider')
  return value
}
