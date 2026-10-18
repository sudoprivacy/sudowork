import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { validateTaskLock, verifyTaskSnapshot } from './check-task-contract.mjs'
const root = new URL('../', import.meta.url)
const lock = JSON.parse(readFileSync(new URL('packages/contracts/task.source.lock.json', root), 'utf8'))
const files = Object.fromEntries(Object.entries(lock.artifact.files).map(([path, entry]) => { const bytes = readFileSync(new URL(entry.local, root), 'utf8'); return [path, { local: bytes, artifact: bytes }] }))
test('Task locks reject floating versions, owners and output path substitution', () => {
  validateTaskLock(lock)
  for (const changed of [{ ...lock, artifact: { ...lock.artifact, revision: 'main' } }, { ...lock, source: { ...lock.source, semanticOwner: 'work' } }, { ...lock, artifact: { ...lock.artifact, files: {} } }]) assert.throws(() => validateTaskLock(changed))
})
test('Task snapshots reject byte drift and a rewritten source lock', () => {
  verifyTaskSnapshot(lock, JSON.stringify(lock.source), files)
  const path = 'contracts/task/v1alpha1/contract.ts'
  assert.throws(() => verifyTaskSnapshot(lock, JSON.stringify(lock.source), { ...files, [path]: { ...files[path], local: files[path].local + '\n' } }), /drift/)
  assert.throws(() => verifyTaskSnapshot(lock, '{}', files), /drift/)
})
