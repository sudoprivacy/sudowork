import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

export default async function setup() {
  await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../scripts/build-ontology-cli.js')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
}
