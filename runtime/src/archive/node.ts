import { listenArchiveHttp, type ArchiveHttpServer } from './http.js'
import { defaultFacadeViews } from './jsonrpcFacade.js'
import { createOnDemandEngine } from './ondemand/engine.js'
import { openArchiveStore } from './store.js'

export interface ArchiveNodeOptions {
  port: number
  dataDir: string
}

export async function startArchiveNode(options: ArchiveNodeOptions): Promise<ArchiveHttpServer> {
  const store = openArchiveStore(options.dataDir)
  const ondemand = createOnDemandEngine({
    domainId: 'local-archive',
    role: 'active',
    peers: [],
    store,
    autoSeedLabMiners: true,
    autoFreeze: true,
  })
  const server = await listenArchiveHttp({
    port: options.port,
    store,
    identity: { domainId: 'local-archive', role: 'active' },
    facadeViews() {
      const waiting = ondemand.facadeViews()
      return {
        ...defaultFacadeViews(),
        waitingPool: waiting.waitingPool,
        selectionLog: waiting.selectionLog,
      }
    },
    extraHealth: () => ({ ...ondemand.health() }),
    extraGet: (pathname) => ondemand.get(pathname),
    onPost: (pathname, body) => ondemand.post(pathname, body),
  })
  await ondemand.start()
  return {
    get port() {
      return server.port
    },
    get info() {
      return server.info
    },
    close() {
      ondemand.stop()
      return server.close()
    },
  }
}
