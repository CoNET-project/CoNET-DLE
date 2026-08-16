import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { startArchiveNode } from '../src/archive/node.js'
import { callArchive, callArchiveBatch, detectDaemonRuntime, probeArchive } from '../src/daemon/core.js'
import {
  CONET_L1_CHAIN_ID,
  CONET_L1_CHAIN_ID_HEX,
  DLE_ARCHIVE_CLIENT_VERSION,
  DLE_COMMAND,
  DLE_LAB_CHAIN_ID,
  DLE_RUNTIME,
  DLE_TESTNET_CHAIN_NAME,
  DLE_ZERO_HASH,
  chainIdHex,
} from '../src/shared/protocol.js'
import { DLE_LAB_GROUP_ID } from '../src/shared/hashLookup.js'

const dataDir = await mkdtemp(join(tmpdir(), 'dle-archive-'))
const archive = await startArchiveNode({ port: 0, dataDir })
const archiveUrl = `http://127.0.0.1:${archive.port}`

after(async () => {
  await archive.close()
  await rm(dataDir, { recursive: true, force: true })
})

test('archive command identifies as a Node.js archive that does not produce blocks', async () => {
  const response = await fetch(`${archiveUrl}/health`)
  assert.equal(response.status, 200)
  const body = (await response.json()) as Record<string, unknown>
  assert.equal(body.command, DLE_COMMAND.archive)
  assert.equal(body.runtime, DLE_RUNTIME.nodejs)
  assert.equal(body.producesBlocks, false)
  assert.equal(body.hasTipVm, false)
  assert.equal(body.l1Isolated, true)
  assert.equal(body.batchSupported, true)
  assert.equal(body.chainId, DLE_LAB_CHAIN_ID)
  assert.equal(body.chainName, DLE_TESTNET_CHAIN_NAME)
})

test('archive JSON-RPC returns a DLE chain id and rejects tip VM calls', async () => {
  const chainId = await callArchive(archiveUrl, 'eth_chainId')
  assert.equal('result' in chainId && chainId.result, chainIdHex(DLE_LAB_CHAIN_ID))
  assert.notEqual(chainIdHex(DLE_LAB_CHAIN_ID), CONET_L1_CHAIN_ID_HEX)
  const call = await callArchive(archiveUrl, 'eth_call', [])
  assert.equal('error' in call, true)
  if ('error' in call) assert.match(call.error.message, /no tip VM/)
})

test('P2 facade is isolated from CoNET L1 and supports JSON-RPC 2.0 batch', async () => {
  const info = await callArchive(archiveUrl, 'dle_info')
  assert.equal('result' in info, true)
  if (!('result' in info) || info.result === null || typeof info.result !== 'object') {
    throw new Error('dle_info missing result')
  }
  const body = info.result as Record<string, unknown>
  assert.equal(body.l1Isolated, true)
  assert.equal(body.batchSupported, true)
  assert.equal(body.l1ChainIdForbidden, CONET_L1_CHAIN_ID)
  assert.notEqual(body.chainId, CONET_L1_CHAIN_ID)
  assert.notEqual(body.chainIdHex, CONET_L1_CHAIN_ID_HEX)

  const netVersion = await callArchive(archiveUrl, 'net_version')
  assert.equal('result' in netVersion && netVersion.result, String(DLE_LAB_CHAIN_ID))
  const client = await callArchive(archiveUrl, 'web3_clientVersion')
  assert.equal('result' in client && client.result, DLE_ARCHIVE_CLIENT_VERSION)
  const block = await callArchive(archiveUrl, 'eth_getBlockByNumber', ['latest', false])
  assert.equal('result' in block, true)
  if ('result' in block && block.result !== null && typeof block.result === 'object') {
    const tip = block.result as Record<string, unknown>
    assert.equal(tip.number, '0x0')
    assert.equal(tip.hash, DLE_ZERO_HASH)
    assert.equal(tip.dleFacade, true)
  }
  const missing = await callArchive(archiveUrl, 'eth_getBlockByNumber', ['0x1', false])
  assert.equal('result' in missing && missing.result, null)
  const balance = await callArchive(archiveUrl, 'eth_getBalance', [
    '0x0000000000000000000000000000000000000000',
    'latest',
  ])
  assert.equal('error' in balance, true)
  if ('error' in balance) assert.match(balance.error.message, /no EVM account model/)

  const batch = await callArchiveBatch(archiveUrl, [
    { method: 'eth_chainId' },
    { method: 'eth_getBalance', params: ['0x0000000000000000000000000000000000000000', 'latest'] },
    { method: 'eth_blockNumber' },
  ])
  assert.equal(batch.length, 3)
  assert.equal('result' in batch[0] && batch[0].result, chainIdHex(DLE_LAB_CHAIN_ID))
  assert.equal('error' in batch[1], true)
  assert.equal('result' in batch[2] && batch[2].result, '0x0')
})

test('archive exposes a read-only /api/v2/dle explorer surface', async () => {
  const overview = await fetch(`${archiveUrl}/api/v2/dle`)
  assert.equal(overview.status, 200)
  const body = (await overview.json()) as Record<string, unknown>
  assert.equal(body.schema, 'DleExplorerApiV1')
  assert.equal(body.producesBlocks, false)
  assert.equal(body.hasTipVm, false)
  assert.equal(body.l1Isolated, true)
  assert.equal(body.chainId, DLE_LAB_CHAIN_ID)
  assert.equal(body.liveGroupCount, 1)
  assert.deepEqual(body.liveGroupIds, [DLE_LAB_GROUP_ID])
  const health = await fetch(`${archiveUrl}/health`)
  const healthBody = (await health.json()) as Record<string, unknown>
  assert.equal(healthBody.liveGroupCount, 1)
  const events = await fetch(`${archiveUrl}/api/v2/dle/events`)
  assert.equal(events.status, 200)
  const eventBody = (await events.json()) as { schema: string; events: unknown[] }
  assert.equal(eventBody.schema, 'DleExplorerEventsV1')
  assert.equal(Array.isArray(eventBody.events), true)
  const unknown = `0x${'ab'.repeat(32)}`
  const hashGet = await fetch(`${archiveUrl}/api/v2/dle/hash/${unknown}`)
  assert.equal(hashGet.status, 200)
  const hashBody = (await hashGet.json()) as { status?: string; planeWideNull?: boolean }
  assert.equal(hashBody.status, 'notFound')
  assert.equal(hashBody.planeWideNull, false)
})

test('unknown hashes are this-group notFound, not plane-wide null', async () => {
  const unknown = `0x${'cd'.repeat(32)}`
  const locate = await callArchive(archiveUrl, 'dle_locateHash', [unknown])
  assert.equal('result' in locate, true)
  if ('result' in locate && locate.result !== null && typeof locate.result === 'object') {
    const body = locate.result as { status?: string; planeWideNull?: boolean; scope?: string }
    assert.equal(body.status, 'notFound')
    assert.equal(body.planeWideNull, false)
    assert.equal(body.scope, 'thisGroup')
  }
  const byHash = await callArchive(archiveUrl, 'eth_getBlockByHash', [unknown, false])
  assert.equal('result' in byHash && byHash.result !== null, true)
  if ('result' in byHash && byHash.result !== null && typeof byHash.result === 'object') {
    assert.equal((byHash.result as { status?: string }).status, 'notFound')
  }
})

test('daemon command is isomorphic and can probe the archive over fetch', async () => {
  assert.equal(detectDaemonRuntime(), DLE_RUNTIME.nodejs)
  const probed = await probeArchive(archiveUrl)
  assert.equal(probed.daemon.command, DLE_COMMAND.daemon)
  assert.equal(probed.health['command'], DLE_COMMAND.archive)
  assert.equal(probed.wait.status, 'frozen')
  assert.equal(probed.wait.recomputed, true)
  assert.equal(probed.wait.committee.length, 7)
  assert.equal(probed.wait.standbys.length, 2)
  assert.equal(probed.wait.endorsed, false)
  assert.equal(probed.health['ondemandFrozen'], true)
})

test('P3 facade exposes waiting pool and recomputable selection', async () => {
  const pool = await callArchive(archiveUrl, 'dle_getWaitingPool')
  assert.equal('result' in pool, true)
  if (!('result' in pool) || pool.result === null || typeof pool.result !== 'object') {
    throw new Error('dle_getWaitingPool missing result')
  }
  const poolBody = pool.result as Record<string, unknown>
  assert.equal(poolBody.frozen, true)
  assert.equal(poolBody.minerCount, 9)
  const selection = await callArchive(archiveUrl, 'dle_getSelectionLog')
  assert.equal('result' in selection, true)
  if (!('result' in selection) || selection.result === null || typeof selection.result !== 'object') {
    throw new Error('dle_getSelectionLog missing result')
  }
  const log = selection.result as Record<string, unknown>
  assert.equal(log.available, true)
  assert.equal(log.endorsed, false)
  assert.equal(log.labBeacon, true)
  assert.equal(Array.isArray(log.committee) && log.committee.length === 7, true)
  const overview = await fetch(`${archiveUrl}/api/v2/dle`)
  const body = (await overview.json()) as Record<string, unknown>
  assert.equal(body.waitingPool !== null, true)
  assert.equal(body.selection !== null, true)
})
