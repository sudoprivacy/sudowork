import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readArtifact } from './check-external-contract.mjs'

const root = new URL('../', import.meta.url)
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const paths = {
  'contracts/task/v1alpha1/contract.ts': ['task.contract.gen.ts', 'packages/contracts/src/task.gen.ts'],
  'contracts/task/v1alpha1/schema.json': ['task.schema.gen.json', 'packages/contracts/task.schema.json'],
}
export function validateTaskLock(lock) {
  const artifact = lock.artifact, source = lock.source
  if (lock.schema_version !== 1 || artifact?.repository !== 'https://github.com/sudoprivacy/sudostack'
    || !/^[a-f0-9]{40}$/.test(artifact.revision) || artifact.source_lock_path !== 'contracts/experimental/agent-federation/source.lock.json'
    || source?.repository !== 'https://github.com/sudoprivacy/moss' || source.semanticOwner !== 'moss'
    || !/^[a-f0-9]{40}$/.test(source.revision) || source.maturity !== 'experimental-adapter-baseline'
    || JSON.stringify(Object.keys(artifact.files ?? {}).sort()) !== JSON.stringify(Object.keys(paths).sort())) throw new Error('Invalid Task contract provenance')
  for (const [path, [output, local]] of Object.entries(paths)) {
    if (artifact.files[path]?.path !== `contracts/experimental/agent-federation/${output}` || artifact.files[path]?.local !== local
      || source.files[path]?.output !== output || !/^sha256:[a-f0-9]{64}$/.test(source.files[path]?.digest ?? '')
      || !/^sha256:[a-f0-9]{64}$/.test(artifact.files[path]?.digest ?? '')) throw new Error('Invalid Task source closure')
  }
}
export function verifyTaskSnapshot(lock, sourceLock, files) {
  validateTaskLock(lock)
  if (JSON.stringify(JSON.parse(sourceLock)) !== JSON.stringify(lock.source)) throw new Error('Task owner lock drift')
  for (const [path] of Object.entries(paths)) {
    const { local, artifact } = files[path], header = `// Derived from Moss ${lock.source.revision}:${path}. DO NOT EDIT.\n`
    if (local !== artifact || digest(artifact) !== lock.artifact.files[path].digest) throw new Error('Task artifact drift')
    const source = path.endsWith('.ts') ? artifact.slice(header.length) : artifact
    if ((path.endsWith('.ts') && !artifact.startsWith(header)) || digest(source) !== lock.source.files[path].digest) throw new Error('Task semantic source drift')
  }
}
export async function checkTaskContract(checkout) {
  const lock = JSON.parse(readFileSync(new URL('packages/contracts/task.source.lock.json', root), 'utf8'))
  validateTaskLock(lock)
  const sourceLock = await readArtifact(lock, lock.artifact.source_lock_path, checkout)
  const files = Object.fromEntries(await Promise.all(Object.entries(lock.artifact.files).map(async ([path, entry]) => [path, {
    local: readFileSync(new URL(entry.local, root), 'utf8'), artifact: await readArtifact(lock, entry.path, checkout),
  }])))
  verifyTaskSnapshot(lock, sourceLock, files)
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--stack')
  await checkTaskContract(index >= 0 ? process.argv[index + 1] : undefined)
  console.log('Task type/schema match exact Stack artifacts and Moss semantic source')
}
