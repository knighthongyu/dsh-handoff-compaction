import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-handoff-compaction'
const PROFILES = ['web', 'headless']
const DEFAULT_TIMEOUT_MS = 90_000
const WEB_READY_TIMEOUT_MS = 45_000
const TERMINATION_GRACE_MS = 5_000
const OUTPUT_LIMIT = 80_000

/** @typedef {{ profile: string, home: string, install: boolean, bundle: boolean, composition: boolean, boot: boolean, removal: boolean, postRemoveBoot: boolean }} SmokeProfile */
/** @typedef {{ tempRoot: string, tarball: string, homes: string[], profiles: SmokeProfile[] }} SmokeReport */

class SmokeStageError extends Error {
  constructor(profile, stage, message, output = {}) {
    super(`[${profile}:${stage}] ${message}\nstdout:\n${redactSmokeOutput(output.stdout ?? '')}\nstderr:\n${redactSmokeOutput(output.stderr ?? '')}`)
    this.name = 'SmokeStageError'
  }
}

const SENSITIVE_ENVIRONMENT_KEY = /api[_-]?key|token|authorization|password|secret/i

/** Redact credentials from child-process output before it can reach a stage error. */
export function redactSmokeOutput(output, environment = process.env) {
  let redacted = String(output)
    .replace(/(^|[\r\n])([^\r\n]*?\b(?:proxy-)?authorization\b\s*[:=])[^\r\n]*/gi, '$1$2[REDACTED]')
    .replace(/(^|[\r\n])([^\r\n]*?\b(?:x[-_])?(?:api[-_]?key|token|password|secret)\b\s*[:=])[^\r\n]*/gi, '$1$2[REDACTED]')
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^/\s@]+@/gi, '$1[REDACTED]@')
  const sensitiveValues = Object.entries(environment)
    .filter(([name, value]) => SENSITIVE_ENVIRONMENT_KEY.test(name) && typeof value === 'string' && value.length > 0)
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length)
  for (const value of sensitiveValues) redacted = redacted.split(value).join('[REDACTED]')
  return redacted.slice(-OUTPUT_LIMIT)
}

function profilePath(home, profile) {
  return join(home, 'profiles', profile)
}

function assert(condition, profile, stage, message, output) {
  if (!condition) throw new SmokeStageError(profile, stage, message, output)
}

function childEnvironment(home) {
  return { ...process.env, CI: 'true', DSH_HOME: home }
}

function terminateHarnessChild(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
  child.kill(signal)
}

function runCommand(command, args, { cwd, env, profile, stage, timeoutMs = DEFAULT_TIMEOUT_MS, onStage }) {
  return new Promise((resolveResult, rejectResult) => {
    onStage?.(`${profile}:${stage}`)
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const append = (current, chunk) => `${current}${chunk}`.slice(-OUTPUT_LIMIT)
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk.toString()) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk.toString()) })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      terminateHarnessChild(child, 'SIGTERM')
      setTimeout(() => terminateHarnessChild(child, 'SIGKILL'), TERMINATION_GRACE_MS).unref()
      setTimeout(() => {
        if (!settled) {
          settled = true
          rejectResult(new SmokeStageError(profile, stage, `command timed out after ${String(timeoutMs)}ms and did not close within ${String(TERMINATION_GRACE_MS)}ms`, { stdout, stderr }))
        }
      }, TERMINATION_GRACE_MS + 50).unref()
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        rejectResult(new SmokeStageError(profile, stage, error.message, { stdout, stderr }))
      }
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      const output = { stdout, stderr }
      if (code !== 0) {
        const message = timedOut
          ? `command timed out after ${String(timeoutMs)}ms`
          : `command exited with ${signal ?? `code ${String(code)}`}`
        rejectResult(new SmokeStageError(profile, stage, message, output))
        return
      }
      resolveResult(output)
    })
  })
}

async function readManifest(home, profile, stage) {
  try {
    return JSON.parse(await readFile(join(profilePath(home, profile), 'package.json'), 'utf8'))
  } catch (error) {
    throw new SmokeStageError(profile, stage, `could not read profile manifest: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function bundleEntries(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles
  return Array.isArray(bundles) ? bundles.filter((entry) => entry === PACKAGE_NAME) : []
}

function assertInstalledManifest(manifest, profile) {
  assert(typeof manifest?.dependencies?.[PACKAGE_NAME] === 'string', profile, 'bundle', `profile manifest has no ${PACKAGE_NAME} dependency`)
  assert(bundleEntries(manifest).length === 1, profile, 'bundle', `profile manifest must contain exactly one ${PACKAGE_NAME} Bundle entry`)
}

function assertRemovedManifest(manifest, profile) {
  assert(manifest?.dependencies?.[PACKAGE_NAME] === undefined, profile, 'remove', `profile manifest still contains ${PACKAGE_NAME} dependency`)
  assert(bundleEntries(manifest).length === 0, profile, 'remove', `profile manifest still contains ${PACKAGE_NAME} Bundle entry`)
}

function entryFromDump(dump, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)- id: ${escapedId}\\b[\\s\\S]*?(?=\\n- id:|\\n- insert:|$)`).exec(dump)
  return match?.[0] ?? ''
}

export function assertSmokeComposition(dump, profile) {
  const output = { stdout: dump }
  const handoff = entryFromDump(dump, 'handoff-compaction')
  const sqlite = entryFromDump(dump, 'session-query-sqlite')
  const basic = entryFromDump(dump, 'compaction-basic')
  const pruner = entryFromDump(dump, 'tool-result-pruner')
  assert((dump.match(/- id: handoff-compaction\b/g) ?? []).length === 1, profile, 'composition', 'expected exactly one enabled handoff entry', output)
  assert(/name: dsh-handoff-compaction\b/.test(handoff), profile, 'composition', 'handoff entry names the packed plugin', output)
  assert(!/^\s*disabled:\s*true\b/m.test(handoff), profile, 'composition', 'handoff compaction is disabled', output)
  for (const expected of ['thresholdRatio: 0.8', 'retainTokens: 16000', 'maxTokens: 8192', 'compactionRetries: 1', 'maxOverflowRetries: 1', 'auto: true']) {
    assert(handoff.includes(expected), profile, 'composition', `handoff entry is missing ${expected}`, output)
  }
  assert(/disabled: true\b/.test(basic), profile, 'composition', 'native compaction-basic is not disabled', output)
  assert(/disabled: true\b/.test(pruner), profile, 'composition', 'native tool-result-pruner is not disabled', output)
  assert(/name: '@deepseek-ai\/dsh-session-query-sqlite'/.test(sqlite), profile, 'composition', 'official SQLite history package is not activated', output)
  assert(/session-query\.sqlite/.test(sqlite), profile, 'composition', 'SQLite history path is not session-query.sqlite', output)
  assert(/openAt: first-search\b/.test(sqlite), profile, 'composition', 'SQLite history does not use first-search', output)
}

function assertRemovedComposition(dump, profile) {
  assert(!dump.includes('id: handoff-compaction'), profile, 'post-remove-composition', 'removed plugin remains in composed profile', { stdout: dump })
}

function dshArgs(args) {
  return ['exec', 'dsh', ...args]
}

async function dumpConfig(cwd, home, profile, stage, timeoutMs, onStage) {
  const result = await runCommand('pnpm', dshArgs(['--profile', profile, '--dump-config']), {
    cwd,
    env: childEnvironment(home),
    profile,
    stage,
    timeoutMs,
    onStage,
  })
  return result.stdout
}

function stopWeb(child) {
  terminateHarnessChild(child, 'SIGTERM')
  const force = setTimeout(() => terminateHarnessChild(child, 'SIGKILL'), 5_000)
  force.unref()
}

function bootWeb(cwd, home, stage, timeoutMs, onStage) {
  return new Promise((resolveBoot, rejectBoot) => {
    onStage?.(`web:${stage}`)
    const child = spawn('pnpm', dshArgs(['web', '--no-open', '--port', '0']), {
      cwd,
      env: childEnvironment(home),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let ready = false
    let timedOut = false
    const webTimeoutMs = Math.min(timeoutMs, WEB_READY_TIMEOUT_MS)
    const append = (current, chunk) => `${current}${chunk}`.slice(-OUTPUT_LIMIT)
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error === undefined ? resolveBoot() : rejectBoot(error)
    }
    const checkReady = () => {
      if (!ready && /dsh web: http:\/\/127\.0\.0\.1:\d+\b/.test(stdout)) {
        ready = true
        stopWeb(child)
      }
    }
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk.toString())
      checkReady()
    })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk.toString()) })
    const timer = setTimeout(() => {
      timedOut = true
      stopWeb(child)
      setTimeout(() => {
        if (!settled) finish(new SmokeStageError('web', stage, `timed out waiting for a bound Web URL after ${String(webTimeoutMs)}ms and did not close within ${String(TERMINATION_GRACE_MS)}ms`, { stdout, stderr }))
      }, TERMINATION_GRACE_MS + 50).unref()
    }, webTimeoutMs)
    child.once('error', (error) => finish(new SmokeStageError('web', stage, error.message, { stdout, stderr })))
    child.once('close', (code, signal) => {
      if (ready) {
        finish()
        return
      }
      const message = timedOut
        ? 'timed out waiting for a bound Web URL'
        : `web launcher exited with ${signal ?? `code ${String(code)}`}`
      finish(new SmokeStageError('web', stage, message, { stdout, stderr }))
    })
  })
}

async function bootProfile(cwd, home, profile, stage, timeoutMs, onStage) {
  if (profile === 'web') return bootWeb(cwd, home, stage, timeoutMs, onStage)
  await runCommand('pnpm', dshArgs(['--profile', profile, '--help']), {
    cwd,
    env: childEnvironment(home),
    profile,
    stage,
    timeoutMs,
    onStage,
  })
}

async function runProfileJourney(cwd, home, tarball, profile, timeoutMs, onStage) {
  await runCommand('pnpm', dshArgs(['plugin', '--profile', profile, 'add', tarball]), {
    cwd,
    env: childEnvironment(home),
    profile,
    stage: 'add',
    timeoutMs,
    onStage,
  })
  const manifest = await readManifest(home, profile, 'bundle')
  assertInstalledManifest(manifest, profile)
  const composition = await dumpConfig(cwd, home, profile, 'composition', timeoutMs, onStage)
  assertSmokeComposition(composition, profile)
  await bootProfile(cwd, home, profile, 'boot', timeoutMs, onStage)
  await runCommand('pnpm', dshArgs(['plugin', '--profile', profile, 'remove', PACKAGE_NAME]), {
    cwd,
    env: childEnvironment(home),
    profile,
    stage: 'remove',
    timeoutMs,
    onStage,
  })
  const removedManifest = await readManifest(home, profile, 'remove')
  assertRemovedManifest(removedManifest, profile)
  const removedComposition = await dumpConfig(cwd, home, profile, 'post-remove-composition', timeoutMs, onStage)
  assertRemovedComposition(removedComposition, profile)
  await bootProfile(cwd, home, profile, 'post-remove-boot', timeoutMs, onStage)
  return { profile, home, install: true, bundle: true, composition: true, boot: true, removal: true, postRemoveBoot: true }
}

/**
 * Exercise the exact packed archive through clean Web and headless DSH homes.
 * @param {{ cwd?: string, tarball?: string, timeoutMs?: number, onStage?: (stage: string) => void }} [options]
 * @returns {Promise<SmokeReport>}
 */
export async function runDshInstallSmoke(options = {}) {
  const cwd = resolve(options.cwd ?? dirname(fileURLToPath(new URL('../package.json', import.meta.url))))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const onStage = options.onStage
  const tempRoot = await mkdtemp(join(await realpath(tmpdir()), 'dsh-install-smoke-'))
  const profiles = []
  const homes = []
  try {
    let tarball
    if (options.tarball !== undefined) {
      tarball = await realpath(options.tarball)
      assert(tarball.endsWith('.tgz'), 'pack', 'supplied-archive', 'supplied archive must be a .tgz file')
      onStage?.('pack:supplied-archive')
    } else {
      await runCommand('pnpm', ['build'], {
        cwd,
        env: { ...process.env, CI: 'true' },
        profile: 'pack',
        stage: 'build',
        timeoutMs,
        onStage,
      })
      const packDirectory = join(tempRoot, 'pack')
      await mkdir(packDirectory)
      await runCommand('pnpm', ['pack', '--pack-destination', packDirectory], {
        cwd,
        env: { ...process.env, CI: 'true' },
        profile: 'pack',
        stage: 'pack',
        timeoutMs,
        onStage,
      })
      const tarballs = (await readdir(packDirectory)).filter((file) => file.endsWith('.tgz'))
      assert(tarballs.length === 1, 'pack', 'pack', `expected exactly one tarball, found ${tarballs.length}`)
      tarball = join(packDirectory, tarballs[0])
    }
    for (const profile of PROFILES) {
      const home = await mkdtemp(join(tempRoot, `home-${profile}-`))
      const resolvedHome = await realpath(home)
      assert(resolvedHome.startsWith(`${tempRoot}${sep}`), profile, 'isolation', 'DSH_HOME escaped the OS temporary directory')
      homes.push(resolvedHome)
      profiles.push(await runProfileJourney(cwd, resolvedHome, tarball, profile, timeoutMs, onStage))
    }
    return { tempRoot, tarball, homes, profiles }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDshInstallSmoke().then(
    (report) => process.stdout.write(`${JSON.stringify(report)}\n`),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
