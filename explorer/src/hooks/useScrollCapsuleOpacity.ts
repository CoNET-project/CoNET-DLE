import { useCallback, useEffect, useRef, useState } from 'react'

const THRESHOLD = 40
const FADE_RANGE = 100

export function useScrollCapsuleOpacity(enabled = true) {
  const [opacity, setOpacity] = useState(1)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const apply = useCallback(
    (scrollTop: number) => {
      if (!enabled) {
        setOpacity(0)
        return
      }
      setOpacity(scrollTop <= THRESHOLD ? 1 : Math.max(0, 1 - (scrollTop - THRESHOLD) / FADE_RANGE))
    },
    [enabled],
  )

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      apply(event.currentTarget.scrollTop)
    },
    [apply],
  )

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      if (node) apply(node.scrollTop)
    },
    [apply],
  )

  useEffect(() => {
    if (!enabled) return
    const handler = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target || target !== scrollRef.current) return
      apply(target.scrollTop)
    }
    document.addEventListener('scroll', handler, { passive: true, capture: true })
    return () => document.removeEventListener('scroll', handler, true)
  }, [apply, enabled])

  return { opacity, onScroll, setRef }
}
