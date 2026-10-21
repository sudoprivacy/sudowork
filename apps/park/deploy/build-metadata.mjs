import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
function fingerprint(path) {
  const hash = createHash('sha256')
  function add(name) {
    if (statSync(name).isDirectory()) for (const child of readdirSync(name).sort()) add(join(name, child))
    else hash.update(name + '\0').update(readFileSync(name))
  }
  add(path)
  return hash.digest('hex')
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
writeFileSync('box-build.json', JSON.stringify({ components: {
  park: { version, artifact_sha256: fingerprint('server.bundle.mjs') },
  bff: { version, source_sha256: fingerprint('park-backend.mjs') },
  public_frontend: { version, artifact_sha256: fingerprint('dist') },
} }, null, 2))
