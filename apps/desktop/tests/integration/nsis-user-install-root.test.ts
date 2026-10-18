import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localRequire = createRequire(import.meta.url);
const builderCache = process.env.ELECTRON_BUILDER_CACHE ?? path.join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache');
const compiler = process.env.NSIS_TEST_MAKENSIS ?? path.join(builderCache, 'nsis', 'nsis-3.0.4.1-nsis-3.0.4.1', 'Bin', 'makensis.exe');
const isCompilerAvailable = process.platform === 'win32' && existsSync(compiler);
if (process.env.NSIS_TEST_REQUIRE_COMPILER === '1' && !isCompilerAvailable) {
  throw new Error('Required Windows NSIS regression compiler is unavailable');
}

describe.skipIf(!isCompilerAvailable)('NSIS per-user installation root', () => {
  it('uses the Windows known folder and preserves caller registers', () => {
    const builderRequire = createRequire(process.env.NSIS_TEST_BUILDER_PACKAGE ?? localRequire.resolve('electron-builder/package.json'));
    const builder = path.dirname(builderRequire.resolve('app-builder-lib/package.json'));
    const upstream = readFileSync(path.join(builder, 'templates/nsis/multiUser.nsh'), 'utf8');
    const callback = upstream.match(/!macro setInstallModePerUser\s[\s\S]*?!macroend/)?.[0];
    expect(callback).toBeDefined();
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'sudowork-nsis-user-root-'));
    const escape = (value: string) => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
    const executable = path.join(fixture, 'known-folder.exe');
    const output = path.join(fixture, 'known-folder.txt');
    const script = path.join(fixture, 'known-folder.nsi');
    try {
      // Execute the shipped macro. Only /D parsing is stubbed to test its default-root branch.
      writeFileSync(
        script,
        `Unicode true
Name "Sudowork per-user root regression"
OutFile "${escape(executable)}"
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!define FOLDERID_UserProgramFiles {5CD7AEE2-2219-4A67-B85D-6C9CE15660CB}
!define KF_FLAG_CREATE 0x00008000
!define INSTALL_REGISTRY_KEY "Software\\SudoworkKnownFolderQA\\${path.basename(fixture)}"
!define APP_FILENAME "Sudowork"
Var installMode
Var perUserInstallationFolder
Var expectedRoot
!macro GetDParameter outVar
  StrCpy \${outVar} ""
!macroend
${callback}
Function .onInit
  System::Call 'SHELL32::SHGetKnownFolderPath(g "\${FOLDERID_UserProgramFiles}", i \${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'
  IntCmp $1 0 +3
  SetErrorLevel 20
  Quit
  System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i \${NSIS_MAX_STRLEN})p'
  System::Call 'OLE32::CoTaskMemFree(p r2)'
  StrCpy $expectedRoot "$0\\Sudowork"
  StrCpy $1 "caller-register-one"
  StrCpy $2 "caller-register-two"
  !insertmacro setInstallModePerUser
  FileOpen $0 "${escape(output)}" w
  FileWriteUTF16LE $0 "$expectedRoot$\\n$INSTDIR$\\n$1$\\n$2"
  FileClose $0
  SetErrorLevel 0
  Quit
FunctionEnd
Section
SectionEnd
`
      );
      execFileSync(compiler, ['/V2', script], { timeout: 30_000, stdio: 'pipe' });
      execFileSync(executable, ['/S'], { timeout: 8_000, stdio: 'pipe' });
      const [expectedRoot, actualRoot, registerOne, registerTwo] = readFileSync(output, 'utf16le')
        .replace(/^\uFEFF/, '')
        .split('\n');
      expect(expectedRoot).toMatch(/\\Sudowork$/);
      expect(actualRoot).toBe(expectedRoot);
      expect(registerOne).toBe('caller-register-one');
      expect(registerTwo).toBe('caller-register-two');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 40_000);
});
