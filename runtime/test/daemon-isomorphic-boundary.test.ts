import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const DAEMON_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../src/daemon')
const ISOMORPHIC = new Set(['core.ts', 'browser.ts'])
const NODE_ONLY = new Set(['cli.ts', 'serve-browser.ts', 'fleet-cli.ts'])

async function listTs(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== 'public') files.push(...(await listTs(path)))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path)
  }
  return files
}

test('daemon isomorphic sources do not import node builtins', async () => {
  const files = await listTs(DAEMON_ROOT)
  const isomorphic = files.filter((path) => ISOMORPHIC.has(path.slice(path.lastIndexOf('/') + 1)))
  assert.deepEqual(
    isomorphic.map((path) => relative(DAEMON_ROOT, path)).sort(),
    [...ISOMORPHIC].sort(),
  )
  for (const path of isomorphic) {
    const source = await readFile(path, 'utf8')
    assert.equal(source.includes('node:'), false, `${relative(DAEMON_ROOT, path)} imported a node: module`)
    assert.equal(source.includes('from "fs"'), false)
    assert.equal(source.includes("from 'fs'"), false)
  }
})

test('daemon Node launchers stay out of the browser compile set', async () => {
  const files = await listTs(DAEMON_ROOT)
  const nodeOnly = files.filter((path) => NODE_ONLY.has(path.slice(path.lastIndexOf('/') + 1)))
  assert.equal(nodeOnly.length, NODE_ONLY.size)
  for (const path of nodeOnly) {
    const source = await readFile(path, 'utf8')
    assert.equal(source.includes('node:'), true, `${relative(DAEMON_ROOT, path)} should be a Node launcher`)
  }
})
