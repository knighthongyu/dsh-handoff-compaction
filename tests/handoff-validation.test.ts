import { describe, expect, it } from 'vitest'

import { HANDOFF_HEADINGS } from '../src/handoff-prompt.js'

const substantiveHandoff = `# Context Handoff

## 1. Current Objective
- Ship the compaction fix.

## 2. Current State
- Tests are being written.

## 3. Key Decisions
(none)

## 4. Constraints
- Preserve one LLM call per transaction.

## 5. Exact Facts
- The source contains messages.

## 6. Files / Code
(none)

## 7. Failed Attempts / Problems
(none)

## 8. Pending Work
- Implement validation.

## 9. Next Step
- Run focused tests.

## 10. Historical References
(none)`

const allNoneHandoff = HANDOFF_HEADINGS.map((heading, index) => (
  index === 0 ? heading : `${heading}\n- (none)`
)).join('\n\n')

describe('handoff validation', () => {
  it('exports the validator contract', async () => {
    const validation = await import('../src/handoff-validation.js').catch(() => ({}))

    expect(validation).toHaveProperty('validateHandoffText')
    expect(validation).toHaveProperty('HandoffValidationError')
  })

  it('accepts a complete handoff with intentionally sparse sections', async () => {
    const { validateHandoffText } = await import('../src/handoff-validation.js')

    expect(() => validateHandoffText(substantiveHandoff, {
      sourceMessageCount: 12,
      hasHumanUserMessage: true,
    })).not.toThrow()
  })

  it('rejects the incident-shaped all-none handoff', async () => {
    const { validateHandoffText } = await import('../src/handoff-validation.js')

    expect(() => validateHandoffText(allNoneHandoff, {
      sourceMessageCount: 87,
      hasHumanUserMessage: true,
    })).toThrowError(expect.objectContaining({ code: 'HANDOFF_ALL_SECTIONS_EMPTY' }))
  })

  it.each([
    ['missing heading', substantiveHandoff.replace('## 6. Files / Code\n(none)\n\n', '')],
    ['duplicate heading', `${substantiveHandoff}\n\n## 10. Historical References\n(none)`],
    [
      'reordered headings',
      substantiveHandoff
        .replace('## 1. Current Objective', '__FIRST__')
        .replace('## 2. Current State', '## 1. Current Objective')
        .replace('__FIRST__', '## 2. Current State'),
    ],
    ['empty body', substantiveHandoff.replace('## 6. Files / Code\n(none)', '## 6. Files / Code\n   ')],
    ['unexpected peer heading', substantiveHandoff.replace(
      '## 6. Files / Code\n(none)',
      '## Unexpected Peer\ntext\n\n## 6. Files / Code\n(none)',
    )],
  ])('rejects %s', async (_name, markdown) => {
    const { validateHandoffText } = await import('../src/handoff-validation.js')

    expect(() => validateHandoffText(markdown, {
      sourceMessageCount: 12,
      hasHumanUserMessage: true,
    })).toThrowError(expect.objectContaining({ code: 'HANDOFF_STRUCTURE_INVALID' }))
  })

  it('requires useful working state when a human request exists', async () => {
    const { validateHandoffText } = await import('../src/handoff-validation.js')
    const exactFactsOnly = allNoneHandoff.replace(
      '## 5. Exact Facts\n- (none)',
      '## 5. Exact Facts\n- A fact without resumable state.',
    )

    expect(() => validateHandoffText(exactFactsOnly, {
      sourceMessageCount: 4,
      hasHumanUserMessage: true,
    })).toThrowError(expect.objectContaining({ code: 'HANDOFF_WORKING_STATE_EMPTY' }))
  })
})
