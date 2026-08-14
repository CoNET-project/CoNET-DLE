import { listenArchiveHttp, type ArchiveHttpServer } from './http.js'
import { openArchiveStore } from './store.js'

export interface ArchiveNodeOptions {
  port: number
  dataDir: string
}

export async function startArchiveNode(options: ArchiveNodeOptions): Promise<ArchiveHttpServer> {
  const store = openArchiveStore(options.dataDir)
  return listenArchiveHttp({ port: options.port, store })
}
