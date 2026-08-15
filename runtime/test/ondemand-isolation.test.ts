import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { DLE_FORBIDDEN_L1_RPC_HOSTS } from '../src/shared/protocol.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function listTs(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listTs(path)))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path)
  }
  return files
}

test('shared and archive on-demand packages do not import archive-a or archive-b', async () => {
  const files = [
    ...(await listTs(join(ROOT, 'src/shared/ondemand'))),
    ...(await listTs(join(ROOT, 'src/archive/ondemand'))),
    join(ROOT, 'src/daemon/core.ts'),
  ]
  assert.equal(files.length > 3, true)
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    assert.equal(source.includes('implementations/archive-a'), false, path)
    assert.equal(source.includes('implementations/archive-b'), false, path)
    for (const host of DLE_FORBIDDEN_L1_RPC_HOSTS) {
      assert.equal(source.includes(host), false, `${path} mentions ${host}`)
    }
  }
})

test('isomorphic on-demand encoding never imports node builtins', async () => {
  const files = await listTs(join(ROOT, 'src/shared/ondemand'))
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    assert.equal(source.includes('node:'), false, path)
  }
  const core = await readFile(join(ROOT, 'src/daemon/core.ts'), 'utf8')
  assert.equal(core.includes("from '../archive/"), false)
  assert.equal(core.includes('from "../archive/'), false)
})
