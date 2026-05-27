/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CliInstallService } from '../claudeCli/CliInstallService';
import { ipcBridge } from '@/common';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { getAuthProxyPort, registerToken, revokeToken } from '@process/services/authProxy';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { renderShareTemplate } from './shareTemplate';

const execFileAsync = promisify(execFile);

const cli = new CliInstallService({
  name: 'shareone',
  npmPackage: '@shareone/cli',
  ossName: 'shareone',
  declinedKey: 'shareoneCli.installDeclined',
  label: 'ShareOne CLI',
  useBundledNode: true,
  onProgress: (phase, percent) => {
    ipcBridge.shareoneCli.installProgress.emit({ phase, percent });
  },
});

function getMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    avif: 'image/avif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    aac: 'audio/aac',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function isLocalPath(url: string): boolean {
  if (url.startsWith('data:')) return false;
  if (url.startsWith('http://') || url.startsWith('https://')) return false;
  if (url.startsWith('//')) return false;
  return true;
}

async function loadLocalResourceAsDataUrl(filePath: string): Promise<string> {
  try {
    const mime = getMimeFromPath(filePath);
    const base64 = await fs.promises.readFile(filePath, { encoding: 'base64' });
    return `data:${mime};base64,${base64}`;
  } catch {
    return '';
  }
}

export class ShareoneCliService {
  checkInstalled = () => cli.checkInstalled();

  install = () => cli.install();

  async publishTurn(opts: { markdown: string; title: string }): Promise<{ url: string }> {
    const { markdown, title } = opts;

    return new Promise((resolve, reject) => {
      this.checkInstalled()
        .then(async (status) => {
          if (!status.installed || !status.path) {
            return reject(Object.assign(new Error('ShareOne CLI not installed'), { code: 'CLI_NOT_INSTALLED' }));
          }

          const contentHtml = await this.markdownToHtml(markdown);
          const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
          const html = renderShareTemplate({ title, contentHtml, timestamp });

          const tmpDir = os.tmpdir();
          const tmpFile = path.join(tmpDir, `sudowork-share-${Date.now()}.html`);
          try {
            fs.writeFileSync(tmpFile, html, 'utf-8');
            const result = await this.execShareonePublish(status.path, tmpFile);
            resolve(result);
          } finally {
            try {
              fs.unlinkSync(tmpFile);
            } catch {
              // best-effort cleanup
            }
          }
        })
        .catch(reject);
    });
  }

  async publishFile(opts: { filePath: string }): Promise<{ url: string }> {
    const { filePath } = opts;

    const status = await this.checkInstalled();
    if (!status.installed || !status.path) {
      return Promise.reject(Object.assign(new Error('ShareOne CLI not installed'), { code: 'CLI_NOT_INSTALLED' }));
    }

    if (!fs.existsSync(filePath)) {
      return Promise.reject(Object.assign(new Error(`File not found: ${filePath}`), { code: 'FILE_NOT_FOUND' }));
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return Promise.reject(Object.assign(new Error(`Not a file: ${filePath}`), { code: 'FILE_NOT_FOUND' }));
    }

    return await this.execShareonePublish(status.path, filePath);
  }

  private async markdownToHtml(markdown: string): Promise<string> {
    const lines = markdown.split('\n');
    const htmlParts: string[] = [];
    let inCodeBlock = false;
    let inList = false;
    let inTable = false;
    let tableRows: string[][] = [];

    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const closeList = () => {
      if (inList) {
        htmlParts.push('</ul>');
        inList = false;
      }
    };
    const closeTable = () => {
      if (inTable && tableRows.length > 0) {
        htmlParts.push('<table>');
        tableRows.forEach((row, i) => {
          const tag = i === 0 ? 'th' : 'td';
          htmlParts.push('<tr>' + row.map((c) => `<${tag}>${c}</${tag}>`).join('') + '</tr>');
        });
        htmlParts.push('</table>');
        tableRows = [];
      }
      inTable = false;
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        closeList();
        closeTable();
        if (inCodeBlock) {
          htmlParts.push('</code></pre>');
          inCodeBlock = false;
        } else {
          htmlParts.push('<pre><code>');
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        htmlParts.push(escapeHtml(line));
        continue;
      }

      if (line.match(/^\|.*\|/)) {
        closeList();
        inTable = true;
        const cells = line
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean);
        if (cells.every((c) => /^[-:]+$/.test(c))) continue;
        tableRows.push(cells.map(escapeHtml));
        continue;
      } else {
        closeTable();
      }

      if (/^[-*+]\s/.test(line)) {
        if (!inList) {
          htmlParts.push('<ul>');
          inList = true;
        }
        const content = line.replace(/^[-*+]\s/, '');
        htmlParts.push(`<li>${await this.inlineFormat(content)}</li>`);
        continue;
      }

      closeList();

      if (line.startsWith('# ')) {
        htmlParts.push(`<h1>${await this.inlineFormat(line.slice(2))}</h1>`);
      } else if (line.startsWith('## ')) {
        htmlParts.push(`<h2>${await this.inlineFormat(line.slice(3))}</h2>`);
      } else if (line.startsWith('### ')) {
        htmlParts.push(`<h3>${await this.inlineFormat(line.slice(4))}</h3>`);
      } else if (line.startsWith('> ')) {
        htmlParts.push(`<blockquote><p>${await this.inlineFormat(line.slice(2))}</p></blockquote>`);
      } else if (line.trim() === '') {
        htmlParts.push('<br>');
      } else {
        htmlParts.push(`<p>${await this.inlineFormat(line)}</p>`);
      }
    }

    closeList();
    closeTable();
    if (inCodeBlock) htmlParts.push('</code></pre>');

    return htmlParts.join('\n');
  }

  private async inlineFormat(text: string): Promise<string> {
    // First handle images: ![alt](path) → <img src="...">
    text = await this.replaceImages(text);
    // Then handle links: [text](url) → <a href="...">text</a> (but not images)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Bold and italic
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    text = text.replace(/`(.+?)`/g, '<code>$1</code>');
    return text;
  }

  private async replaceImages(text: string): Promise<string> {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches: Array<{ full: string; alt: string; src: string }> = [];
    let match;
    while ((match = imageRegex.exec(text)) !== null) {
      matches.push({ full: match[0], alt: match[1], src: match[2] });
    }

    for (const { full, alt, src } of matches) {
      let imgSrc = src;
      if (isLocalPath(src)) {
        const dataUrl = await loadLocalResourceAsDataUrl(src);
        if (dataUrl) {
          imgSrc = dataUrl;
        } else {
          // Failed to load, keep original path
          imgSrc = src;
        }
      }
      const imgTag = `<img src="${imgSrc}" alt="${alt}" style="max-width:100%;height:auto;">`;
      text = text.replace(full, imgTag);
    }

    return text;
  }

  private async execShareonePublish(cliPath: string, absFile: string): Promise<{ url: string }> {
    let proxyToken: string | undefined;
    try {
      const args = ['publish', absFile, '--json'];

      const authProxyPort = getAuthProxyPort();
      if (authProxyPort) {
        proxyToken = crypto.randomUUID();
        registerToken(proxyToken, process.pid);
        args.push('--auth-mode', 'proxy', '--proxy-url', `http://127.0.0.1:${authProxyPort}/proxy`, '--proxy-token', proxyToken);
      }

      mainLog('ShareOne', `Running: ${cliPath} ${args.join(' ')}`);
      let stdout: string;
      let stderr: string;
      try {
        const result = await execFileAsync(cliPath, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (execErr: unknown) {
        // execFileAsync throws error with stdout/stderr when command fails
        const err = execErr as Error & { stdout?: string; stderr?: string };
        mainError('ShareOne', `CLI exec failed: ${err.message}`);
        mainError('ShareOne', `CLI stdout: ${(err.stdout || '').slice(0, 500)}`);
        mainError('ShareOne', `CLI stderr: ${(err.stderr || '').slice(0, 500)}`);

        // Try to parse JSON from stdout - CLI outputs JSON even on error
        const output = err.stdout || '';
        const jsonMatch = output.match(/\{[\s\S]*"ok"\s*:\s*false[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsedResult = JSON.parse(jsonMatch[0]);
            if (parsedResult.message) {
              const apiError = Object.assign(new Error(parsedResult.message), { code: parsedResult.code || 'UNKNOWN_ERROR' });
              mainError('ShareOne', `Extracted API error: ${parsedResult.message} (code=${parsedResult.code})`);
              throw apiError;
            }
          } catch (parseErr) {
            // If it's our API error, re-throw it
            if (parseErr instanceof Error && 'code' in parseErr) {
              throw parseErr;
            }
            // JSON parse failed, fall through
          }
        }
        throw new Error(err.message);
      }

      if (stderr) {
        mainLog('ShareOne', `CLI stderr: ${stderr.slice(0, 500)}`);
      }

      const result = JSON.parse(stdout.trim());
      if (result.ok) {
        return { url: result.share_url };
      }

      const errorCode = result.code || 'UNKNOWN_ERROR';
      mainError('ShareOne', `CLI error: ${result.message} (code=${errorCode})`);
      throw Object.assign(new Error(result.message || 'ShareOne CLI error'), { code: errorCode });
    } catch (err: unknown) {
      // If error already has code (from our throw above), re-throw it
      if (err instanceof Error && 'code' in err && (err as Record<string, unknown>).code) {
        throw err;
      }

      mainError('ShareOne', `execShareonePublish unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      if (proxyToken) {
        revokeToken(proxyToken);
      }
    }
  }
}

export const shareoneCliService = new ShareoneCliService();