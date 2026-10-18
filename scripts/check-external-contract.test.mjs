import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { verifyExternalSnapshot, validateConsumerLock } from './check-external-contract.mjs'
const lock = JSON.parse(readFileSync(new URL('../packages/contracts/external-provider.source.lock.json', import.meta.url), 'utf8'))
const contract = readFileSync(new URL('../packages/contracts/src/external-provider.gen.ts', import.meta.url), 'utf8')
test('consumer validates the artifact and its semantic lock together', () => {
  verifyExternalSnapshot(lock, contract, contract, JSON.stringify(lock.source))
  assert.throws(() => validateConsumerLock({ ...lock, artifact: { ...lock.artifact, revision: 'main' } }))
  assert.throws(() => verifyExternalSnapshot(lock, contract, contract, JSON.stringify({ ...lock.source, revision: 'f'.repeat(40) })), /source lock differs/)
})
test('self-consistent local repins still fail against the fixed sudostack artifact', () => {
  const changed = contract + '// local edit\n'
  const forged = { ...lock, artifact: { ...lock.artifact, digest: 'sha256:' + createHash('sha256').update(changed).digest('hex') } }
  assert.throws(() => verifyExternalSnapshot(forged, changed, contract, JSON.stringify(lock.source)), /exact sudostack artifact/)
})
