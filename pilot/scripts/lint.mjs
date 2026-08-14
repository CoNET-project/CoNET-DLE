import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const root = new URL('..', import.meta.url)
const failures = []

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['dist', 'node_modules', '.tmp'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await visit(path)
      continue
    }
    if (!['.ts', '.mjs'].includes(extname(entry.name))) continue
    const source = await readFile(path, 'utf8')
    const label = relative(root.pathname, path)
    if (/\b(?:window\.)?setInterval\s*\(/u.test(source)) {
      failures.push(`${label}: setInterval is forbidden`)
    }
    source.split('\n').forEach((line, index) => {
      if (/[ \t]+$/u.test(line)) failures.push(`${label}:${index + 1}: trailing whitespace`)
    })
  }
}

await visit(root.pathname)
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log('lint: clean')
}
