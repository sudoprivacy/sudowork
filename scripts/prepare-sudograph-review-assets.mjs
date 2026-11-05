/** Include the existing pinned ShareOne frontend in the portable host artifact. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShareoneReviewAssets } from '../packages/sudograph-runtime/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { prepareShareoneReview } = require('../apps/desktop/scripts/prepare-shareone-review.js');
prepareShareoneReview();
const source = path.join(root, 'apps/desktop/resources/shareone-review');
const pin = JSON.parse(readFileSync(path.join(root, 'apps/desktop/resources/shareone-review.lock.json'), 'utf8'));
assert.deepEqual(JSON.parse(readFileSync(path.join(source, 'installed-source.json'), 'utf8')), pin, 'The review shell differs from the shared source pin.');
const assets = new ShareoneReviewAssets();
await assets.load(source);
const manifestBody = readFileSync(path.join(source, 'review-assets.json'));
const manifest = JSON.parse(manifestBody);
const destination = path.join(root, 'packages/sudograph-runtime/review-assets');
// Only this generated directory is replaceable. Refuse a relocated or linked
// output instead of following it into another worktree or operator directory.
assert.equal(destination, path.resolve(root, 'packages/sudograph-runtime/review-assets'));
if (existsSync(destination)) {
  assert(!lstatSync(destination).isSymbolicLink() && realpathSync(destination) === destination, 'Review build output must stay in this worktree.');
  rmSync(destination, { recursive: true });
}
mkdirSync(destination, { recursive: true });
for (const [name, receipt] of Object.entries(manifest.files)) {
  const file = assets.get(name);
  assert(file && file.body.byteLength === receipt.bytes);
  assert.equal(createHash('sha256').update(file.body).digest('hex'), receipt.sha256);
  const target = path.join(destination, name);
  assert(!path.relative(destination, target).startsWith('..'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, file.body);
}
writeFileSync(path.join(destination, 'review-assets.json'), manifestBody);
copyFileSync(path.join(source, 'installed-source.json'), path.join(destination, 'installed-source.json'));
await new ShareoneReviewAssets().load(destination);
console.log(JSON.stringify({ format: 'sudograph-review-shell-build/v1', source: pin, files: Object.keys(manifest.files).length, manifest_sha256: createHash('sha256').update(manifestBody).digest('hex') }));
