/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import https from 'node:https';
import http from 'node:http';
import { app } from 'electron';
import JSZip from 'jszip';
import { getSkillsDir } from '@/process/initStorage';
import WorkerManage from '@process/WorkerManage';
import { gatewayRegistry } from '@/agent/openclaw/OpenClawGatewayManager';
import { SUDOCLAW_DEFAULT_PORT } from '@process/services/sudoclaw/SudoclawInstallService';

const SKILL_HUB_BASE_URL = 'https://sudoclawhub.sudoprivacy.com/api/skills';
const SKILL_HUB_CURSOR_URL = 'https://sudoclawhub.sudoprivacy.com/api/skills/cursor';
const AUTHORIZATION = 'sud0@sudo';
const VERSION_FILE_NAME = 'sudowork-version';

/**
 * Get user skills directory path (same as AcpSkillManager)
 */
function getUserSkillsDir(): string {
  return getSkillsDir();
}

/**
 * Download file from URL with progress callback
 */
async function downloadFile(url: string, onProgress?: (percent: number) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': 'Sudowork-SkillHub/1.0',
        },
      },
      (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            downloadFile(redirectUrl, onProgress).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          downloadedSize += chunk.length;
          if (totalSize > 0 && onProgress) {
            onProgress(Math.round((downloadedSize / totalSize) * 100));
          }
        });

        response.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        response.on('error', reject);
      }
    );

    request.setTimeout(60000, () => {
      request.destroy(new Error('Download timeout'));
    });

    request.on('error', reject);
  });
}

/**
 * Verify checksum (SHA256)
 */
async function verifyChecksum(buffer: Buffer, expectedChecksum: string): Promise<boolean> {
  const crypto = await import('crypto');
  const actualChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
  return actualChecksum === expectedChecksum;
}

/**
 * Initialize IPC bridge for Skill Hub API.
 * Fetches skills, categories, and skill details from the external Skill Hub service.
 */
export function initSkillHubBridge(): void {
  console.log('[SkillHub] Initializing SkillHub bridge...');

  // Fetch skills list from Skill Hub API with cursor-based pagination
  ipcBridge.skillHub.fetchSkills.provider(async ({ cursor, limit = 20, query = '', category = '' }) => {
    try {
      console.log('[SkillHub] Fetching skills with params:', { cursor, limit, query, category });
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (limit) params.set('limit', String(limit));
      if (query) params.set('query', query);
      if (category) params.set('category', category);
      const response = await fetch(`${SKILL_HUB_CURSOR_URL}?${params}`, {
        headers: { Authorization: AUTHORIZATION },
      });
      const result = await response.json();
      console.log('[SkillHub] Skills response:', result);
      // API returns { success, message, data: { skills, next_cursor, has_more } }
      return { success: true, data: result.data };
    } catch (error) {
      console.error('[SkillHub] Failed to fetch skills:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch skill categories from Skill Hub API
  ipcBridge.skillHub.fetchCategories.provider(async () => {
    try {
      console.log('[SkillHub] Fetching categories');
      const response = await fetch(`${SKILL_HUB_BASE_URL}/categories`, {
        headers: { Authorization: AUTHORIZATION },
      });
      const data = await response.json();
      console.log('[SkillHub] Categories response:', data);
      return { success: true, data: data.data || [] };
    } catch (error) {
      console.error('[SkillHub] Failed to fetch categories:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch skill detail from Skill Hub API
  ipcBridge.skillHub.fetchSkillDetail.provider(async ({ skillId }) => {
    try {
      console.log('[SkillHub] Fetching skill detail:', skillId);
      const response = await fetch(`${SKILL_HUB_BASE_URL}/${skillId}`, {
        headers: { Authorization: AUTHORIZATION },
      });
      const data = await response.json();
      console.log('[SkillHub] Skill detail response:', data);
      return { success: true, data: data.data };
    } catch (error) {
      console.error('[SkillHub] Failed to fetch skill detail:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Download and install skill
  ipcBridge.skillHub.downloadAndInstallSkill.provider(async ({ skillName, displayName, sourceUrl, version, checksum }) => {
    try {
      console.log('[SkillHub] Downloading skill:', skillName, 'version:', version);

      // Download zip file
      const zipBuffer = await downloadFile(sourceUrl, (percent) => {
        console.log(`[SkillHub] Download progress: ${percent}%`);
      });

      // Verify checksum if provided
      if (checksum) {
        const isValid = await verifyChecksum(zipBuffer, checksum);
        if (!isValid) {
          console.warn('[SkillHub] Checksum verification failed, but continuing anyway');
        }
      }

      // Get user skills directory
      const userSkillsDir = getUserSkillsDir();
      await fs.mkdir(userSkillsDir, { recursive: true });

      // Create skill directory (use skillName which should be a valid directory name)
      const skillDir = path.join(userSkillsDir, skillName);

      // Check if skill already exists
      try {
        await fs.access(skillDir);
        // If exists, remove old version first
        await fs.rm(skillDir, { recursive: true, force: true });
      } catch {
        // Directory doesn't exist, which is fine
      }

      // Create skill directory
      await fs.mkdir(skillDir, { recursive: true });

      // Extract zip
      const zip = await JSZip.loadAsync(zipBuffer);
      let rootFolder = '';

      // Check if zip has a single root folder
      const entries = Object.keys(zip.files);
      const firstEntry = entries[0];
      if (firstEntry && firstEntry.endsWith('/')) {
        rootFolder = firstEntry;
      }

      // Extract files
      for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;

        // Remove root folder prefix if present
        let targetPath = relativePath;
        if (rootFolder && relativePath.startsWith(rootFolder)) {
          targetPath = relativePath.slice(rootFolder.length);
        }

        if (!targetPath) continue;

        const fullPath = path.join(skillDir, targetPath);
        const fullDir = path.dirname(fullPath);

        // Ensure directory exists
        await fs.mkdir(fullDir, { recursive: true });

        // Write file
        const content = await zipEntry.async('nodebuffer');
        await fs.writeFile(fullPath, content);
      }

      // Write version file
      const versionFilePath = path.join(skillDir, VERSION_FILE_NAME);
      await fs.writeFile(versionFilePath, version, 'utf-8');

      console.log(`[SkillHub] Successfully installed skill "${skillName}" v${version} to ${skillDir}`);

      // Hot-reload Sudoclaw gateway using SIGUSR1 signal (no full restart needed).
      // This is more stable and faster than restart, as gateway keeps sessions alive.
      // Fallback to restart if signal fails or gateway doesn't support it.
      void (async () => {
        try {
          const gateway = gatewayRegistry.get(SUDOCLAW_DEFAULT_PORT);

          if (gateway) {
            gateway.sendReloadSignal();
            console.log('[SkillHub] Sent SIGUSR1 to gateway for hot-reload');
            // Wait a bit for gateway to reload, then reconnect agent connections
            await new Promise((resolve) => setTimeout(resolve, 2000));
            WorkerManage.reloadOpenClawSkills();
          } else {
            console.log('[SkillHub] Gateway not running, skipping hot-reload');
          }
        } catch (err) {
          console.warn('[SkillHub] SIGUSR1 failed, falling back to restart:', err);
          // Fallback: full restart
          await WorkerManage.restartOpenClawGateways();
        }
      })();

      return {
        success: true,
        data: {
          skillName,
          installedVersion: version,
        },
      };
    } catch (error) {
      console.error('[SkillHub] Failed to install skill:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Get installed skills with versions
  ipcBridge.skillHub.getInstalledSkills.provider(async () => {
    try {
      const userSkillsDir = getUserSkillsDir();
      const skills: Array<{ name: string; version: string }> = [];

      try {
        await fs.access(userSkillsDir);
      } catch {
        // Directory doesn't exist
        return { success: true, data: [] };
      }

      const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '_builtin') continue;

        const skillDir = path.join(userSkillsDir, entry.name);
        const versionFilePath = path.join(skillDir, VERSION_FILE_NAME);

        let version = 'unknown';
        try {
          version = await fs.readFile(versionFilePath, 'utf-8');
          version = version.trim();
        } catch {
          // Version file doesn't exist, try to read from SKILL.md
          try {
            const skillMdPath = path.join(skillDir, 'SKILL.md');
            const content = await fs.readFile(skillMdPath, 'utf-8');
            const versionMatch = content.match(/^version:\s*(.+)$/m);
            if (versionMatch) {
              version = versionMatch[1].trim();
            }
          } catch {
            // SKILL.md doesn't exist either
          }
        }

        skills.push({ name: entry.name, version });
      }

      return { success: true, data: skills };
    } catch (error) {
      console.error('[SkillHub] Failed to get installed skills:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
