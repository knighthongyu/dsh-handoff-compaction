import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const projectRequire = createRequire(import.meta.url)
const dshPackagePath = projectRequire.resolve('@deepseek-ai/dsh/package.json')
export const dshRequire = createRequire(dshPackagePath)

export async function importFromDsh(specifier: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(dshRequire.resolve(specifier)).href) as Promise<Record<string, unknown>>
}

export function requireFromDshBase(specifier: string): string {
  const baseRequire = createRequire(dshRequire.resolve('@deepseek-ai/dsh-base/package.json'))
  return baseRequire.resolve(specifier)
}

export function requireFromDshWeb(specifier: string): string {
  const webRequire = createRequire(dshRequire.resolve('@deepseek-ai/dsh-web-app/package.json'))
  return webRequire.resolve(specifier)
}

export function outputText(result: any): string {
  return (result.content ?? [])
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n')
}
