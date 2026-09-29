import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const [clientPath, primitivesPath] = process.argv.slice(2)
assert.ok(clientPath && primitivesPath, 'usage: node patch-sidenote-icons.mjs CLIENT PRIMITIVES')

const source = readFileSync(clientPath, 'utf8')
assert.match(source, /id: "dsh-sidenote"/, 'target must be the dsh-sidenote client bundle')
const primitives = readFileSync(primitivesPath, 'utf8')
const exportList = primitives.match(/^export \{([^}]+)\};?$/m)?.[1]
assert.ok(exportList, 'primitives export list must be present')
const exports = new Set(exportList.split(',').map((item) => item.trim().split(' as ').at(-1)))

const used = new Set([...source.matchAll(/_deepseek_ai_dsh_client_ui_primitives\.(Icon[A-Za-z0-9]+)/g)].map((match) => match[1]))
const missing = [...used].filter((name) => !exports.has(name))
const replacements = new Map(missing.map((name) => [name, name.replace(/(?:12|14|16)$/, 'Regular')]))
for (const [oldName, newName] of replacements) {
  assert.notEqual(oldName, newName, `no replacement rule for ${oldName}`)
  assert.ok(exports.has(newName), `replacement ${newName} is not exported`)
}

if (replacements.size === 0) {
  console.log('dsh-sidenote icons are already compatible')
  process.exit(0)
}

const patched = source.replace(
  /(_deepseek_ai_dsh_client_ui_primitives\.)(Icon[A-Za-z0-9]+)/g,
  (full, prefix, name) => prefix + (replacements.get(name) ?? name),
)
assert.notEqual(patched, source)
writeFileSync(clientPath, patched)
console.log(`updated ${replacements.size} obsolete icon imports in ${clientPath}`)
