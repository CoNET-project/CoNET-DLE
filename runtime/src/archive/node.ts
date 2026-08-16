import { defaultLabRouteTable } from '../shared/labRoute.js'
import { listenArchiveHttp, type ArchiveHttpServer } from './http.js'
import { defaultFacadeViews } from './jsonrpcFacade.js'
import { createNewChainEngine } from './newchain/engine.js'
import { createOnDemandEngine } from './ondemand/engine.js'
import { openArchiveStore } from './store.js'

export interface ArchiveNodeOptions {
  port: number
  dataDir: string
}

export async function startArchiveNode(options: ArchiveNodeOptions): Promise<ArchiveHttpServer> {
  const store = openArchiveStore(options.dataDir)
  const routeTable = defaultLabRouteTable({ domainId: 'local-archive', role: 'active' })
  const ondemand = createOnDemandEngine({
    domainId: 'local-archive',
    role: 'active',
    peers: [],
    store,
    autoSeedLabMiners: true,
    autoFreeze: true,
  })
  const newchain = createNewChainEngine({
    domainId: 'local-archive',
    store,
    routeTable,
  })
  const server = await listenArchiveHttp({
    port: options.port,
    store,
    identity: { domainId: 'local-archive', role: 'active' },
    routeTable,
    facadeViews() {
      const waiting = ondemand.facadeViews()
      return {
        ...defaultFacadeViews(),
        waitingPool: waiting.waitingPool,
        selectionLog: waiting.selectionLog,
      }
    },
    extraHealth: () => ({ ...ondemand.health(), ...newchain.health() }),
    extraGet: (pathname) => newchain.get(pathname) ?? ondemand.get(pathname),
    onPost: (pathname, body) => newchain.post(pathname, body) ?? ondemand.post(pathname, body),
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
