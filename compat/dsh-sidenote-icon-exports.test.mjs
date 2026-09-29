import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const [clientPath, primitivesPath] = process.argv.slice(2)
assert.ok(clientPath && primitivesPath, 'usage: node test.mjs CLIENT PRIMITIVES')

const client = readFileSync(clientPath, 'utf8')
const primitives = readFileSync(primitivesPath, 'utf8')
const exportList = primitives.match(/^export \{([^}]+)\};?$/m)?.[1]
assert.ok(exportList, 'primitives export list must be present')

const exports = new Set(exportList.split(',').map((item) => item.trim().split(' as ').at(-1)))
const imports = new Set([...client.matchAll(/_deepseek_ai_dsh_client_ui_primitives\.(Icon[A-Za-z0-9]+)/g)].map((match) => match[1]))
const missing = [...imports].filter((name) => !exports.has(name))
assert.deepEqual(missing, [], `sidenote uses missing DSH icon exports: ${missing.join(', ')}`)
