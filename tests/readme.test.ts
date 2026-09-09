import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const sharedIdentifiers = [
  'dsh plugin --profile headless add dsh-handoff-compaction',
  'dsh plugin --profile web add dsh-handoff-compaction',
  'dsh plugin --profile headless remove dsh-handoff-compaction',
  'dsh plugin --profile web remove dsh-handoff-compaction',
  'dsh plugin --profile web add github:knighthongyu/dsh-handoff-compaction',
  'dsh plugin --profile web add ./dsh-handoff-compaction',
  'dsh plugin --profile web add ./dsh-handoff-compaction-0.1.2.tgz',
  'thresholdRatio: 0.8',
  'retainTokens: 16000',
  'maxTokens: 8192',
  'session-query.sqlite',
  'session_search',
  'session_event_search',
  'session_trace',
  'session_event_trace',
  'session_event_read',
  '@deepseek-ai/dsh-tool-session-query',
  '0.1.0-rc.8',
  '0.1.1-rc.2',
  '0.1.2-rc.1',
  'pnpm install',
  'pnpm typecheck',
  'pnpm test',
  'pnpm build',
]

const legacyPresetNames = [
  'handoff-standard',
  'handoff-code',
  'handoff-cordis',
]

describe.each([
  {
    filename: 'README.md',
    languageMarkers: [
      /profile-wide/i,
      /restart/i,
      /optional/i,
      /manual/i,
      /confirm/i,
    ],
    recoveryPatterns: [
      /invalid Markdown or tool calls[^.]*one immediate recovery (attempt|call) inside the same compaction transaction/i,
      /one immediate recovery (attempt|call) inside the same compaction transaction/i,
      /same system prompt, tools, and source-message prefix/i,
      /only the short final (recovery )?instruction changes/i,
    ],
    removalPatterns: [
      /restart .*profile normally after removal/i,
      /remaining profile Bundle configuration/i,
      /native compactor/i,
    ],
    forbiddenSemantics: [],
  },
  {
    filename: 'README.zh.md',
    languageMarkers: [/整个 profile/i, /重启/i, /可选/i, /手动/i, /确认/i],
    recoveryPatterns: [
      /无效 Markdown 或 tool calls[^。]*同一压缩事务内立即进行一次恢复调用/,
      /同一压缩事务内立即进行一次恢复调用/,
      /相同的 system prompt、tools 和源消息前缀/,
      /只改变简短的最终恢复指令/,
    ],
    removalPatterns: [
      /移除后.*正常重启.*profile/,
      /剩余的 profile Bundle 配置/,
      /基础 profile.*提供.*原生压缩器/,
    ],
    forbiddenSemantics: [
      /下一次独立尝试/,
      /不会在一次压缩事务中.*第二次 LLM 调用/,
    ],
  },
])('$filename', ({
  filename,
  languageMarkers,
  recoveryPatterns,
  removalPatterns,
  forbiddenSemantics,
}) => {
  it('documents the public one-command installation and operations contract', async () => {
    const text = await readFile(resolve(filename), 'utf8')
    for (const identifier of sharedIdentifiers) {
      expect(text, `missing ${identifier}`).toContain(identifier)
    }
    for (const legacyPresetName of legacyPresetNames) {
      expect(text, `missing optional cleanup name ${legacyPresetName}`).toContain(
        legacyPresetName,
      )
    }
    for (const marker of languageMarkers) {
      expect(text).toMatch(marker)
    }
    expect(text).toMatch(/no automatic (RAG|retrieval)/i)
    expect(text).toMatch(/tool-result-pruner/i)
    expect(text).toMatch(/existing sessions/i)
    expect(text).toMatch(/must not delete/i)
  })

  it('does not document the removed executable or Preset-selection journey', async () => {
    const text = await readFile(resolve(filename), 'utf8')
    const removedExecutable = ['install', 'presets'].join('-')

    expect(text).not.toContain(removedExecutable)
    expect(text).not.toMatch(/select .*handoff-(standard|code|cordis)/i)
    expect(text).not.toMatch(/选择.*handoff-(standard|code|cordis)/i)
  })

  it('documents recovery and removal lifecycle semantics', async () => {
    const text = await readFile(resolve(filename), 'utf8')

    for (const pattern of [...recoveryPatterns, ...removalPatterns]) {
      expect(text).toMatch(pattern)
    }
    for (const pattern of forbiddenSemantics) {
      expect(text).not.toMatch(pattern)
    }
  })

  it('documents cache-alignment controls and the cross-route boundary', async () => {
    const text = await readFile(resolve(filename), 'utf8')

    expect(text).toContain('reasoningEffort')
    expect(text).toContain('temperature')
    expect(text).toContain('stop')
    expect(text).toContain('cacheAlignment')
    if (filename === 'README.md') {
      expect(text).toMatch(/different summary route.*cannot reuse/i)
    } else {
      expect(text).toMatch(/不同摘要路由.*无法复用/)
    }
  })

  it('documents profile-scoped read-only verification after installation', async () => {
    const text = await readFile(resolve(filename), 'utf8')

    for (const command of [
      'dsh plugin --profile web list --depth 0',
      'dsh plugin --profile headless list --depth 0',
      'dsh --profile web --dump-config',
      'dsh --profile headless --dump-config',
    ]) expect(text, `missing verification command ${command}`).toContain(command)

    if (filename === 'README.md') {
      expect(text).toMatch(/dsh-handoff-compaction.*installed/i)
      expect(text).toMatch(/active `handoff-compaction` entry.*`dsh-handoff-compaction`/i)
      expect(text).toMatch(/documented defaults.*history configuration/i)
      expect(text).toMatch(/read-only verification.*not a second setup step/i)
    } else {
      expect(text).toMatch(/dsh-handoff-compaction.*已安装/)
      expect(text).toMatch(/活动的 `handoff-compaction` 条目.*`dsh-handoff-compaction`/)
      expect(text).toMatch(/已记录的默认值.*历史配置/)
      expect(text).toMatch(/只读验证.*不是第二次设置步骤/)
    }
  })

  it('distinguishes the visible SQLite backend from the runtime history-tool provider', async () => {
    const text = await readFile(resolve(filename), 'utf8')
    const sectionStart = text.indexOf(filename === 'README.md' ? '### Verify the profile' : '### 验证 profile')
    const sectionEnd = text.indexOf(filename === 'README.md' ? 'Installation is a profile-wide replacement.' : '安装会替换整个 profile 的压缩配置。')
    const verificationSection = text.slice(sectionStart, sectionEnd)

    if (filename === 'README.md') {
      expect(verificationSection).toMatch(/visible SQLite backend entry `@deepseek-ai\/dsh-session-query-sqlite`.*`openAt: first-search`.*`session-query\.sqlite`/i)
      expect(verificationSection).toMatch(/`@deepseek-ai\/dsh-tool-session-query` supplies the five runtime history tools.*not the visible SQLite backend/i)
      expect(verificationSection).not.toMatch(/`@deepseek-ai\/dsh-tool-session-query` SQLite (?:history )?backend/i)
      expect(verificationSection).not.toMatch(/`@deepseek-ai\/dsh-tool-session-query` is (?:the )?(?:visible )?SQLite backend/i)
    } else {
      expect(verificationSection).toMatch(/可见的 SQLite 后端条目 `@deepseek-ai\/dsh-session-query-sqlite`.*`openAt: first-search`.*`session-query\.sqlite`/)
      expect(verificationSection).toMatch(/`@deepseek-ai\/dsh-tool-session-query`.*提供五个运行时历史工具.*不是.*可见的 SQLite 后端/)
      expect(verificationSection).not.toMatch(/`@deepseek-ai\/dsh-tool-session-query` SQLite 历史后端/)
      expect(verificationSection).not.toMatch(/`@deepseek-ai\/dsh-tool-session-query` 是(?:可见的)? SQLite 后端/)
    }
  })
})

it('links the Chinese README near the top of the English README', async () => {
  const text = await readFile(resolve('README.md'), 'utf8')
  expect(text.slice(0, 600)).toMatch(/\[[^\]]*中文[^\]]*\]\(README\.zh\.md\)/)
})
