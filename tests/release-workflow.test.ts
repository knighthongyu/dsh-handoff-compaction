import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflowPath = resolve('.github/workflows/ci.yml')
const auditModule = '../scripts/release-package-audit.mjs'
const verifyModule = '../scripts/verify-release.mjs'

interface ArchiveAudit {
  filename: string
  sha256: string
  files: string[]
  archivePath: string
}

interface ArchiveValidators {
  assertArchiveSurface: (files: string[]) => void
  assertSafePublicTree: (root: string) => Promise<string[]>
}

describe('release workflow contract', () => {
  it('uses frozen pnpm verification for pull requests and main pushes', async () => {
    const workflow = await readFile(workflowPath, 'utf8')

    expect(workflow).toMatch(/pull_request:/)
    expect(workflow).toMatch(/push:\s*\n\s+branches:\s*\[main\]/)
    expect(workflow).toContain('actions/checkout@')
    expect(workflow).toContain('actions/setup-node@')
    expect(workflow).toMatch(/node-version:\s*['"]?24/)
    expect(workflow).toContain('corepack enable')
    expect(workflow).toContain('corepack prepare pnpm@11.22.0 --activate')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm verify:release')

    const cacheSetup = workflow.indexOf('cache: pnpm')
    const pnpmActivation = workflow.indexOf('corepack prepare pnpm@11.22.0 --activate')
    expect(cacheSetup).toBeGreaterThan(pnpmActivation)
  })

  it('defines a non-recursive release graph that includes the real DSH smoke', async () => {
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const scripts = manifest.scripts ?? {}

    expect(scripts.check).toContain('pnpm typecheck')
    expect(scripts.check).toContain('pnpm build')
    expect(scripts.check).toContain('pnpm test')
    expect(scripts['check:package']).toContain('release-package-audit.mjs')
    expect(scripts['verify:release']).toContain('pnpm check')
    expect(scripts['verify:release']).toContain('scripts/verify-release.mjs')
    expect(scripts['verify:release']).not.toContain('pnpm check:package')
    expect(scripts['verify:release']).not.toContain('pnpm smoke:dsh')
    expect(scripts['verify:release']).not.toContain('verify:release')
    expect(scripts['verify:release']).not.toMatch(/publish|plugin\s+(?:install|setup)/i)
  })

  it('rejects stale archive files and credential/session fixtures outside intentional tests', async () => {
    const { assertArchiveSurface, assertSafePublicTree } = await import(auditModule) as unknown as ArchiveValidators
    const allowed = [
      'LICENSE', 'README.md', 'README.zh.md', 'cordis.patch.yml', 'package.json',
      'lib/config.d.ts', 'lib/config.d.ts.map', 'lib/config.js', 'lib/config.js.map',
      'lib/handoff-engine.d.ts', 'lib/handoff-engine.d.ts.map', 'lib/handoff-engine.js', 'lib/handoff-engine.js.map',
      'lib/handoff-prompt.d.ts', 'lib/handoff-prompt.d.ts.map', 'lib/handoff-prompt.js', 'lib/handoff-prompt.js.map',
      'lib/handoff-validation.d.ts', 'lib/handoff-validation.d.ts.map', 'lib/handoff-validation.js', 'lib/handoff-validation.js.map',
      'lib/index.d.ts', 'lib/index.d.ts.map', 'lib/index.js', 'lib/index.js.map',
    ]
    expect(() => assertArchiveSurface([...allowed, 'lib/stale-helper.js'])).toThrow('unexpected archive path')

    const fixture = await mkdtemp(join(tmpdir(), 'dsh-release-audit-fixture-'))
    try {
      const token = ['realistic', 'token', 'value'].join('-')
      await writeFile(join(fixture, '.npmrc'), `//registry.example/:_authToken=${token}\n`)
      await expect(assertSafePublicTree(fixture)).rejects.toThrow('forbidden public path')
      await rm(join(fixture, '.npmrc'))
      await writeFile(join(fixture, 'config.js'), `Authorization: Bearer ${token}\n`)
      await expect(assertSafePublicTree(fixture)).rejects.toThrow('forbidden machine/private content')
      await rm(join(fixture, 'config.js'))
      await writeFile(join(fixture, 'session.jsonl'), '{}\n')
      await expect(assertSafePublicTree(fixture)).rejects.toThrow('forbidden public path')
      await rm(join(fixture, 'session.jsonl'))
      await mkdir(join(fixture, 'tests'))
      await writeFile(join(fixture, 'tests', 'session.jsonl'), '{}\n')
      await expect(assertSafePublicTree(fixture)).rejects.toThrow('forbidden public path')
      await rm(join(fixture, 'tests', 'session.jsonl'))
      await writeFile(join(fixture, 'tests', 'ordinary.test.ts'), `Authorization: Bearer ${token}\n`)
      await expect(assertSafePublicTree(fixture)).rejects.toThrow('forbidden machine/private content')
      await rm(join(fixture, 'tests', 'ordinary.test.ts'))
      const knownFixture = join(fixture, 'tests', 'fixtures', 'sessions', 'history.jsonl')
      await mkdir(join(fixture, 'tests', 'fixtures', 'sessions'), { recursive: true })
      const machinePath = ['', 'Users', 'hy'].join('/')
      const fixtureTokenKey = ['auth', 'token'].join('_')
      const fixtureTokenValue = ['fixture', 'sensitive', 'token'].join('-')
      const privateKeyHeader = ['-----BEGIN', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ')
      await writeFile(knownFixture, `${machinePath}/private-machine-note\n`)
      await expect(assertSafePublicTree(fixture)).rejects.toThrow('forbidden machine/private content')
      await writeFile(knownFixture, `${privateKeyHeader}\n`)
      await expect(assertSafePublicTree(fixture)).rejects.toThrow('forbidden machine/private content')
      await writeFile(knownFixture, `${fixtureTokenKey}=${fixtureTokenValue}\n`)
      await expect(assertSafePublicTree(fixture)).rejects.toThrow('forbidden machine/private content')
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })

  it('hands one live audited tarball to smoke before cleanup', async () => {
    const { runVerifiedRelease } = await import(verifyModule) as unknown as {
      runVerifiedRelease: (options: { runSmoke: (options: { tarball: string }) => Promise<unknown> }) => Promise<{ archive: ArchiveAudit }>
    }
    let receivedArchive = ''

    const result = await runVerifiedRelease({
      runSmoke: async ({ tarball }) => {
        receivedArchive = tarball
        await expect(access(tarball)).resolves.toBeUndefined()
        return { tarball }
      },
    })

    expect(receivedArchive).toBe(result.archive.archivePath)
    await expect(access(receivedArchive)).rejects.toThrow()
  })

  it('emits and cleans a real package archive audit', async () => {
    const { runReleasePackageAudit } = await import(auditModule) as unknown as {
      runReleasePackageAudit: () => Promise<ArchiveAudit>
    }
    const audit = await runReleasePackageAudit()

    expect(audit.filename).toMatch(/^dsh-handoff-compaction-0\.1\.0\.tgz$/)
    expect(audit.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(audit.files).toEqual(expect.arrayContaining([
      'package.json',
      'cordis.patch.yml',
      'README.md',
      'README.zh.md',
      'LICENSE',
      'lib/index.js',
      'lib/index.d.ts',
    ]))
    expect(audit.files.some((path) => /^(src|tests|docs|\.superpowers)\//.test(path))).toBe(false)
    await expect(access(audit.archivePath)).rejects.toThrow()
  })

  it('keeps local orchestration out of the public candidate while retaining normal source', async () => {
    const ignoreLines = (await readFile(resolve('.gitignore'), 'utf8')).split(/\r?\n/)

    expect(ignoreLines).toContain('.superpowers/')
    expect(ignoreLines).toContain('docs/superpowers/')
    for (const publicPath of ['src/', 'tests/', 'docs/', 'README.md', 'README.zh.md']) {
      expect(ignoreLines).not.toContain(publicPath)
    }
  })
})
