import { describe, expect, it } from 'vitest'

const smokeEnabled = process.env.DSH_SMOKE === '1'
const harnessModule = '../scripts/smoke-dsh-install.mjs'

interface SmokeProfile {
  profile: string
  install: boolean
  bundle: boolean
  runtimePeers: boolean
  composition: boolean
  boot: boolean
  removal: boolean
  postRemoveBoot: boolean
}

interface SmokeReport {
  profiles: SmokeProfile[]
}

interface SmokeHarnessHelpers {
  redactSmokeOutput: (output: string, environment?: NodeJS.ProcessEnv) => string
  assertSmokeComposition: (dump: string, profile: string) => void
  assertNoPrivateRuntimeEntries: (entries: string[], profile: string) => void
}

describe('DSH install smoke safety checks', () => {
  it('redacts full authorization values, URL userinfo, and inherited sensitive values', async () => {
    const { redactSmokeOutput } = await import(harnessModule) as unknown as SmokeHarnessHelpers
    const bearerToken = ['ghp', 'topsecret'].join('_')
    const urlCredentials = ['smoke-user', 'url-password'].join(':')
    const inheritedToken = ['inherited', 'secret'].join('-')
    const output = [
      `Authorization: Bearer ${bearerToken}`,
      `https://${urlCredentials}@example.test/install`,
      `child output leaked ${inheritedToken}`,
    ].join('\n')

    const redacted = redactSmokeOutput(output, { [['DSH', 'AUTH', 'TOKEN'].join('_')]: inheritedToken })

    expect(redacted).not.toContain(bearerToken)
    expect(redacted).not.toContain(urlCredentials)
    expect(redacted).not.toContain(inheritedToken)
    expect(redacted).toContain('[REDACTED]')
  })

  it('rejects a disabled handoff composition entry', async () => {
    const { assertSmokeComposition } = await import(harnessModule) as unknown as SmokeHarnessHelpers

    expect(() => assertSmokeComposition([
      '- id: handoff-compaction',
      '  name: dsh-handoff-compaction',
      '  disabled: true',
    ].join('\n'), 'web')).toThrow('handoff compaction is disabled')
  })

  it('rejects a plugin that resolves a second DSH runtime tree', async () => {
    const { assertNoPrivateRuntimeEntries } = await import(harnessModule) as unknown as SmokeHarnessHelpers

    expect(() => assertNoPrivateRuntimeEntries([
      '@deepseek-ai+dsh-session@0.1.1-rc.2_peer-hash',
      '@deepseek-ai+dsh-tool-session-query@0.1.0-rc.8_peer-hash',
    ], 'web')).toThrow('contains private runtime copies')
  })
})

describe.skipIf(!smokeEnabled)('packed DSH plugin installation', () => {
  it('installs, composes, boots, and removes the packed plugin in web and headless profiles', async () => {
    const { runDshInstallSmoke } = await import(harnessModule) as unknown as {
      runDshInstallSmoke: () => Promise<SmokeReport>
    }

    const report = await runDshInstallSmoke()

    expect(report.profiles).toHaveLength(2)
    expect(report.profiles.map((profile) => profile.profile).sort()).toEqual(['headless', 'web'])
    expect(report.profiles.every((profile) => (
      profile.install && profile.bundle && profile.runtimePeers && profile.composition && profile.boot && profile.removal && profile.postRemoveBoot
    ))).toBe(true)
  })
})
