import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

type ArchiveId = 'archive-a' | 'archive-b'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..')
const ARCHIVE_ROOTS: Record<ArchiveId, string> = {
  'archive-a': resolve(ROOT, 'implementations/archive-a'),
  'archive-b': resolve(ROOT, 'implementations/archive-b'),
}
const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts'])
const SKIPPED_DIRECTORIES = new Set(['dist', 'node_modules', '.git'])

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep))
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...(await collectTypeScriptFiles(path)))
      continue
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(path)
  }
  return files
}

function literalModuleSpecifier(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined
}

function moduleSpecifiers(sourceFile: ts.SourceFile): Array<{ specifier: string; line: number }> {
  const found: Array<{ specifier: string; line: number }> = []
  const add = (node: ts.Node, specifier: string | undefined): void => {
    if (specifier !== undefined) {
      found.push({ specifier, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 })
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node, literalModuleSpecifier(node.moduleSpecifier))
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, literalModuleSpecifier(node.moduleReference.expression))
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      add(node, literalModuleSpecifier(node.arguments[0]))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function referencesArchive(specifier: string, sourcePath: string, targetArchive: ArchiveId): boolean {
  const targetRoot = ARCHIVE_ROOTS[targetArchive]
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return isInside(targetRoot, resolve(dirname(sourcePath), specifier))
  }
  return (
    specifier === targetArchive ||
    specifier.startsWith(`${targetArchive}/`) ||
    specifier === `@conet-dle/${targetArchive}` ||
    specifier.startsWith(`@conet-dle/${targetArchive}/`)
  )
}

async function scanArchive(archive: ArchiveId): Promise<string[]> {
  const otherArchive: ArchiveId = archive === 'archive-a' ? 'archive-b' : 'archive-a'
  const violations: string[] = []
  for (const path of (await collectTypeScriptFiles(ARCHIVE_ROOTS[archive])).sort()) {
    const source = await readFile(path, 'utf8')
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true)
    for (const { specifier, line } of moduleSpecifiers(sourceFile)) {
      if (referencesArchive(specifier, path, otherArchive)) {
        violations.push(`${relative(ROOT, path)}:${line} imports ${specifier}`)
      }
    }
  }
  return violations
}

const violations = (await Promise.all((['archive-a', 'archive-b'] as const).map(scanArchive))).flat()
if (violations.length > 0) {
  process.stderr.write(`Cross-archive imports are prohibited:\n${violations.map((item) => `- ${item}`).join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Dependency boundary check passed: Archive A and Archive B have no cross-archive imports\n')
}
