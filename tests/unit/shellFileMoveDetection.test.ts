import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectVerifiedFileMoves } from '@/process/task/shellFileMoveDetection';

let workspace: string;
let outside: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'move-detect-workspace-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'move-detect-outside-'));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

function detect(command: string, shell: 'bash' | 'powershell', source: string, destination: string) {
  return detectVerifiedFileMoves({
    command,
    shell,
    workspace,
    previousPaths: new Set([source]),
    currentPaths: new Set(destination.startsWith(workspace) ? [destination] : []),
    deliverablePaths: new Set([source]),
  });
}

describe('detectVerifiedFileMoves', () => {
  it('detects a literal mv of an existing deliverable to a workspace directory', () => {
    const source = path.join(workspace, 'report.md');
    const directory = path.join(workspace, 'archive');
    const destination = path.join(directory, 'report.md');
    fs.mkdirSync(directory);
    fs.writeFileSync(destination, '# report');

    const moves = detect('mv report.md archive/', 'bash', source, destination);

    expect(moves).toEqual([{ sourcePath: source, sourceRelativePath: 'report.md', destinationPath: destination, destinationRelativePath: 'archive/report.md' }]);
  });

  it('detects multiple literal sources moved into one directory', () => {
    const firstSource = path.join(workspace, 'a.md');
    const secondSource = path.join(workspace, 'b.md');
    const directory = path.join(workspace, 'archive');
    const firstDestination = path.join(directory, 'a.md');
    const secondDestination = path.join(directory, 'b.md');
    fs.mkdirSync(directory);
    fs.writeFileSync(firstDestination, 'a');
    fs.writeFileSync(secondDestination, 'b');

    const moves = detectVerifiedFileMoves({
      command: 'mv a.md b.md archive/',
      shell: 'bash',
      workspace,
      previousPaths: new Set([firstSource, secondSource]),
      currentPaths: new Set([firstDestination, secondDestination]),
      deliverablePaths: new Set([firstSource, secondSource]),
    });

    expect(moves.map((move) => move.destinationPath)).toEqual([firstDestination, secondDestination]);
  });

  it('detects a literal mv to a path outside the workspace', () => {
    const source = path.join(workspace, 'report.md');
    const destination = path.join(outside, 'report.md');
    fs.writeFileSync(destination, '# report');

    const moves = detect(`mv report.md '${outside}'`, 'bash', source, destination);

    expect(moves).toEqual([{ sourcePath: source, sourceRelativePath: 'report.md', destinationPath: destination }]);
  });

  it('detects a literal mv followed by target verification', () => {
    const source = path.join(workspace, '通用采购管理模板.xlsx');
    const destination = path.join(outside, '通用采购管理模板.xlsx');
    fs.writeFileSync(destination, 'workbook');
    const command = `mv '${source}' '${destination}' && test -f '${destination}' && echo 'MOVED'`;

    const moves = detect(command, 'bash', source, destination);

    expect(moves).toEqual([{ sourcePath: source, sourceRelativePath: '通用采购管理模板.xlsx', destinationPath: destination }]);
  });

  it('detects a guarded mv using quoted literal variable assignments', () => {
    const source = path.join(workspace, '供应商信息台账模板.xlsx');
    const destination = path.join(outside, '供应商信息台账模板.xlsx');
    fs.writeFileSync(destination, 'workbook');
    const command = `src="${source}"
dst="${destination}"
if [ ! -f "$src" ]; then
  exit 1
fi
if [ -e "$dst" ]; then
  exit 2
fi
mv "$src" "$dst" || exit 3
printf 'done: %s\\n' "$dst"`;

    const moves = detect(command, 'bash', source, destination);

    expect(moves).toEqual([{ sourcePath: source, sourceRelativePath: '供应商信息台账模板.xlsx', destinationPath: destination }]);
  });

  it('rejects guarded mv operands that are not assigned literal paths', () => {
    const source = path.join(workspace, 'report.md');
    const destination = path.join(outside, 'report.md');
    fs.writeFileSync(destination, '# report');

    expect(detect('src="report.md"\ndst="$HOME/report.md"\nmv "$src" "$dst"', 'bash', source, destination)).toEqual([]);
  });

  it('detects PowerShell Move-Item and Rename-Item', () => {
    const moveSource = path.join(workspace, 'move.md');
    const moveDirectory = path.join(workspace, 'archive');
    const moveDestination = path.join(moveDirectory, 'move.md');
    fs.mkdirSync(moveDirectory);
    fs.writeFileSync(moveDestination, 'move');

    expect(detect('Move-Item move.md archive', 'powershell', moveSource, moveDestination)).toHaveLength(1);
    expect(detect('Move-Item -Destination archive -Path move.md', 'powershell', moveSource, moveDestination)).toHaveLength(1);
    expect(detect('Move-Item -Path move.md archive', 'powershell', moveSource, moveDestination)).toHaveLength(1);

    const renameSource = path.join(workspace, 'old.md');
    const renameDestination = path.join(workspace, 'new.md');
    fs.writeFileSync(renameDestination, 'rename');
    expect(detect('Rename-Item old.md new.md', 'powershell', renameSource, renameDestination)[0]?.destinationPath).toBe(renameDestination);
    expect(detect('Rename-Item -NewName new.md -Path old.md', 'powershell', renameSource, renameDestination)[0]?.destinationPath).toBe(renameDestination);
    expect(detect('Rename-Item -Path old.md new.md', 'powershell', renameSource, renameDestination)[0]?.destinationPath).toBe(renameDestination);
  });

  it('detects moving a known external deliverable back into the workspace', () => {
    const source = path.join(outside, 'report.md');
    const destination = path.join(workspace, 'report.md');
    fs.writeFileSync(destination, '# report');

    const moves = detectVerifiedFileMoves({
      command: `mv '${source}' '${workspace}'`,
      shell: 'bash',
      workspace,
      previousPaths: new Set([source]),
      currentPaths: new Set([destination]),
      deliverablePaths: new Set([source]),
    });

    expect(moves).toEqual([{ sourcePath: source, destinationPath: destination, destinationRelativePath: 'report.md' }]);
  });

  it('rejects dynamic commands and non-deliverable sources', () => {
    const source = path.join(workspace, 'report.md');
    const directory = path.join(workspace, 'archive');
    const destination = path.join(directory, 'report.md');
    fs.mkdirSync(directory);
    fs.writeFileSync(destination, '# report');

    expect(detectVerifiedFileMoves({ command: 'mv "$file" archive/', shell: 'bash', workspace, previousPaths: new Set([source]), currentPaths: new Set([destination]), deliverablePaths: new Set([source]) })).toEqual([]);
    expect(detectVerifiedFileMoves({ command: 'mv report.md archive/', shell: 'bash', workspace, previousPaths: new Set([source]), currentPaths: new Set([destination]), deliverablePaths: new Set() })).toEqual([]);
  });

  it('rejects a move when the source still exists after execution', () => {
    const source = path.join(workspace, 'report.md');
    const directory = path.join(workspace, 'archive');
    const destination = path.join(directory, 'report.md');
    fs.mkdirSync(directory);
    fs.writeFileSync(source, '# source');
    fs.writeFileSync(destination, '# destination');

    expect(
      detectVerifiedFileMoves({
        command: 'mv report.md archive/',
        shell: 'bash',
        workspace,
        previousPaths: new Set([source]),
        currentPaths: new Set([source, destination]),
        deliverablePaths: new Set([source]),
      })
    ).toEqual([]);
  });
});
