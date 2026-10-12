import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(resolve(root, 'packages/contracts/external-provider.source.lock.json'), 'utf8'))
const contract = readFileSync(resolve(root, 'packages/contracts/src/external-provider.gen.ts'), 'utf8')
const header = `// Derived from Moss ${lock.revision}:${lock.path}. DO NOT EDIT.\n`
if (!/^[a-f0-9]{40}$/.test(lock.revision) || !contract.startsWith(header)) throw new Error('Invalid pinned contract provenance')
if (`sha256:${createHash('sha256').update(contract.slice(header.length)).digest('hex')}` !== lock.digest) throw new Error('External provider contract drift: regenerate from the pinned Moss source through sudostack')
console.log('Pinned external-provider contract matches its semantic owner digest')
