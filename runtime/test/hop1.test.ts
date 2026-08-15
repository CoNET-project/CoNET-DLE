import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { listenArchiveHttp } from '../src/archive/http.js'
import { createHashLookupAdapter, indexLabHashObject, labAcLocator } from '../src/archive/hashPipe.js'
import { openHashStore } from '../src/archive/hashStore.js'
import { openArchiveStore } from '../src/archive/store.js'
import { DLE_LAB_CHAIN_NFT_ID, DLE_LAB_GROUP_ID } from '../src/shared/hashLookup.js'
import { labRouteTableFromPeers, type LabRouteTable } from '../src/shared/labRoute.js'
import { DLE_JSONRPC_VERSION } from '../src/shared/protocol.js'

const root = await mkdtemp(join(tmpdir(), 'dle-hop1-'))
const dirs: string[] = []

after(async () => {
  await rm(root, { recursive: true, force: true })
})

function tmpStoreDir(name: string): string {
  const dir = join(root, name)
  dirs.push(dir)
  return dir
}

function tableWithForeign(self: { domainId: string; role: string }, peers: Parameters<typeof labRouteTableFromPeers>[1]): LabRouteTable {
  const table = labRouteTableFromPeers(self, peers)
  table.groups['99'] = {
    groupId: 'dle.lab.foreign.v1',
    wallets: [
      {
        domainId: 'foreign-archive',
        role: 'active',
        url: 'http://127.0.0.1:9',
        labOnly: true,
      },
    ],
  }
  return table
}

test('own-group getByHash hops to a peer and does not fan out to another group', async () => {
  const store = openHashStore(tmpStoreDir('kv-a'))
  const hash = `0x${'11'.repeat(32)}`
  assert.equal(indexLabHashObject(store, labAcLocator(hash, '0x1', hash), { kind: 'ac' }).ok, true)
  const seen: string[] = []
  const table = tableWithForeign({ domainId: 'a', role: 'active' }, [
    { domainId: 'b', host: '127.0.0.1', port: 27102, role: 'active' },
  ])
  const lookup = createHashLookupAdapter(store, {
    table,
    fetchObject: async (url, nft) => {
      seen.push(`${url}|${nft}`)
      if (url.includes(':9')) throw new Error('fan-out to foreign group')
      return { kind: 'ac', from: 'peer' }
    },
  })
  const hit = await lookup.get(hash)
  assert.equal(hit.status, 'hit')
  if (hit.status === 'hit') {
    assert.equal(hit.locator.chainNftId, DLE_LAB_CHAIN_NFT_ID)
    assert.equal(hit.hop?.usedLocalFallback, false)
    assert.equal(hit.hop?.targetDomainId, 'b')
    assert.equal(hit.hop?.labOnly, true)
    assert.equal(hit.hop?.notProductionDepin, true)
    assert.deepEqual(hit.object, { kind: 'ac', from: 'peer' })
  }
  assert.deepEqual(seen, ['http://127.0.0.1:27102|42'])
})

test('foreign chainNftId must not answer from a local replica', async () => {
  const store = openHashStore(tmpStoreDir('kv-foreign'))
  const hash = `0x${'22'.repeat(32)}`
  assert.equal(
    store.putLocator({
      schema: 'HashLocatorV1',
      hash,
      chainNftId: '99',
      kind: 'ac',
      height: '0x1',
    }).ok,
    true,
  )
  assert.equal(store.putBody('99', '0x1', { secret: 'replica' }).ok, true)
  const seen: string[] = []
  const table = tableWithForeign({ domainId: 'a', role: 'active' }, [])
  const lookup = createHashLookupAdapter(store, {
    table,
    fetchObject: async (url, nft) => {
      seen.push(`${url}|${nft}`)
      return null
    },
  })
  const miss = await lookup.get(hash)
  assert.equal(miss.status, 'unavailable')
  if (miss.status === 'unavailable') {
    assert.equal(miss.planeWideNull, false)
    assert.equal(miss.hop?.usedLocalFallback, false)
    assert.equal(miss.hop?.groupId, 'dle.lab.foreign.v1')
  }
  assert.deepEqual(seen, ['http://127.0.0.1:9|99'])
  const local = lookup.getObjectLocal('99', '0x1')
  assert.equal(local.status, 'hit')
})

test('dle_getObject stays local and never hops', async () => {
  const store = openHashStore(tmpStoreDir('kv-object'))
  const hash = `0x${'33'.repeat(32)}`
  assert.equal(indexLabHashObject(store, labAcLocator(hash, '0x1', hash), { kind: 'ac' }).ok, true)
  let hopped = 0
  const lookup = createHashLookupAdapter(store, {
    table: labRouteTableFromPeers({ domainId: 'a', role: 'active' }, [
      { domainId: 'b', host: '127.0.0.1', port: 27102, role: 'active' },
    ]),
    fetchObject: async () => {
      hopped += 1
      return { leaked: true }
    },
  })
  const local = lookup.getObjectLocal(DLE_LAB_CHAIN_NFT_ID, '0x1')
  assert.equal(local.status, 'hit')
  assert.equal(hopped, 0)
  const empty = lookup.getObjectLocal(DLE_LAB_CHAIN_NFT_ID, '0x99')
  assert.equal(empty.status, 'unavailable')
  assert.equal(hopped, 0)
})

test('two in-process archives: A locates then hop-1 fetches B freezer', async () => {
  const hash = `0x${'44'.repeat(32)}`
  const storeA = openArchiveStore(tmpStoreDir('http-a'))
  const storeB = openArchiveStore(tmpStoreDir('http-b'))
  assert.equal(storeA.hash.putLocator(labAcLocator(hash, '0x1', hash)).ok, true)
  assert.equal(indexLabHashObject(storeB.hash, labAcLocator(hash, '0x1', hash), { kind: 'ac', from: 'b' }).ok, true)
  const serverB = await listenArchiveHttp({
    port: 0,
    store: storeB,
    identity: { domainId: 'b', role: 'active' },
  })
  const serverA = await listenArchiveHttp({
    port: 0,
    store: storeA,
    identity: { domainId: 'a', role: 'active' },
    routeTable: labRouteTableFromPeers({ domainId: 'a', role: 'active' }, [
      { domainId: 'b', host: '127.0.0.1', port: serverB.port, role: 'active' },
    ]),
  })
  try {
    const response = await fetch(`http://127.0.0.1:${serverA.port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: DLE_JSONRPC_VERSION,
        id: 1,
        method: 'dle_getByHash',
        params: [hash],
      }),
    })
    assert.equal(response.status, 200)
    const body = (await response.json()) as {
      result?: {
        status?: string
        locator?: { chainNftId?: string }
        object?: { from?: string }
        hop?: { targetDomainId?: string; usedLocalFallback?: boolean; labOnly?: boolean }
      }
    }
    assert.equal(body.result?.status, 'hit')
    assert.equal(body.result?.locator?.chainNftId, DLE_LAB_CHAIN_NFT_ID)
    assert.equal(body.result?.object?.from, 'b')
    assert.equal(body.result?.hop?.targetDomainId, 'b')
    assert.equal(body.result?.hop?.usedLocalFallback, false)
    assert.equal(body.result?.hop?.labOnly, true)
    const route = await fetch(`http://127.0.0.1:${serverA.port}/api/v2/dle/route/${DLE_LAB_CHAIN_NFT_ID}`)
    const routed = (await route.json()) as { groupId?: string; ownGroup?: boolean; labOnly?: boolean }
    assert.equal(routed.groupId, DLE_LAB_GROUP_ID)
    assert.equal(routed.ownGroup, true)
    assert.equal(routed.labOnly, true)
  } finally {
    await serverA.close()
    await serverB.close()
  }
})
