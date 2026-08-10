import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface VerifiedFileMove {
  sourcePath: string;
  sourceRelativePath?: string;
  destinationPath: string;
  destinationRelativePath?: string;
}

interface DetectVerifiedFileMovesOptions {
  command?: string | null;
  shell: 'bash' | 'powershell';
  workspace: string;
  previousPaths: ReadonlySet<string>;
  currentPaths: ReadonlySet<string>;
  deliverablePaths: ReadonlySet<string>;
}

/** Detect explicit mv/Move-Item/Rename-Item commands and verify their post-command paths. */
export function detectVerifiedFileMoves(options: DetectVerifiedFileMovesOptions): VerifiedFileMove[] {
  const { command, shell, workspace, previousPaths, currentPaths, deliverablePaths } = options;
  if (!command?.trim()) return [];

  const words = shell === 'bash' ? extractBashMoveWords(command) : tokenizeLiteralCommand(command);
  if (!words) return [];

  const parsed = shell === 'powershell' ? parsePowerShellMove(words) : parseMv(words);
  if (!parsed) return [];

  const workspaceRoot = path.resolve(workspace);
  const sources = parsed.sources.map((source) => resolveLiteralPath(workspaceRoot, source));
  if (sources.some((source) => !source)) return [];

  const destinationOperand = parsed.isRename ? path.resolve(path.dirname(sources[0]!), parsed.destination) : resolveLiteralPath(workspaceRoot, parsed.destination);
  if (!destinationOperand) return [];

  let destinationStat: fs.Stats;
  try {
    destinationStat = fs.lstatSync(destinationOperand);
  } catch {
    return [];
  }

  if (destinationStat.isSymbolicLink()) return [];
  if (sources.length > 1 && !destinationStat.isDirectory()) return [];

  const moves: VerifiedFileMove[] = [];
  for (const sourceValue of sources) {
    const sourcePath = sourceValue!;
    if (!deliverablePaths.has(sourcePath) || !previousPaths.has(sourcePath) || currentPaths.has(sourcePath) || exists(sourcePath)) continue;

    const destinationPath = destinationStat.isDirectory() ? path.join(destinationOperand, path.basename(sourcePath)) : destinationOperand;
    let finalStat: fs.Stats;
    try {
      finalStat = fs.lstatSync(destinationPath);
    } catch {
      continue;
    }
    if (!finalStat.isFile() || finalStat.isSymbolicLink()) continue;

    const sourceRelative = path.relative(workspaceRoot, sourcePath);
    const isSourceInWorkspace = sourceRelative && !sourceRelative.startsWith('..') && !path.isAbsolute(sourceRelative);
    const destinationRelative = path.relative(workspaceRoot, destinationPath);
    const isDestinationInWorkspace = destinationRelative && !destinationRelative.startsWith('..') && !path.isAbsolute(destinationRelative);
    moves.push({
      sourcePath,
      ...(isSourceInWorkspace ? { sourceRelativePath: sourceRelative.replace(/\\/g, '/') } : {}),
      destinationPath: path.resolve(destinationPath),
      ...(isDestinationInWorkspace ? { destinationRelativePath: destinationRelative.replace(/\\/g, '/') } : {}),
    });
  }

  return moves;
}

interface ParsedMoveCommand {
  sources: string[];
  destination: string;
  isRename?: boolean;
}

function parseMv(words: string[]): ParsedMoveCommand | null {
  if (path.basename(words[0]).toLowerCase() !== 'mv') return null;
  const args = words.slice(1);
  if (args.some((word) => word.startsWith('-') && word !== '--' && !/^-+[finv]+$/.test(word))) return null;
  const normalized = args.filter((word) => (word === '--' ? false : !word.startsWith('-')));
  if (normalized.length < 2) return null;
  return { sources: normalized.slice(0, -1), destination: normalized.at(-1)! };
}

function parsePowerShellMove(words: string[]): ParsedMoveCommand | null {
  const command = words[0].toLowerCase();
  if (command !== 'move-item' && command !== 'rename-item') return null;

  const args = words.slice(1);
  const positionals = getPowerShellPositionals(args);
  const namedSource = findPowerShellArgument(args, ['-path', '-literalpath']);
  const source = namedSource ?? positionals[0];
  const destinationNames = command === 'rename-item' ? ['-newname'] : ['-destination'];
  const namedDestination = findPowerShellArgument(args, destinationNames);
  const destination = namedDestination ?? positionals[namedSource ? 0 : 1];
  if (!source || !destination) return null;
  if (command === 'rename-item' && (path.basename(destination) !== destination || destination === '.' || destination === '..')) return null;
  return { sources: [source], destination, isRename: command === 'rename-item' };
}

function findPowerShellArgument(args: string[], names: string[]): string | undefined {
  const nameSet = new Set(names);
  for (let index = 0; index < args.length - 1; index++) {
    if (nameSet.has(args[index].toLowerCase()) && !args[index + 1].startsWith('-')) return args[index + 1];
  }
  return undefined;
}

function getPowerShellPositionals(args: string[]): string[] {
  const values: string[] = [];
  const valuedParameters = new Set(['-path', '-literalpath', '-destination', '-newname']);
  for (let index = 0; index < args.length; index++) {
    if (args[index].startsWith('-')) {
      if (valuedParameters.has(args[index].toLowerCase())) index++;
      continue;
    }
    values.push(args[index]);
  }
  return values;
}

function extractBashMoveWords(command: string): string[] | null {
  const directWords = tokenizeLiteralCommand(command);
  if (directWords) return directWords;

  const variables = new Map<string, string>();
  let moveWords: string[] | null = null;

  for (const rawLine of command.split('\n')) {
    const line = rawLine.trim();
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"$`]*)"|'([^']*)')$/);
    if (assignment) {
      variables.set(assignment[1], assignment[2] ?? assignment[3]);
      continue;
    }

    const move = line.match(/^(mv\s+.*?)(?:\s+&&\s+test\s+-f\s+.+?(?:\s+&&\s+echo\s+.+)?|\s+\|\|\s+exit(?:\s+\d+)?)?$/);
    if (!move) continue;
    if (moveWords) return null;

    const referencedVariables: string[] = [];
    const substituted = move[1].replace(/"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))"/g, (_match, bracedName, plainName) => {
      const name = bracedName ?? plainName;
      referencedVariables.push(name);
      return `__NEXUS_MOVE_VAR_${referencedVariables.length - 1}__`;
    });
    const words = tokenizeLiteralCommand(substituted);
    if (!words) return null;

    moveWords = words.map((word) => {
      const variable = word.match(/^__NEXUS_MOVE_VAR_(\d+)__$/);
      return variable ? (variables.get(referencedVariables[Number(variable[1])]) ?? '') : word;
    });
    if (moveWords.some((word) => !word)) return null;
  }

  return moveWords;
}

function tokenizeLiteralCommand(command: string): string[] | null {
  if (/[\n;&|><`$*?[\]]/.test(command) || /%[^%]+%/.test(command)) return null;
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) words.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (quote) return null;
  if (current) words.push(current);
  return words.length > 0 ? words : null;
}

function resolveLiteralPath(workspace: string, value: string): string | null {
  if (!value || (value.startsWith('~') && value !== '~' && !value.startsWith('~/'))) return null;
  const expanded = value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  return path.resolve(workspace, expanded);
}

function exists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}
