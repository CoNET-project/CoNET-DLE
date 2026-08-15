import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { DLE_FORBIDDEN_L1_RPC_HOSTS } from '../src/shared/protocol.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BFT_DIR = join(ROOT, 'src/archive/bft')

async function listTs(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listTs(path)))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path)
  }
  return files
}

test('runtime BFT package does not import archive-a or archive-b', async () => {
  const files = await listTs(BFT_DIR)
  assert.equal(files.length > 0, true)
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    assert.equal(source.includes('implementations/archive-a'), false, path)
    assert.equal(source.includes('implementations/archive-b'), false, path)
    assert.equal(source.includes('archive-a/src'), false, path)
    assert.equal(source.includes('archive-b/src'), false, path)
  }
})

test('runtime BFT package never names L1 public RPC hosts', async () => {
  const files = await listTs(BFT_DIR)
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    for (const host of DLE_FORBIDDEN_L1_RPC_HOSTS) {
      assert.equal(source.includes(host), false, `${path} mentions ${host}`)
    }
  }
})
