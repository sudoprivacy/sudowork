import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
export function validateConsumerLock(lock) {
  const artifact = lock.artifact
  if (lock.schema_version !== 1 || artifact?.repository !== 'https://github.com/sudoprivacy/sudostack' || !/^[a-f0-9]{40}$/.test(artifact.revision) || artifact.path !== 'contracts/experimental/external-provider/contract.gen.ts' || artifact.source_lock_path !== 'contracts/experimental/external-provider/source.lock.json') throw new Error('Invalid pinned sudostack artifact identity')
}
export function verifyExternalSnapshot(lock, contract, artifact, sourceLock) {
  validateConsumerLock(lock)
  if (contract !== artifact || digest(artifact) !== lock.artifact.digest) throw new Error('Consumer differs from the exact sudostack artifact')
  const source = JSON.parse(sourceLock)
  if (JSON.stringify(source) !== JSON.stringify(lock.source)) throw new Error('Consumer source lock differs from the pinned sudostack source lock')
  const header = `// Derived from Moss ${source.revision}:${source.path}. DO NOT EDIT.\n`
  if (source.repository !== 'https://github.com/sudoprivacy/moss' || !/^[a-f0-9]{40}$/.test(source.revision) || !artifact.startsWith(header) || digest(artifact.slice(header.length)) !== source.digest) throw new Error('Invalid semantic source provenance')
}
async function readArtifact(lock, path, checkout) {
  const artifact = lock.artifact
  if (checkout) {
    const origin = execFileSync('git', ['-C', checkout, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim().replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '')
    if (origin !== artifact.repository) throw new Error('Unexpected sudostack checkout origin')
    execFileSync('git', ['-C', checkout, 'cat-file', '-e', `${artifact.revision}^{commit}`])
    return execFileSync('git', ['-C', checkout, 'show', `${artifact.revision}:${path}`], { encoding: 'utf8' })
  }
  const token = process.env.GITHUB_TOKEN
  const response = await fetch(`https://raw.githubusercontent.com/sudoprivacy/sudostack/${artifact.revision}/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Pinned sudostack source unavailable (${response.status})`)
  return response.text()
}
export async function checkExternalContract(checkout) {
  const lock = JSON.parse(readFileSync(resolve(root, 'packages/contracts/external-provider.source.lock.json'), 'utf8'))
  validateConsumerLock(lock)
  const contract = readFileSync(resolve(root, 'packages/contracts/src/external-provider.gen.ts'), 'utf8')
  const [artifact, sourceLock] = await Promise.all([readArtifact(lock, lock.artifact.path, checkout), readArtifact(lock, lock.artifact.source_lock_path, checkout)])
  verifyExternalSnapshot(lock, contract, artifact, sourceLock)
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--stack')
  await checkExternalContract(index >= 0 ? process.argv[index + 1] : undefined)
  console.log('Consumer bytes and source lock match the exact published sudostack artifact')
}
