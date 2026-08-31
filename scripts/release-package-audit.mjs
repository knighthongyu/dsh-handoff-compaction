import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = resolve(dirname(fileURLToPath(new URL('../package.json', import.meta.url))))
const ALLOWED_ARCHIVE_PATHS = new Set([
  'LICENSE', 'README.md', 'README.zh.md', 'cordis.patch.yml', 'package.json',
  'lib/config.d.ts', 'lib/config.d.ts.map', 'lib/config.js', 'lib/config.js.map',
  'lib/handoff-engine.d.ts', 'lib/handoff-engine.d.ts.map', 'lib/handoff-engine.js', 'lib/handoff-engine.js.map',
  'lib/handoff-prompt.d.ts', 'lib/handoff-prompt.d.ts.map', 'lib/handoff-prompt.js', 'lib/handoff-prompt.js.map',
  'lib/handoff-validation.d.ts', 'lib/handoff-validation.d.ts.map', 'lib/handoff-validation.js', 'lib/handoff-validation.js.map',
  'lib/index.d.ts', 'lib/index.d.ts.map', 'lib/index.js', 'lib/index.js.map',
])
const SCAN_EXCLUDED_DIRECTORIES = new Set(['node_modules', '.pnpm-store', '.pda', '.superpowers', '.git'])
const INTENTIONAL_TEST_FIXTURES = new Set(['tests/fixtures/sessions/history.jsonl'])
const FORBIDDEN_PUBLIC_PATH = /(?:^|\/)(?:\.npmrc|\.netrc|\.env(?:\..*)?|\.dsh(?:-|$)|.*\.(?:sqlite(?:-(?:shm|wal))?|pem|key|p12|jsonl|log)|(?:credentials?|secrets?|tokens?|sessions?)\.(?:json|jsonl|log|db))$/i
const FORBIDDEN_PUBLIC_CONTENT = /\/Users\/hy|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:authorization|x-api-key|api[_-]?key|token|password|secret)\s*[:=]\s*(?:bearer\s+)?[A-Za-z0-9._~+/=-]{8,}/i

function tarText(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
}

function tarSize(header) {
  const value = tarText(header, 124, 12).trim()
  return value === '' ? 0 : Number.parseInt(value, 8)
}

function tarFiles(archive) {
  const payload = gunzipSync(archive)
  const files = []
  for (let offset = 0; offset + 512 <= payload.length;) {
    const header = payload.subarray(offset, offset + 512)
    if (header.every((value) => value === 0)) break
    const prefix = tarText(header, 345, 155)
    const name = tarText(header, 0, 100)
    const size = tarSize(header)
    const path = [prefix, name].filter(Boolean).join('/').replace(/^package\//, '')
    const type = String.fromCharCode(header[156] ?? 0)
    if (path !== '' && (type === '\0' || type === '0')) files.push(path)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files.sort()
}

async function publicTreeFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = join(directory, entry.name)
    const path = relative(root, absolute)
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDED_DIRECTORIES.has(entry.name) || path === 'docs/superpowers') continue
      if (!INTENTIONAL_TEST_FIXTURES.has(path) && FORBIDDEN_PUBLIC_PATH.test(path)) throw new Error(`release audit: forbidden public path ${path}`)
      files.push(...await publicTreeFiles(absolute, root))
    } else if (entry.isFile() && entry.name !== '.DS_Store') files.push(path)
  }
  return files.sort()
}

export async function assertSafePublicTree(root) {
  const files = await publicTreeFiles(root)
  for (const path of files) {
    if (!INTENTIONAL_TEST_FIXTURES.has(path) && FORBIDDEN_PUBLIC_PATH.test(path)) throw new Error(`release audit: forbidden public path ${path}`)
    const content = await readFile(join(root, path), 'utf8').catch(() => '')
    if (FORBIDDEN_PUBLIC_CONTENT.test(content)) throw new Error(`release audit: forbidden machine/private content in ${path}`)
  }
  return files
}

export function assertArchiveSurface(files) {
  for (const path of files) {
    if (!ALLOWED_ARCHIVE_PATHS.has(path)) throw new Error(`release audit: unexpected archive path: ${path}`)
  }
  for (const path of ALLOWED_ARCHIVE_PATHS) if (!files.includes(path)) throw new Error(`release audit: required archive path missing: ${path}`)
}

/** Keep one inspected real tarball alive only while the supplied callback consumes it. */
export async function withReleasePackageArchive(callback) {
  const tempRoot = await realpath(tmpdir())
  const directory = await mkdtemp(join(tempRoot, 'dsh-release-audit-'))
  try {
    await execFileAsync('pnpm', ['pack', '--pack-destination', directory], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, CI: 'true' },
      maxBuffer: 1024 * 1024,
    })
    const tarballs = (await readdir(directory)).filter((path) => path.endsWith('.tgz'))
    if (tarballs.length !== 1) throw new Error(`release audit: expected one tarball, found ${String(tarballs.length)}`)
    const filename = tarballs[0]
    const archivePath = join(directory, filename)
    const archive = await readFile(archivePath)
    const files = tarFiles(archive)
    assertArchiveSurface(files)
    const publicFiles = await assertSafePublicTree(PROJECT_ROOT)
    return await callback({
      filename,
      sha256: createHash('sha256').update(archive).digest('hex'),
      files,
      publicFiles,
      archivePath,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Create, inspect, checksum, and always clean one real npm tarball. */
export async function runReleasePackageAudit() {
  return withReleasePackageArchive(async (archive) => archive)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleasePackageAudit().then(
    ({ filename, sha256, files }) => process.stdout.write(`${JSON.stringify({ filename, sha256, files })}\n`),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
