import { describe, expect, it } from 'vitest'

import { HANDOFF_HEADINGS, HANDOFF_INSTRUCTION, handoffInstruction } from '../src/handoff-prompt.js'

describe('handoff prompt contract', () => {
  it('contains every required heading exactly once and in order', () => {
    let previous = -1
    for (const heading of HANDOFF_HEADINGS) {
      expect(HANDOFF_INSTRUCTION.split(heading)).toHaveLength(2)
      const position = HANDOFF_INSTRUCTION.indexOf(heading)
      expect(position).toBeGreaterThan(previous)
      previous = position
    }
    expect(HANDOFF_INSTRUCTION.startsWith('You are writing an engineering handoff')).toBe(true)
    expect(handoffInstruction()).toBe(HANDOFF_INSTRUCTION)
  })

  it('identifies the selected leading messages as the complete source', () => {
    const instruction = handoffInstruction(87, false)

    expect(instruction).toContain('messages ABOVE are the complete current DSH context')
    expect(instruction).toContain('No separate replay document or attachment will be provided')
    expect(instruction).toContain('first 87 leading messages')
    expect(instruction).toContain('must never produce an all-(none) handoff')
  })

  it('limits the handoff source to the selected prefix while carrying the retained tail', () => {
    const instruction = handoffInstruction(87, {
      retainedMessageCount: 12,
      recovery: false,
    })

    expect(instruction).toContain('87 leading messages')
    expect(instruction).toContain('12 trailing messages')
    expect(instruction).toContain('retained verbatim')
    expect(instruction).toContain('do not summarize')
  })

  it('adds a stronger warning only for a recovery attempt', () => {
    expect(handoffInstruction(3, false)).not.toContain('previous handoff attempt')
    const recovery = handoffInstruction(3, true)
    expect(recovery).toContain(
      'A previous handoff attempt incorrectly returned an invalid or all-(none) result',
    )
    expect(recovery).toContain('Do not call any tool')
    expect(recovery).toContain('Your first output characters must be exactly "# Context Handoff"')
  })

  it('pins budget, fidelity, consolidation, and history-reference rules', () => {
    expect(HANDOFF_INSTRUCTION).toContain('4,000–6,000 tokens')
    expect(HANDOFF_INSTRUCTION).toContain('8,192')
    expect(HANDOFF_INSTRUCTION).toContain('Do not pad')
    expect(HANDOFF_INSTRUCTION).toContain('previous <compacted-summary>')
    expect(HANDOFF_INSTRUCTION).toContain('never invent session ids or event seq values')
    expect(HANDOFF_INSTRUCTION).toContain('literal search phrases')
    expect(HANDOFF_INSTRUCTION).toContain('Write "(none)"')
    expect(HANDOFF_INSTRUCTION).toContain('selected leading source messages above support it')
    expect(HANDOFF_INSTRUCTION).toContain('visible in the selected leading source messages above')
  })

  it('does not retain the stock summary taxonomy', () => {
    expect(HANDOFF_INSTRUCTION).not.toContain('## Primary Request and Intent')
    expect(HANDOFF_INSTRUCTION).not.toContain('## Key Technical Concepts')
  })
})
