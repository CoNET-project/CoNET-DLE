import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { startArchiveNode } from '../src/archive/node.js'
import { callArchive, detectDaemonRuntime, probeArchive } from '../src/daemon/core.js'
import { DLE_COMMAND, DLE_LAB_CHAIN_ID, DLE_RUNTIME, chainIdHex } from '../src/shared/protocol.js'

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
  assert.equal(body.chainId, DLE_LAB_CHAIN_ID)
})

test('archive JSON-RPC returns a DLE chain id and rejects tip VM calls', async () => {
  const chainId = await callArchive(archiveUrl, 'eth_chainId')
  assert.equal('result' in chainId && chainId.result, chainIdHex(DLE_LAB_CHAIN_ID))
  const call = await callArchive(archiveUrl, 'eth_call', [])
  assert.equal('error' in call, true)
  if ('error' in call) assert.match(call.error.message, /no tip VM/)
})

test('archive exposes a read-only /api/v2/dle explorer surface', async () => {
  const overview = await fetch(`${archiveUrl}/api/v2/dle`)
  assert.equal(overview.status, 200)
  const body = (await overview.json()) as Record<string, unknown>
  assert.equal(body.schema, 'DleExplorerApiV1')
  assert.equal(body.producesBlocks, false)
  assert.equal(body.hasTipVm, false)
  assert.equal(body.chainId, DLE_LAB_CHAIN_ID)
  const events = await fetch(`${archiveUrl}/api/v2/dle/events`)
  assert.equal(events.status, 200)
  const eventBody = (await events.json()) as { schema: string; events: unknown[] }
  assert.equal(eventBody.schema, 'DleExplorerEventsV1')
  assert.equal(Array.isArray(eventBody.events), true)
})

test('daemon command is isomorphic and can probe the archive over fetch', async () => {
  assert.equal(detectDaemonRuntime(), DLE_RUNTIME.nodejs)
  const probed = await probeArchive(archiveUrl)
  assert.equal(probed.daemon.command, DLE_COMMAND.daemon)
  assert.equal(probed.health['command'], DLE_COMMAND.archive)
  assert.equal(probed.wait.status, 'queued')
})
