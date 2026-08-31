import { withReleasePackageArchive } from './release-package-audit.mjs'
import { runDshInstallSmoke } from './smoke-dsh-install.mjs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Audit and smoke the same live archive, then let the audit boundary clean it. */
export async function runVerifiedRelease(options = {}) {
  const runSmoke = options.runSmoke ?? runDshInstallSmoke
  return withReleasePackageArchive(async (archive) => ({
    archive,
    smoke: await runSmoke({ tarball: archive.archivePath }),
  }))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runVerifiedRelease().then(
    ({ archive }) => process.stdout.write(`${JSON.stringify({ filename: archive.filename, sha256: archive.sha256, files: archive.files })}\n`),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
