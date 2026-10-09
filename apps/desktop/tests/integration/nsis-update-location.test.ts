import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const localRequire = createRequire(import.meta.url);
const builderCache = process.env.ELECTRON_BUILDER_CACHE ?? path.join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache');
const compiler = process.env.NSIS_TEST_MAKENSIS ?? path.join(builderCache, 'nsis', 'nsis-3.0.4.1-nsis-3.0.4.1', 'Bin', 'makensis.exe');
const isCompilerAvailable = process.platform === 'win32' && existsSync(compiler);
if (process.env.NSIS_TEST_REQUIRE_COMPILER === '1' && !isCompilerAvailable) {
  throw new Error('Required Windows NSIS regression compiler is unavailable');
}

/** Execute the real installer callback with electron-builder's real sanitizer. */
function runDirectoryCallback(directory: string, isUpdated: boolean): string {
  const script = readFileSync(path.resolve(__dirname, '../../scripts/installer.nsh'), 'utf8');
  const customCallback = script.match(/Function instFilesPreserveUpdateLocationPre\s[\s\S]*?FunctionEnd/)?.[0];
  expect(customCallback).toBeDefined();
  const builderRequire = createRequire(localRequire.resolve('electron-builder/package.json'));
  const builder = path.dirname(builderRequire.resolve('app-builder-lib/package.json'));
  const upstream = readFileSync(path.join(builder, 'templates/nsis/assistedInstaller.nsh'), 'utf8');
  const upstreamCallback = upstream.match(/Function instFilesPre\s[\s\S]*?FunctionEnd/)?.[0];
  expect(upstreamCallback).toBeDefined();
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'sudowork-nsis-location-'));
  const escape = (value: string) => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
  const output = path.join(fixture, 'directory.txt');
  const executable = path.join(fixture, 'callback.exe');
  const nsis = path.join(fixture, 'callback.nsi');
  try {
    writeFileSync(
      nsis,
      `Unicode true
Name "Sudowork directory regression"
OutFile "${escape(executable)}"
RequestExecutionLevel user
SilentInstall silent
!addincludedir "${escape(path.join(builder, 'templates/nsis/include'))}"
!include LogicLib.nsh
!include StrContains.nsh
!define APP_FILENAME "Sudowork"
Var isUpdate
!define isUpdated '$isUpdate == "1"'
${upstreamCallback}
${customCallback}
Function .onInit
  StrCpy $isUpdate "${isUpdated ? '1' : '0'}"
  StrCpy $INSTDIR "${escape(directory)}"
  Call instFilesPreserveUpdateLocationPre
  FileOpen $0 "${escape(output)}" w
  FileWriteUTF16LE $0 "$INSTDIR"
  FileClose $0
  SetErrorLevel 0
  Quit
FunctionEnd
Section
SectionEnd
`
    );
    execFileSync(compiler, ['/V2', nsis], { timeout: 30_000, stdio: 'pipe' });
    execFileSync(executable, [], { timeout: 30_000, stdio: 'pipe' });
    return readFileSync(output, 'utf16le').replace(/^\uFEFF/, '');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe.skipIf(!isCompilerAvailable)('NSIS update installation directory', () => {
  it('preserves a custom directory during an update', () => {
    expect(runDirectoryCallback('C:\\QA\\custom-desktop', true)).toBe('C:\\QA\\custom-desktop');
  });

  it('preserves an existing product directory during an update', () => {
    expect(runDirectoryCallback('C:\\QA\\Sudowork', true)).toBe('C:\\QA\\Sudowork');
  });

  it('still adds the product folder for a fresh custom installation', () => {
    expect(runDirectoryCallback('C:\\QA\\custom-desktop', false)).toBe('C:\\QA\\custom-desktop\\Sudowork');
  });

  it('still preserves a fresh installation that already contains the product folder', () => {
    expect(runDirectoryCallback('C:\\QA\\Sudowork', false)).toBe('C:\\QA\\Sudowork');
  });
});
