import { execFile } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { parseOfficeAsync } from 'officeparser';
import { mainWarn } from '@process/utils/mainLogger';

const execFileAsync = promisify(execFile);

export type LocalKbParseVia = 'passthrough' | 'mammoth' | 'officeparser' | 'pdftotext' | 'libreoffice' | 'raw-copy';

export interface ILocalKbParseResult {
  markdown: string;
  via: LocalKbParseVia;
}

export async function sha256File(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

export function inferMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.doc':
      return 'application/msword';
    case '.pdf':
      return 'application/pdf';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.ppt':
      return 'application/vnd.ms-powerpoint';
    default:
      return 'application/octet-stream';
  }
}

export async function parseLocalKbDocument(filePath: string, fileName: string): Promise<ILocalKbParseResult> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    return { markdown: await fs.readFile(filePath, 'utf8'), via: 'passthrough' };
  }

  if (ext === '.docx') {
    const result = await mammoth.convertToHtml({ path: filePath });
    const markdown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(String(result.value ?? '')).trim();
    if (markdown) return { markdown, via: 'mammoth' };
  }

  if (ext === '.pdf') {
    const officeParsed = await parseWithOfficeParser(filePath, fileName);
    if (officeParsed) return officeParsed;
    const pdftotextParsed = await parsePdfWithPdftotext(filePath);
    if (pdftotextParsed) return pdftotextParsed;
  }

  const officeParsed = await parseWithOfficeParser(filePath, fileName);
  if (officeParsed) return officeParsed;

  const libreOfficeParsed = await parseWithLibreOffice(filePath, fileName);
  if (libreOfficeParsed) return libreOfficeParsed;

  const raw = await fs.readFile(filePath).catch((): Buffer => Buffer.alloc(0));
  const safePreview = raw
    .toString('utf8')
    .split('')
    .filter((char) => char.charCodeAt(0) !== 0)
    .join('')
    .trim();
  return {
    markdown: safePreview ? `# ${path.basename(fileName)}\n\n${safePreview.slice(0, 200_000)}\n` : `# ${path.basename(fileName)}\n\n无法解析该文件。\n`,
    via: 'raw-copy',
  };
}

async function parseWithOfficeParser(filePath: string, fileName: string): Promise<ILocalKbParseResult | null> {
  try {
    const text = (await parseOfficeAsync(filePath, { newlineDelimiter: '\n', outputErrorToConsole: false })).trim();
    return text ? { markdown: `# ${path.basename(fileName)}\n\n${text}\n`, via: 'officeparser' } : null;
  } catch (err) {
    mainWarn('LocalKbParser', 'officeparser unavailable or failed:', err);
    return null;
  }
}

async function parsePdfWithPdftotext(filePath: string): Promise<ILocalKbParseResult | null> {
  const tmpFile = path.join(os.tmpdir(), `sudowork-local-kb-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  try {
    await execFileAsync('pdftotext', [filePath, tmpFile], { timeout: 30_000 });
    const text = (await fs.readFile(tmpFile, 'utf8')).trim();
    return text ? { markdown: text, via: 'pdftotext' } : null;
  } catch {
    return null;
  } finally {
    await fs.unlink(tmpFile).catch((): undefined => undefined);
  }
}

async function resolveLibreOfficeBin(): Promise<string | null> {
  const candidates = [
    process.env.LIBREOFFICE_BIN,
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/Applications/OpenOffice.app/Contents/MacOS/soffice',
    'soffice',
    'libreoffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/snap/bin/libreoffice',
  ].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 5_000 });
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

async function parseWithLibreOffice(filePath: string, fileName: string): Promise<ILocalKbParseResult | null> {
  const soffice = await resolveLibreOfficeBin();
  if (!soffice) return null;
  const workDir = path.join(os.tmpdir(), `sudowork-local-kb-conv-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await fs.mkdir(workDir, { recursive: true });
  try {
    await execFileAsync(soffice, ['--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', workDir, filePath], { timeout: 60_000 });
    const baseName = path.basename(fileName, path.extname(fileName));
    const outPath = path.join(workDir, `${baseName}.txt`);
    const text = (await fs.readFile(outPath, 'utf8')).trim();
    if (!text) return null;
    return {
      markdown: `# ${baseName.replace(/[_-]+/g, ' ')}\n\n${text}\n`,
      via: 'libreoffice',
    };
  } catch (err) {
    mainWarn('LocalKbParser', 'LibreOffice parse failed:', err);
    return null;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch((): undefined => undefined);
  }
}
