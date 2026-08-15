import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

const TOP_REVEAL = 40
const DIRECTION_DELTA = 6

export function useScrollFooterOpacity(enabled = true) {
  const [opacity, setOpacity] = useState(1)
  const lastTopRef = useRef(0)
  const { pathname } = useLocation()

  useEffect(() => {
    setOpacity(1)
    lastTopRef.current = 0
  }, [pathname])

  useEffect(() => {
    if (!enabled) {
      setOpacity(0)
      return
    }

    const apply = (scrollTop: number) => {
      if (scrollTop <= TOP_REVEAL) {
        lastTopRef.current = scrollTop
        setOpacity(1)
        return
      }
      const delta = scrollTop - lastTopRef.current
      if (Math.abs(delta) < DIRECTION_DELTA) return
      lastTopRef.current = scrollTop
      // Page moves up (scroll down) → hide. Page moves down (scroll up) → show.
      setOpacity(delta > 0 ? 0 : 1)
    }

    const handler = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.classList.contains('dle-page-glow')) return
      apply(target.scrollTop)
    }

    document.addEventListener('scroll', handler, { passive: true, capture: true })
    return () => document.removeEventListener('scroll', handler, true)
  }, [enabled])

  return opacity
}
