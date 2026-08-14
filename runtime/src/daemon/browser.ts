import { daemonInfo, probeArchive } from './core.js'

export async function startBrowserDaemon(archiveUrl: string): Promise<Record<string, unknown>> {
  const probed = await probeArchive(archiveUrl)
  return {
    ...probed.daemon,
    health: probed.health,
    info: probed.info,
    wait: probed.wait,
  }
}

declare global {
  interface Window {
    DleDaemon?: {
      start: typeof startBrowserDaemon
      info: typeof daemonInfo
    }
  }
}

if (typeof globalThis === 'object' && 'document' in globalThis) {
  ;(globalThis as unknown as Window).DleDaemon = {
    start: startBrowserDaemon,
    info: daemonInfo,
  }
}
