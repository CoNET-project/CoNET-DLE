import { createContext, useContext, type ReactNode } from 'react'
import { useArchiveFeed } from '../hooks/useArchiveFeed'

type ExplorerValue = ReturnType<typeof useArchiveFeed>

const ExplorerContext = createContext<ExplorerValue | null>(null)

export function ExplorerProvider({ children }: { children: ReactNode }) {
  const value = useArchiveFeed()
  return <ExplorerContext.Provider value={value}>{children}</ExplorerContext.Provider>
}

export function useExplorer(): ExplorerValue {
  const value = useContext(ExplorerContext)
  if (value === null) throw new Error('useExplorer requires ExplorerProvider')
  return value
}
