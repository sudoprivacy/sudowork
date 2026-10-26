/** Build and install the pinned, reusable ShareOne shell before app packaging. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Node distributions keep npm beside node.exe on Windows and under lib on Unix. */
function resolveNpmCli(nodeExecutable = process.execPath, npmExecPath = process.env.npm_execpath) {
  const directory = path.dirname(nodeExecutable);
  const candidates = [npmExecPath && path.basename(npmExecPath) === 'npm-cli.js' ? npmExecPath : undefined, path.join(directory, 'node_modules/npm/bin/npm-cli.js'), path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js')];
  const npm = candidates.find((candidate) => candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!npm) throw new Error('Build the review shell with an installed Node.js/npm runtime.');
  return npm;
}

/** Send private repository credentials only through Git's process environment. */
function reviewGitEnvironment(environment = process.env) {
  const env = { ...environment, GIT_TERMINAL_PROMPT: '0' };
  const token = environment.SHAREONE_REVIEW_GITHUB_TOKEN || environment.GH_TOKEN;
  if (!token) {
    if (environment.CI) throw new Error('The pinned ShareOne source is private. Configure SHAREONE_REVIEW_GITHUB_TOKEN with read access to sudoprivacy/shareone for this build.');
    return env;
  }
  const count = Number(environment.GIT_CONFIG_COUNT || 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid inherited Git configuration count.');
  env.GIT_CONFIG_COUNT = String(count + 1);
  env[`GIT_CONFIG_KEY_${count}`] = 'http.https://github.com/sudoprivacy/shareone.git.extraheader';
  env[`GIT_CONFIG_VALUE_${count}`] = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  return env;
}

/** Build frontend tools for the host Node runtime, independently of packaging targets. */
function reviewFrontendEnvironment(environment = process.env) {
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (/^npm_config_(arch|target_arch|runtime|target|disturl|platform)$/i.test(key) || key === 'SHAREONE_REVIEW_GITHUB_TOKEN' || key === 'GH_TOKEN') delete env[key];
  }
  return env;
}

function prepareShareoneReview() {
  const root = path.resolve(__dirname, '..');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'resources/shareone-review.lock.json'), 'utf8'));
  if (lock.repository !== 'https://github.com/sudoprivacy/shareone.git' || !/^[a-f0-9]{40}$/.test(lock.revision) || lock.format !== 'shareone-review-shell/v1') throw new Error('Invalid ShareOne review pin.');
  const output = path.join(root, 'resources/shareone-review');
  const stamp = path.join(output, 'installed-source.json');
  if (fs.existsSync(stamp) && JSON.parse(fs.readFileSync(stamp, 'utf8')).revision === lock.revision && fs.existsSync(path.join(output, 'review-assets.json'))) {
    console.log('Pinned ShareOne review shell is installed.');
    return;
  }
  const run = (command, args, cwd, env = process.env) => execFileSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, env: { ...env, GOMAXPROCS: '1' } });
  const source = process.env.SHAREONE_REVIEW_SOURCE ? path.resolve(process.env.SHAREONE_REVIEW_SOURCE) : path.join(root, '.cache/shareone-review-src');
  if (!process.env.SHAREONE_REVIEW_SOURCE) {
    const gitEnvironment = reviewGitEnvironment();
    fs.mkdirSync(source, { recursive: true });
    if (!fs.existsSync(path.join(source, '.git'))) run('git', ['init'], source);
    run('git', ['fetch', '--depth=1', lock.repository, lock.revision], source, gitEnvironment);
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], source);
  }
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', windowsHide: true }).trim();
  if (revision !== lock.revision) throw new Error('ShareOne source differs from the locked commit.');
  run('git', ['diff', '--quiet', 'HEAD', '--', 'frontend'], source);
  const frontend = path.join(source, 'frontend');
  const npm = resolveNpmCli();
  const frontendEnvironment = reviewFrontendEnvironment();
  run(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], frontend, frontendEnvironment);
  run(process.execPath, [npm, 'run', 'build:review'], frontend, frontendEnvironment);
  const built = path.join(frontend, 'review-dist');
  const manifest = JSON.parse(fs.readFileSync(path.join(built, 'review-assets.json'), 'utf8'));
  if (manifest.format !== lock.format) throw new Error('ShareOne build returned an incompatible shell.');
  const { createHash } = require('node:crypto');
  for (const [name, receipt] of Object.entries(manifest.files)) {
    if (!/^[A-Za-z0-9_./-]+\.(js|css|woff2?)$/.test(name) || name.includes('..')) throw new Error('Invalid review asset name.');
    const body = fs.readFileSync(path.join(built, name));
    if (body.length !== receipt.bytes || createHash('sha256').update(body).digest('hex') !== receipt.sha256) throw new Error('Review build differs from its manifest.');
    const target = path.join(output, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  fs.copyFileSync(path.join(built, 'review-assets.json'), path.join(output, 'review-assets.json'));
  fs.writeFileSync(stamp, JSON.stringify(lock, null, 2) + '\n');
  console.log(`Installed ShareOne review shell ${lock.revision}.`);
}

module.exports = { resolveNpmCli, reviewGitEnvironment, reviewFrontendEnvironment, prepareShareoneReview };
if (require.main === module) prepareShareoneReview();
