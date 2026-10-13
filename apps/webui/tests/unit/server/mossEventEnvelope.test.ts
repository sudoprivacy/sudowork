import { describe, expect, test } from 'vitest'
import { decodeMossEventPayloads } from '@sudowork/moss-client'

describe('Moss runner event envelopes', () => {
  test('decodes each structured record while leaving plain stdout untouched', () => {
    const model = { type: 'system', subtype: 'model_changed', model: 'gpt-4o-mini' }
    const result = { type: 'result', status: 'error', errors: ['quota exceeded'] }
    expect(
      decodeMossEventPayloads({
        type: 'stdout',
        line: `${JSON.stringify(model)}\nplain text\n${JSON.stringify(result)}\n`,
      }),
    ).toEqual([model, result])
    expect(decodeMossEventPayloads(model)).toEqual([model])
  })

  test.each([
    null,
    [],
    { type: 'stdout' },
    { type: 'stdout', line: null },
    { type: 'stdout', line: 'null\n[]\n"text"\n{broken' },
  ])('ignores malformed envelopes: %j', (frame) => {
    expect(decodeMossEventPayloads(frame)).toEqual([])
  })
})
