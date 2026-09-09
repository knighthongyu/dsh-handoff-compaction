import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

interface PackFile {
  readonly path: string
}

interface PackResult {
  readonly files: readonly PackFile[]
}

describe('published package surface', () => {
  it('declares the complete public repository and package metadata', async () => {
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      version: string
      license: string
      packageManager?: string
      repository?: { type?: string; url?: string }
      bugs?: { url?: string }
      homepage?: string
      keywords?: string[]
    }

    expect(manifest.version).toBe('0.1.2')
    expect(manifest.license).toBe('MIT')
    expect(manifest.packageManager).toBe('pnpm@11.22.0')
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/knighthongyu/dsh-handoff-compaction.git',
    })
    expect(manifest.bugs).toEqual({
      url: 'https://github.com/knighthongyu/dsh-handoff-compaction/issues',
    })
    expect(manifest.homepage).toBe(
      'https://github.com/knighthongyu/dsh-handoff-compaction#readme',
    )
    const keywords = manifest.keywords?.map((keyword) => keyword.toLowerCase())
    for (const keyword of ['dsh', 'context-compaction', 'handoff', 'session-history']) {
      expect(keywords).toContain(keyword)
    }
  })

  it('ships a canonical MIT license and safe public ignore rules', async () => {
    const license = await readFile(resolve('LICENSE'), 'utf8')
    expect(license).toBe(`MIT License

Copyright (c) 2026 knighthongyu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`)

    const ignoreLines = (await readFile(resolve('.gitignore'), 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
    for (const rule of [
      'node_modules/',
      '.pnpm-store/',
      '.pda/',
      '.superpowers/',
      'docs/superpowers/',
      '.DS_Store',
      'coverage/',
      '*.log',
      '*.tgz',
      '.pack-output/',
      '.env*',
      '!.env.example',
      '!.env.*.example',
      '.dsh/',
      'session-query.sqlite*',
      '*.sqlite',
      '*.sqlite-shm',
      '*.sqlite-wal',
    ]) {
      expect(ignoreLines, `missing ignore rule ${rule}`).toContain(rule)
    }
    for (const publicPath of [
      'lib/',
      'src/',
      'tests/',
      'docs/',
      'README.md',
      'README.zh.md',
      'pnpm-lock.yaml',
    ]) {
      expect(ignoreLines).not.toContain(publicPath)
    }
  })

  it('activates only through the standard DSH Bundle declaration', async () => {
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      bin?: unknown
      dsh: unknown
      scripts?: Record<string, string>
    }

    expect(manifest.bin).toBeUndefined()
    expect(manifest.dsh).toEqual({ bundle: { patch: './cordis.patch.yml' } })
    for (const lifecycle of ['prepare', 'preinstall', 'install', 'postinstall']) {
      expect(manifest.scripts).not.toHaveProperty(lifecycle)
    }
  })

  it('retains the history runtime without installer-only dependencies', async () => {
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(manifest.dependencies).toHaveProperty(
      '@deepseek-ai/dsh-tool-session-query',
    )
    for (const dependency of [
      'js-yaml',
      '@types/js-yaml',
      '@deepseek-ai/cordis-plugin-include',
    ]) {
      expect(manifest.dependencies).not.toHaveProperty(dependency)
      expect(manifest.peerDependencies).not.toHaveProperty(dependency)
      expect(manifest.devDependencies).not.toHaveProperty(dependency)
    }
  })

  it('tests and declares compatibility with the installed DSH 0.1.2 prerelease', async () => {
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const peers = manifest.peerDependencies ?? {}
    const dev = manifest.devDependencies ?? {}

    for (const dependency of [
      '@deepseek-ai/dsh',
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-compaction-basic',
      '@deepseek-ai/dsh-invariants',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-session-query',
      '@deepseek-ai/dsh-system-prompt',
      '@deepseek-ai/dsh-timeout',
      '@deepseek-ai/dsh-tools',
    ]) {
      expect(peers[dependency]).toContain('^0.1.2-rc.1')
      expect(dev[dependency]).toBe('0.1.2-rc.1')
    }
    expect(dev['@deepseek-ai/cordis']).toBe('4.0.2')
    expect(dev).not.toHaveProperty('@deepseek-ai/dsh-agent-loop-testkit')
  })

  it('builds resolvable public entry points at the declared paths', async () => {
    execFileSync('pnpm', ['build'], {
      cwd: process.cwd(),
      env: { ...process.env, CI: 'true' },
      stdio: 'pipe',
    })

    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      main: string
      types: string
      dsh: { bundle: { patch: string } }
    }
    await expect(stat(resolve(manifest.main))).resolves.toBeDefined()
    await expect(stat(resolve(manifest.types))).resolves.toBeDefined()
    await expect(stat(resolve(manifest.dsh.bundle.patch))).resolves.toBeDefined()
  })

  it('packs only the declared runtime and documentation surface', () => {
    const output = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, CI: 'true' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const result = JSON.parse(output) as PackResult
    const paths = result.files.map((file) => file.path)

    expect(paths).toContain('package.json')
    expect(paths).toContain('cordis.patch.yml')
    expect(paths).toContain('README.md')
    expect(paths).toContain('README.zh.md')
    expect(paths).toContain('LICENSE')
    expect(paths).toContain('lib/index.js')
    expect(paths).toContain('lib/index.d.ts')
    expect(
      paths.filter((path) => /^lib\/(cli|preset-installer)/.test(path)),
    ).toEqual([])
    expect(paths.some((path) => /^(src|tests|\.pda|docs)\//.test(path))).toBe(false)
    expect(paths.some((path) => /(^|\/)(\.env|.*fixture.*|.*\.sqlite)$/.test(path))).toBe(false)
  })
})
