import { HANDOFF_HEADINGS } from './handoff-prompt.js'

export type HandoffValidationCode =
  | 'HANDOFF_SOURCE_EMPTY'
  | 'HANDOFF_TOOL_CALL_OUTPUT'
  | 'HANDOFF_STRUCTURE_INVALID'
  | 'HANDOFF_ALL_SECTIONS_EMPTY'
  | 'HANDOFF_WORKING_STATE_EMPTY'

export interface HandoffSourceFacts {
  readonly sourceMessageCount: number
  readonly hasHumanUserMessage: boolean
}

export class HandoffValidationError extends Error {
  readonly code: HandoffValidationCode

  constructor(code: HandoffValidationCode, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'HandoffValidationError'
    this.code = code
  }
}

function invalidStructure(message: string): never {
  throw new HandoffValidationError('HANDOFF_STRUCTURE_INVALID', message)
}

function normalizedBodyLines(body: string): string[] {
  return body
    .split(/\r?\n/u)
    .map((line) => line
      .trim()
      .replace(/^(?:[-*+>]\s*)+/u, '')
      .replace(/[`*_]/gu, '')
      .replace(/[.。]$/u, '')
      .trim()
      .toLowerCase())
    .filter((line) => line.length > 0)
}

function isNoneBody(body: string): boolean {
  const lines = normalizedBodyLines(body)
  return lines.length > 0 && lines.every((line) => line === 'none' || line === '(none)')
}

/** Validate one generated handoff before DSH is allowed to commit its replacement event. */
export function validateHandoffText(
  markdown: string,
  facts: HandoffSourceFacts,
): void {
  if (facts.sourceMessageCount === 0) {
    throw new HandoffValidationError(
      'HANDOFF_SOURCE_EMPTY',
      'handoff rejected: the replay source contains zero messages',
    )
  }

  const lines = markdown.trim().split(/\r?\n/u)
  const headingPositions: number[] = []

  for (const heading of HANDOFF_HEADINGS) {
    const matches = lines
      .map((line, index) => line.trim() === heading ? index : -1)
      .filter((index) => index >= 0)
    if (matches.length !== 1) {
      invalidStructure(`handoff rejected: heading "${heading}" occurs ${matches.length} times`)
    }
    headingPositions.push(matches[0]!)
  }

  if (headingPositions[0] !== 0) {
    invalidStructure('handoff rejected: content appears before the root heading')
  }
  for (let index = 1; index < headingPositions.length; index += 1) {
    if (headingPositions[index]! <= headingPositions[index - 1]!) {
      invalidStructure('handoff rejected: required headings are out of order')
    }
  }

  const expectedHeadings = new Set<string>(HANDOFF_HEADINGS)
  const unexpectedPeer = lines.find((line) => {
    const trimmed = line.trim()
    return /^#{1,2}\s+/u.test(trimmed) && !expectedHeadings.has(trimmed)
  })
  if (unexpectedPeer !== undefined) {
    invalidStructure(`handoff rejected: unexpected peer heading "${unexpectedPeer.trim()}"`)
  }

  const rootBody = lines.slice(1, headingPositions[1]).join('\n').trim()
  if (rootBody.length > 0) {
    invalidStructure('handoff rejected: commentary appears outside the numbered sections')
  }

  const bodies = HANDOFF_HEADINGS.slice(1).map((_heading, sectionIndex) => {
    const headingIndex = headingPositions[sectionIndex + 1]!
    const nextHeadingIndex = headingPositions[sectionIndex + 2] ?? lines.length
    const body = lines.slice(headingIndex + 1, nextHeadingIndex).join('\n').trim()
    if (body.length === 0) {
      invalidStructure(`handoff rejected: section ${sectionIndex + 1} has an empty body`)
    }
    return body
  })

  if (bodies.every(isNoneBody)) {
    throw new HandoffValidationError(
      'HANDOFF_ALL_SECTIONS_EMPTY',
      `handoff rejected: source contains ${facts.sourceMessageCount} messages but every section is (none)`,
    )
  }

  const workingStateBodies = [bodies[0]!, bodies[1]!, bodies[7]!, bodies[8]!]
  if (facts.hasHumanUserMessage && workingStateBodies.every(isNoneBody)) {
    throw new HandoffValidationError(
      'HANDOFF_WORKING_STATE_EMPTY',
      'handoff rejected: a human request exists but objective, state, pending work, and next step are all (none)',
    )
  }
}
