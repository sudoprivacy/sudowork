import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '../../deploy/install.sh')
const PREPARE_RELEASE_SCRIPT = resolve(
  import.meta.dirname,
  '../../deploy/prepare-release-assets.sh',
)
const PACKAGE_RELEASE_SCRIPT = resolve(import.meta.dirname, '../../deploy/package-release.sh')
const ENV_KEYS = [
  'PUBLIC_ORIGIN',
  'MOSS_BASE_URL',
  'MOSS_WS_BASE_URL',
  'MOSS_ALLOWED_ORIGINS',
  'WEBUI_PORT',
  'TRUST_PROXY',
  'CSP_IMG_SRC_ORIGINS',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'SESSION_HMAC_KEY',
  'TOKEN_AES_KEY',
  'WEBUI_ENV_FILE',
  'WEBUI_NON_INTERACTIVE',
  'WEBUI_RELEASE_TAG',
  'WEBUI_INSTALL_DIR',
  'WEBUI_DOWNLOAD_BASE',
  'WEBUI_INSTALLER_URL',
] as const

const temporaryDirectories: string[] = []

function installerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of ENV_KEYS) delete env[key]
  return env
}

function parseEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
}

function createEnvFilePath(): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'sudowork-webui-deploy-'))
  temporaryDirectories.push(directory)
  return resolve(directory, '.env.deploy')
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'sudowork-webui-release-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('WebUI one-click deploy script', () => {
  test('generates a protected deployment env file and infers the WebSocket URL', () => {
    const envFile = createEnvFilePath()
    const result = spawnSync(
      'bash',
      [
        SCRIPT,
        '--non-interactive',
        '--dry-run',
        '--public-origin',
        'https://webui.example.com',
        '--moss-url',
        'http://10.0.1.206:43127',
        '--moss-allowed-origins',
        'https://agent.sudoprivacy.com,https://moss-backup.example.com',
        '--port',
        '28080',
        '--env-file',
        envFile,
      ],
      { encoding: 'utf8', env: installerEnv() },
    )

    expect(result.status, result.stderr).toBe(0)
    const values = parseEnvFile(envFile)
    expect(values.PUBLIC_ORIGIN).toBe('https://webui.example.com')
    expect(values.MOSS_BASE_URL).toBe('http://10.0.1.206:43127')
    expect(values.MOSS_WS_BASE_URL).toBe('ws://10.0.1.206:43127')
    expect(values.MOSS_ALLOWED_ORIGINS).toBe(
      'https://agent.sudoprivacy.com,https://moss-backup.example.com',
    )
    expect(values.WEBUI_PORT).toBe('28080')
    expect(values.POSTGRES_PASSWORD).toMatch(/^[a-f0-9]{48}$/)
    expect(values.SESSION_HMAC_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(values.TOKEN_AES_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(statSync(envFile).mode & 0o777).toBe(0o600)
    expect(result.stdout).not.toContain(values.SESSION_HMAC_KEY)
    expect(result.stdout).not.toContain(values.TOKEN_AES_KEY)
  })

  test('preserves generated credentials when deployment is run again', () => {
    const envFile = createEnvFilePath()
    const initialArgs = [
      SCRIPT,
      '--non-interactive',
      '--dry-run',
      '--public-origin',
      'https://webui.example.com',
      '--moss-url',
      'https://moss.example.com',
      '--env-file',
      envFile,
    ]
    execFileSync('bash', initialArgs, { env: installerEnv() })
    const initial = parseEnvFile(envFile)

    const rerun = spawnSync(
      'bash',
      [SCRIPT, '--non-interactive', '--dry-run', '--env-file', envFile],
      { encoding: 'utf8', env: installerEnv() },
    )

    expect(rerun.status, rerun.stderr).toBe(0)
    const current = parseEnvFile(envFile)
    expect(current.POSTGRES_PASSWORD).toBe(initial.POSTGRES_PASSWORD)
    expect(current.SESSION_HMAC_KEY).toBe(initial.SESSION_HMAC_KEY)
    expect(current.TOKEN_AES_KEY).toBe(initial.TOKEN_AES_KEY)
  })

  test('re-infers the WebSocket URL when the configured Moss URL changes', () => {
    const envFile = createEnvFilePath()
    execFileSync(
      'bash',
      [
        SCRIPT,
        '--non-interactive',
        '--dry-run',
        '--public-origin',
        'https://webui.example.com',
        '--moss-url',
        'http://old-moss.example.com:43127',
        '--env-file',
        envFile,
      ],
      { env: installerEnv() },
    )

    const result = spawnSync(
      'bash',
      [
        SCRIPT,
        '--non-interactive',
        '--dry-run',
        '--moss-url',
        'https://new-moss.example.com',
        '--env-file',
        envFile,
      ],
      { encoding: 'utf8', env: installerEnv() },
    )

    expect(result.status, result.stderr).toBe(0)
    const current = parseEnvFile(envFile)
    expect(current.MOSS_BASE_URL).toBe('https://new-moss.example.com')
    expect(current.MOSS_WS_BASE_URL).toBe('wss://new-moss.example.com')
  })

  test('rejects an insecure production origin before invoking Docker', () => {
    const envFile = createEnvFilePath()
    const result = spawnSync(
      'bash',
      [
        SCRIPT,
        '--non-interactive',
        '--dry-run',
        '--public-origin',
        'http://webui.example.com',
        '--moss-url',
        'http://10.0.1.206:43127',
        '--env-file',
        envFile,
      ],
      { encoding: 'utf8', env: installerEnv() },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('PUBLIC_ORIGIN has an unsupported scheme')
  })

  test('rejects HTTP and WebSocket URLs with different authorities', () => {
    const envFile = createEnvFilePath()
    const result = spawnSync(
      'bash',
      [
        SCRIPT,
        '--non-interactive',
        '--dry-run',
        '--public-origin',
        'https://webui.example.com',
        '--moss-url',
        'http://moss.example.com:43127',
        '--moss-ws-url',
        'ws://other.example.com:43127',
        '--env-file',
        envFile,
      ],
      { encoding: 'utf8', env: installerEnv() },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must use the same host and port')
  })

  test('generates a released Compose definition without invoking Docker', () => {
    const installDirectory = createTemporaryDirectory()
    const env = installerEnv()
    env.WEBUI_RELEASE_TAG = 'v1.2.3'
    const result = spawnSync(
      'bash',
      [
        SCRIPT,
        '--non-interactive',
        '--dry-run',
        '--public-origin',
        'https://webui.example.com',
        '--moss-url',
        'http://10.0.1.206:43127',
        '--install-dir',
        installDirectory,
      ],
      { encoding: 'utf8', env },
    )

    expect(result.status, result.stderr).toBe(0)
    const compose = readFileSync(resolve(installDirectory, 'docker-compose.yml'), 'utf8')
    expect(compose).toContain('image: sudowork-webui:1.2.3')
    expect(compose).toContain('image: postgres:16-alpine')
    expect(compose).toContain('pull_policy: never')
    expect(compose).toContain('MOSS_ALLOWED_ORIGINS: ${MOSS_ALLOWED_ORIGINS}')
    expect(compose).not.toContain('build:')
  })

  test('stamps and checksums release assets', () => {
    const directory = createTemporaryDirectory()
    const archive = resolve(directory, 'images.tar.gz')
    const output = resolve(directory, 'release')
    writeFileSync(archive, 'mock docker image archive')

    execFileSync('bash', [PREPARE_RELEASE_SCRIPT, 'v1.2.3', 'amd64', archive, output])

    const releasedArchive = resolve(output, 'sudowork-webui-1.2.3-linux-amd64.tar.gz')
    expect(existsSync(releasedArchive)).toBe(true)
    expect(readFileSync(resolve(output, 'install.sh'), 'utf8')).toContain(
      'RELEASE_TAG="${WEBUI_RELEASE_TAG:-v1.2.3}"',
    )
    expect(readFileSync(resolve(output, 'SHA256SUMS'), 'utf8')).toContain(
      'sudowork-webui-1.2.3-linux-amd64.tar.gz',
    )
    execFileSync('shasum', ['-a', '256', '-c', 'SHA256SUMS'], { cwd: output })
  })

  test('packages Docker images into the release asset layout', () => {
    const directory = createTemporaryDirectory()
    const fakeBin = resolve(directory, 'bin')
    const dockerLog = resolve(directory, 'docker.log')
    const output = resolve(directory, 'release')
    mkdirSync(fakeBin)
    const docker = resolve(fakeBin, 'docker')
    writeFileSync(
      docker,
      `#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_LOG"
if [ "\${1:-}" = save ]; then printf 'mock docker image stream'; fi
exit 0
`,
    )
    chmodSync(docker, 0o755)
    const env = installerEnv()
    env.PATH = `${fakeBin}:${env.PATH}`
    env.DOCKER_LOG = dockerLog

    const result = spawnSync('bash', [PACKAGE_RELEASE_SCRIPT, 'v1.2.3', 'amd64', output], {
      encoding: 'utf8',
      env,
    })

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(resolve(output, 'install.sh'))).toBe(true)
    expect(existsSync(resolve(output, 'SHA256SUMS'))).toBe(true)
    execFileSync('gzip', ['-t', resolve(output, 'sudowork-webui-1.2.3-linux-amd64.tar.gz')])
    const commands = readFileSync(dockerLog, 'utf8')
    expect(commands).toContain('buildx build --platform linux/amd64 --load')
    expect(commands).toContain('pull --platform linux/amd64 postgres:16-alpine')
    expect(commands).toContain('save sudowork-webui:1.2.3 postgres:16-alpine')
  })

  test('installs an offline release bundle and writes management scripts', () => {
    const directory = createTemporaryDirectory()
    const bundle = resolve(directory, 'bundle')
    const installDirectory = resolve(directory, 'installed')
    const fakeBin = resolve(directory, 'bin')
    const dockerLog = resolve(directory, 'docker.log')
    const archive = resolve(directory, 'images.tar.gz')
    mkdirSync(fakeBin)
    writeFileSync(archive, execFileSync('gzip', ['-c'], { input: 'mock docker archive' }))
    execFileSync('bash', [PREPARE_RELEASE_SCRIPT, 'v1.2.3', 'amd64', archive, bundle])

    const commands: Record<string, string> = {
      docker: `#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_LOG"
if [ "\${1:-}" = load ]; then cat >/dev/null; exit 0; fi
if [ "\${1:-}" = inspect ]; then echo healthy; exit 0; fi
case " $* " in *" ps -q webui "*) echo webui-container;; esac
exit 0
`,
      getent: `#!/bin/sh
printf 'tester:x:1000:1000::%s:/bin/sh\n' "$HOME"
`,
      id: `#!/bin/sh
case "\${1:-}" in
  -u) echo 0 ;;
  -un) echo tester ;;
  -gn) echo tester ;;
  *) echo tester ;;
esac
`,
      uname: `#!/bin/sh
case "\${1:-}" in
  -s) echo Linux ;;
  -m) echo x86_64 ;;
  *) echo Linux ;;
esac
`,
    }
    for (const [name, contents] of Object.entries(commands)) {
      const path = resolve(fakeBin, name)
      writeFileSync(path, contents)
      chmodSync(path, 0o755)
    }

    const env = installerEnv()
    env.PATH = `${fakeBin}:${env.PATH}`
    env.HOME = directory
    env.DOCKER_LOG = dockerLog
    env.WEBUI_INSTALL_USER = 'tester'
    const result = spawnSync(
      'bash',
      [
        resolve(bundle, 'install.sh'),
        '--offline',
        '--non-interactive',
        '--skip-moss-check',
        '--public-origin',
        'https://webui.example.com',
        '--moss-url',
        'http://10.0.1.206:43127',
        '--install-dir',
        installDirectory,
      ],
      { encoding: 'utf8', env },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(resolve(installDirectory, 'release-tag'), 'utf8').trim()).toBe('v1.2.3')
    expect(readFileSync(resolve(installDirectory, 'docker-compose.yml'), 'utf8')).toContain(
      'image: sudowork-webui:1.2.3',
    )
    expect(statSync(resolve(installDirectory, '.env')).mode & 0o777).toBe(0o600)
    expect(statSync(resolve(installDirectory, 'status.sh')).mode & 0o111).not.toBe(0)
    expect(statSync(resolve(installDirectory, 'backup.sh')).mode & 0o111).not.toBe(0)
    expect(statSync(resolve(installDirectory, 'restore.sh')).mode & 0o111).not.toBe(0)
    execFileSync('bash', ['-n', resolve(installDirectory, 'backup.sh')])
    execFileSync('bash', ['-n', resolve(installDirectory, 'restore.sh')])
    expect(readFileSync(resolve(installDirectory, 'backup.sh'), 'utf8')).toContain('pg_dump')
    expect(readFileSync(resolve(installDirectory, 'restore.sh'), 'utf8')).toContain(
      'DROP SCHEMA public CASCADE',
    )
    expect(readFileSync(dockerLog, 'utf8')).toContain('load')
    expect(readFileSync(dockerLog, 'utf8')).toContain('up -d')
  })

  test('backs up an existing database and deployment files before an upgrade', () => {
    const directory = createTemporaryDirectory()
    const bundle = resolve(directory, 'bundle')
    const installDirectory = resolve(directory, 'installed')
    const fakeBin = resolve(directory, 'bin')
    const dockerLog = resolve(directory, 'docker.log')
    const archive = resolve(directory, 'images.tar.gz')
    mkdirSync(fakeBin)
    mkdirSync(installDirectory)
    writeFileSync(archive, execFileSync('gzip', ['-c'], { input: 'mock docker archive' }))
    execFileSync('bash', [PREPARE_RELEASE_SCRIPT, 'v1.2.3', 'amd64', archive, bundle])
    writeFileSync(
      resolve(installDirectory, '.env'),
      [
        'POSTGRES_USER=postgres',
        'POSTGRES_PASSWORD=old-password',
        'POSTGRES_DB=sudowork_webui',
        'SESSION_HMAC_KEY=' + 'a'.repeat(64),
        'TOKEN_AES_KEY=' + 'b'.repeat(64),
        'PUBLIC_ORIGIN=https://old-webui.example.com',
        'TRUST_PROXY=true',
        'MOSS_BASE_URL=http://10.0.1.206:43127',
        'MOSS_WS_BASE_URL=ws://10.0.1.206:43127',
        'MOSS_ALLOWED_ORIGINS=',
        'CSP_IMG_SRC_ORIGINS=',
        'WEBUI_PORT=26808',
      ].join('\n') + '\n',
    )
    writeFileSync(resolve(installDirectory, 'docker-compose.yml'), 'old-compose\n')
    writeFileSync(resolve(installDirectory, 'release-tag'), 'v1.2.2\n')

    const docker = resolve(fakeBin, 'docker')
    writeFileSync(
      docker,
      `#!/bin/sh
printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  *pg_dump*) printf 'database backup'; exit 0 ;;
  *pg_isready*) exit 0 ;;
esac
if [ "\${1:-}" = load ]; then cat >/dev/null; exit 0; fi
if [ "\${1:-}" = inspect ]; then echo healthy; exit 0; fi
case " $* " in *" ps -q webui "*) echo webui-container;; esac
exit 0
`,
    )
    chmodSync(docker, 0o755)
    for (const [name, contents] of Object.entries({
      getent: `#!/bin/sh\nprintf 'tester:x:1000:1000::%s:/bin/sh\n' "$HOME"\n`,
      id: `#!/bin/sh\ncase "\${1:-}" in -u) echo 0;; -un|-gn) echo tester;; *) echo tester;; esac\n`,
      uname: `#!/bin/sh\ncase "\${1:-}" in -s) echo Linux;; -m) echo x86_64;; *) echo Linux;; esac\n`,
    })) {
      const path = resolve(fakeBin, name)
      writeFileSync(path, contents)
      chmodSync(path, 0o755)
    }

    const env = installerEnv()
    env.PATH = `${fakeBin}:${env.PATH}`
    env.HOME = directory
    env.DOCKER_LOG = dockerLog
    env.WEBUI_INSTALL_USER = 'tester'
    const result = spawnSync(
      'bash',
      [
        resolve(bundle, 'install.sh'),
        '--offline',
        '--non-interactive',
        '--skip-moss-check',
        '--install-dir',
        installDirectory,
      ],
      { encoding: 'utf8', env },
    )

    expect(result.status, result.stderr).toBe(0)
    const backups = readdirSync(resolve(installDirectory, 'backups'))
    expect(backups).toHaveLength(1)
    const backupDirectory = resolve(installDirectory, 'backups', backups[0]!)
    expect(readFileSync(resolve(backupDirectory, 'database.dump'), 'utf8')).toBe('database backup')
    expect(readFileSync(resolve(backupDirectory, 'docker-compose.yml'), 'utf8')).toBe(
      'old-compose\n',
    )
    expect(readFileSync(resolve(backupDirectory, 'release-tag'), 'utf8')).toBe('v1.2.2\n')
  })
})
