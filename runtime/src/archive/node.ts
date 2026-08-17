import { defaultLabRouteTable } from '../shared/labRoute.js'
import { listenArchiveHttp, type ArchiveHttpServer } from './http.js'
import { defaultFacadeViews } from './jsonrpcFacade.js'
import { createNewChainEngine } from './newchain/engine.js'
import { createOnDemandEngine } from './ondemand/engine.js'
import { createSyncQualificationEngine, type SyncPeer } from './syncQualification/index.js'
import { openArchiveStore } from './store.js'

export interface ArchiveNodeOptions {
  port: number
  dataDir: string
}

/** Role-only official + extra standbys so handleStandbyReady can accept envelopes. Do not start() the seating tick. */
const LOCAL_ARCHIVE_STANDBY_PEERS: readonly SyncPeer[] = [
  { domainId: 'fd-06', role: 'standby', url: '' },
  { domainId: 'fd-07', role: 'standby', url: '' },
  { domainId: 'fd-08', role: 'standby', url: '' },
]

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
  const syncHolder: { current: ReturnType<typeof createSyncQualificationEngine> | null } = {
    current: null,
  }
  const newchain = createNewChainEngine({
    domainId: 'local-archive',
    store,
    routeTable,
    officialStandbysReady: () => syncHolder.current?.officialStandbysReady() === true,
  })
  const sync = createSyncQualificationEngine({
    domainId: 'local-archive',
    role: 'active',
    peers: [...LOCAL_ARCHIVE_STANDBY_PEERS],
    store,
    table: routeTable,
  })
  syncHolder.current = sync
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
    extraHealth: () => ({ ...ondemand.health(), ...newchain.health(), ...sync.health() }),
    extraGet(pathname) {
      if (pathname === '/sync/status') return { ...sync.status() }
      if (pathname === '/sync/inventory') return { ...sync.inventory() }
      return newchain.get(pathname) ?? ondemand.get(pathname)
    },
    onPost(pathname, body) {
      if (pathname === '/sync/standby-ready') {
        const result = sync.handleStandbyReady(body)
        return { status: result.ok ? 200 : 400, body: result }
      }
      return newchain.post(pathname, body) ?? ondemand.post(pathname, body)
    },
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
      sync.stop()
      ondemand.stop()
      newchain.stop()
      return server.close()
    },
  }
}
