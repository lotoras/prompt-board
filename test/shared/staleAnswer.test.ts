import { describe, expect, it } from 'vitest'
import { staleAnswerText, stalePlanText } from '../../src/shared/chat'

describe('staleAnswerText', () => {
  it('puts a single answer on one line after its question', () => {
    expect(staleAnswerText({ 'Run a threebrain pass?': 'Simplify' })).toBe(
      'Run a threebrain pass? → Simplify'
    )
  })

  it('puts each answer on its own line', () => {
    expect(staleAnswerText({ 'Which DB?': 'Postgres', 'Add tests?': 'Yes, Unit' })).toBe(
      'Which DB? → Postgres\nAdd tests? → Yes, Unit'
    )
  })
})

describe('stalePlanText', () => {
  it('approves the plan', () => {
    expect(stalePlanText({ approve: true })).toBe('I approve the plan. Go ahead.')
  })

  it('passes the feedback on a rejection', () => {
    expect(stalePlanText({ approve: false, feedback: 'smaller steps' })).toBe(
      "I don't approve the plan yet: smaller steps"
    )
  })
})
