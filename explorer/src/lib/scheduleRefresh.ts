/** Serial setTimeout chain. Do not use setInterval. */
export function startTimeoutChain(
  work: () => Promise<void>,
  delayMs: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const schedule = (): void => {
    if (stopped) return
    timer = setTimeout(() => {
      void (async () => {
        try {
          await work()
        } finally {
          schedule()
        }
      })()
    }, delayMs)
  }

  void work().finally(() => {
    schedule()
  })

  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
