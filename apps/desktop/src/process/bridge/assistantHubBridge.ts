/**
 * IPC bridge for Assistant Hub — mirrors skillHubBridge pattern.
 * Hub API calls for fetching assistants, categories, and installing from Hub.
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import https from 'node:https';
import http from 'node:http';
import JSZip from 'jszip';
import type { IAssistantHubSkill, IAssistantHubDetail, ISkillHubSkill, IAssistantHubVersionLike } from '@sudowork/host-bridge/ipcBridge';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { ipcBridge } from '@/common';
import { assistantManager, type IAssistantInfo } from '@/process/AssistantManager';
import { getHubAssistantsDir, getSystemAssistantsDir, getCustomAssistantsDir, getSudoworkServerBaseUrlSync } from '@/process/initStorage';
import { skillManager } from '@/process/SkillManager';
import { getDatabase } from '@/process/database';
import { DEFAULT_PRESET_AGENT_TYPE, normalizePresetAgentType } from '@/types/acpTypes';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { ASSISTANTS_ROOT_DIR, ENTERPRISE_ASSISTANT_SUBDIRS } from '@/process/constants/enterpriseStorage';
import { getSkillHubBaseUrl } from '@/common/systemConfig';
import { getSkillhubToken } from '@/process/credentialsCache';
import { tokenMissingResponse } from '@common/nexus/hubErrors';
import { reapConversation } from '@/process/services/conversationReaper';

const { existsSync } = fsSync;

const ASSISTANT_META_FILE = '_sudowork_meta.json';
const MOSS_ASSISTANT_META_FILE = '_moss_meta.json';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AssistantHubMeta = import('@/process/constants/assistantStorage').IAssistantMeta;
type AssistantHubPublishStatus = 'pending' | 'approved' | 'rejected';
type AssistantHubRemoteStatus = AssistantHubPublishStatus | 'deleted';
type AssistantPromptsI18n = Record<string, string[]>;

interface AssistantHubUploadApiBody {
  status?: string;
  message?: string;
  msg?: string;
  id?: string;
  data?: {
    id?: string;
    assistant?: {
      id?: string;
      name?: string;
      status?: number | string;
    };
    agent?: {
      id?: string;
      name?: string;
      status?: number | string;
    };
  };
}

/**
 * Read assistant metadata file, trying both Moss and Sudowork meta file names
 * Enterprise mode: _moss_meta.json (primary), _sudowork_meta.json (fallback)
 * Personal mode: _sudowork_meta.json (primary), _moss_meta.json (fallback)
 */
async function readAssistantMetaFileWithFallback(assistantDir: string): Promise<{ content: string; fileName: string } | null> {
  const isEnterprise = isEnterpriseMode();
  const metaFiles = isEnterprise ? [MOSS_ASSISTANT_META_FILE, ASSISTANT_META_FILE] : [ASSISTANT_META_FILE, MOSS_ASSISTANT_META_FILE];

  for (const fileName of metaFiles) {
    const filePath = path.join(assistantDir, fileName);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { content, fileName };
    } catch {
      // Try next file
    }
  }
  return null;
}

/**
 * Write assistant metadata file, using correct file name based on current mode
 */
async function writeAssistantMetaFile(assistantDir: string, meta: AssistantHubMeta): Promise<void> {
  const isEnterprise = isEnterpriseMode();
  const fileName = isEnterprise ? MOSS_ASSISTANT_META_FILE : ASSISTANT_META_FILE;
  const filePath = path.join(assistantDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(meta, null, 2), 'utf-8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringList(values: string[] | undefined): string[] {
  const normalized = (values || []).map((value) => value.trim()).filter(Boolean);
  return Array.from(new Set(normalized));
}

function addAssistantUploadSkillAlias(aliasMap: Map<string, string | null>, alias: string | undefined, skillId: string): void {
  const normalizedAlias = alias?.trim();
  if (!normalizedAlias) return;

  const existing = aliasMap.get(normalizedAlias);
  if (existing && existing !== skillId) {
    aliasMap.set(normalizedAlias, null);
    return;
  }

  if (existing === undefined) {
    aliasMap.set(normalizedAlias, skillId);
  }

  const lowerAlias = normalizedAlias.toLowerCase();
  const lowerExisting = aliasMap.get(lowerAlias);
  if (lowerExisting && lowerExisting !== skillId) {
    aliasMap.set(lowerAlias, null);
    return;
  }

  if (lowerExisting === undefined) {
    aliasMap.set(lowerAlias, skillId);
  }
}

function resolveAssistantUploadSkillRefs(skillRefs: string[] | undefined, assistantMeta: AssistantHubMeta | null): string[] {
  if (skillRefs && skillRefs.length > 0) {
    return normalizeStringList(skillRefs);
  }
  if (assistantMeta?.enabledSkills && assistantMeta.enabledSkills.length > 0) {
    return normalizeStringList(assistantMeta.enabledSkills);
  }
  if (assistantMeta?.skills && assistantMeta.skills.length > 0) {
    return normalizeStringList(assistantMeta.skills);
  }
  return normalizeStringList(assistantMeta?.defaultEnabledSkills);
}

async function resolveAssistantUploadSkillIds(skillRefs: string[] | undefined, assistantMeta: AssistantHubMeta | null): Promise<string[]> {
  const uploadSkillRefs = resolveAssistantUploadSkillRefs(skillRefs, assistantMeta);
  if (uploadSkillRefs.length === 0) {
    return [];
  }

  const skillIdByAlias = new Map<string, string | null>();
  const installedSkills = await skillManager.getInstalledSkills();
  for (const skill of installedSkills) {
    const meta = skill.meta;
    const skillId = meta?.id?.trim();
    const canReferenceInHub = Boolean(skillId && (skill.isHubInstalled || meta?.source_type === 'hub' || meta?.uploaded === true || meta?.source_type === 'tenant'));
    if (!skillId || !canReferenceInHub) continue;

    addAssistantUploadSkillAlias(skillIdByAlias, skill.name, skillId);
    addAssistantUploadSkillAlias(skillIdByAlias, meta?.name, skillId);
    addAssistantUploadSkillAlias(skillIdByAlias, meta?.display_name, skillId);
    addAssistantUploadSkillAlias(skillIdByAlias, skillId, skillId);
  }

  const resolvedSkillIds: string[] = [];
  const skippedSkillRefs: string[] = [];
  for (const skillRef of uploadSkillRefs) {
    const matchedSkillId = skillIdByAlias.get(skillRef) ?? skillIdByAlias.get(skillRef.toLowerCase());
    const resolvedSkillId = matchedSkillId || (UUID_PATTERN.test(skillRef) ? skillRef : null);
    if (!resolvedSkillId || !UUID_PATTERN.test(resolvedSkillId)) {
      skippedSkillRefs.push(skillRef);
      continue;
    }
    if (!resolvedSkillIds.includes(resolvedSkillId)) {
      resolvedSkillIds.push(resolvedSkillId);
    }
  }

  if (skippedSkillRefs.length > 0) {
    mainWarn('AssistantHub', `Skip ${skippedSkillRefs.length} local-only skill reference(s) when uploading assistant: ${skippedSkillRefs.join(', ')}`);
  }

  return resolvedSkillIds;
}

async function parseAssistantHubUploadResponse(response: Response): Promise<AssistantHubUploadApiBody | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as AssistantHubUploadApiBody;
  } catch {
    return { message: text };
  }
}

function normalizeAssistantHubPublishStatus(status: unknown): AssistantHubPublishStatus | null {
  if (typeof status === 'number') {
    if (status === 1) return 'approved';
    if (status === 2) return 'rejected';
    if (status === 0) return 'pending';
    return null;
  }

  if (typeof status !== 'string') {
    return null;
  }

  const normalized = status.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['1', 'approved', 'approve', 'published', 'online', 'active'].includes(normalized)) {
    return 'approved';
  }

  if (['2', 'rejected', 'reject'].includes(normalized)) {
    return 'rejected';
  }

  if (['0', 'pending', 'reviewing', 'submitted', 'inactive'].includes(normalized)) {
    return 'pending';
  }

  return null;
}

function isHubDeletedMessage(...messages: unknown[]): boolean {
  return messages.some((message) => {
    if (typeof message !== 'string') return false;
    const normalized = message.trim().toLowerCase();
    return normalized.includes('not found') || normalized.includes('deleted') || normalized.includes('不存在') || normalized.includes('已删除');
  });
}

async function readHubResponseJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveAssistantHubUploadId(body: AssistantHubUploadApiBody | null, fallbackId: string): string {
  return body?.data?.assistant?.id || body?.data?.agent?.id || body?.data?.id || body?.id || fallbackId;
}

function resolveAssistantHubUploadStatus(body: AssistantHubUploadApiBody | null): AssistantHubPublishStatus {
  return normalizeAssistantHubPublishStatus(body?.data?.assistant?.status ?? body?.data?.agent?.status ?? body?.status) || 'pending';
}

function resolveAssistantHubDetailPublishStatus(body: unknown): AssistantHubPublishStatus | null {
  if (!isRecord(body)) {
    return null;
  }

  const data = isRecord(body.data) ? body.data : body;
  const assistant = isRecord(data.assistant) ? data.assistant : isRecord(data.agent) ? data.agent : data;

  return normalizeAssistantHubPublishStatus(assistant.status ?? data.status ?? body.status);
}

function isAssistantHubDeletedDetailBody(body: unknown): boolean {
  if (!isRecord(body)) {
    return false;
  }

  if (body.data === null) {
    if (body.success === false) {
      return isHubDeletedMessage(body.message, body.msg);
    }
    return true;
  }

  const data = isRecord(body.data) ? body.data : null;
  if (data && (('assistant' in data && data.assistant === null) || ('agent' in data && data.agent === null))) {
    if (body.success === false) {
      return isHubDeletedMessage(body.message, body.msg, data.message, data.msg);
    }
    return true;
  }

  const error = isRecord(body.error) ? body.error : null;
  return isHubDeletedMessage(body.message, body.msg, body.detail, data?.message, data?.msg, error?.message, error?.msg, error?.detail);
}

function isHubDeletedResponseStatus(status: number, body?: unknown): boolean {
  return status === 404 || status === 410 || (status === 400 && isAssistantHubDeletedDetailBody(body));
}

function resolveAssistantHubDetailRemoteStatus(body: unknown): AssistantHubRemoteStatus | null {
  if (isAssistantHubDeletedDetailBody(body)) {
    return 'deleted';
  }

  return resolveAssistantHubDetailPublishStatus(body);
}

async function fetchUploadedAssistantPublishStatus(assistantId: string, token: string): Promise<AssistantHubRemoteStatus | null> {
  const response = await fetch(`${getSkillHubBaseUrl()}/api/assistants/${encodeURIComponent(assistantId)}`, {
    headers: { Authorization: token },
  });

  if (!response.ok) {
    const body = await readHubResponseJson(response);
    if (isHubDeletedResponseStatus(response.status, body)) {
      mainLog('AssistantHub', `Uploaded assistant ${assistantId} no longer exists on Assistant Hub: HTTP ${response.status}`);
      return 'deleted';
    }
    mainLog('AssistantHub', `Skip uploaded assistant status refresh for ${assistantId}: HTTP ${response.status}`);
    return null;
  }

  const body = await response.json();
  return resolveAssistantHubDetailRemoteStatus(body);
}

function isUploadedCustomAssistantStatusRefreshCandidate(assistant: IAssistantInfo): boolean {
  const meta = assistant.meta;
  if (assistant.category !== 'custom' || !meta?.id || meta.source_type !== 'custom') {
    return false;
  }

  const uploadPublishStatus = meta.publish_status || (meta.uploaded ? 'pending' : undefined);
  return uploadPublishStatus === 'pending' || uploadPublishStatus === 'approved';
}

function clearAssistantHubUploadStatus(meta: AssistantHubMeta): AssistantHubMeta {
  const nextMeta: AssistantHubMeta = { ...meta };
  delete nextMeta.uploaded;
  delete nextMeta.uploaded_at;
  delete nextMeta.publish_status;
  delete nextMeta.published_at;
  return nextMeta;
}

async function refreshUploadedAssistantStatusesFromHub(token: string): Promise<{ checked: number; updated: number }> {
  const assistants = await assistantManager.getInstalledAssistants();
  const candidates = assistants.filter(isUploadedCustomAssistantStatusRefreshCandidate);
  let updated = 0;

  for (const assistant of candidates) {
    try {
      const assistantId = assistant.meta?.id;
      if (!assistantId) continue;

      const remoteStatus = await fetchUploadedAssistantPublishStatus(assistantId, token);
      if (!remoteStatus) continue;

      const assistantDir = assistantManager.findAssistantDirByCategory(assistant.name, 'custom')?.dir;
      if (!assistantDir) continue;

      const metaResult = await readAssistantMetaFileWithFallback(assistantDir);
      if (!metaResult) continue;

      const currentMeta = JSON.parse(metaResult.content) as AssistantHubMeta;
      const currentStatus = currentMeta.publish_status || (currentMeta.uploaded ? 'pending' : undefined);
      if (remoteStatus === 'deleted') {
        const nextMeta = clearAssistantHubUploadStatus(currentMeta);
        await writeAssistantMetaFile(assistantDir, nextMeta);
        updated += 1;
        mainLog('AssistantHub', `Cleared uploaded assistant "${assistant.name}" publish status because the remote record no longer exists`);
        continue;
      }

      if (currentStatus === remoteStatus) continue;

      const nextMeta: AssistantHubMeta = {
        ...currentMeta,
        publish_status: remoteStatus,
      };
      if (remoteStatus === 'approved') {
        nextMeta.published_at = currentMeta.published_at || new Date().toISOString();
      }

      await writeAssistantMetaFile(assistantDir, nextMeta);
      updated += 1;
      mainLog('AssistantHub', `Updated uploaded assistant "${assistant.name}" publish status: ${currentStatus || 'unknown'} -> ${remoteStatus}`);
    } catch (error) {
      mainWarn('AssistantHub', `Failed to refresh uploaded assistant status for "${assistant.name}":`, error);
    }
  }

  return { checked: candidates.length, updated };
}

interface VisibleAssistantOverlay extends Record<string, unknown> {
  assistant_id?: string;
  id?: string;
  tenantId?: string | null;
  tenantIds?: string[];
  tenant_id?: string | null;
  tenant_ids?: string[];
}

interface VisibleAssistantsResponse {
  success?: boolean;
  data?: VisibleAssistantOverlay[];
  msg?: string;
}

function bearerHeader(token: string): string {
  const trimmed = token.trim();
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function firstStringArray(...values: unknown[]): string[] | undefined {
  for (const value of values) {
    const arrayValue = stringArray(value);
    if (arrayValue) return arrayValue;
  }
  return undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function hasRecordKey(value: unknown, key: string): value is Record<string, unknown> {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function tenantIdsWithFallback(tenantIdsValue: unknown, tenantIdsSnakeValue: unknown, tenantIdValue: unknown, tenantIdSnakeValue: unknown): string[] {
  const tenantIds = firstStringArray(tenantIdsValue, tenantIdsSnakeValue);
  if (tenantIds) return tenantIds;
  const tenantId = firstNonEmptyString(tenantIdValue, tenantIdSnakeValue);
  return tenantId ? [tenantId] : [];
}

function normalizePromptsI18n(value: unknown): AssistantPromptsI18n | undefined {
  if (!isRecord(value)) return undefined;

  const zhCN = normalizeStringList(stringArray(value['zh-CN']));
  if (zhCN.length === 0) return undefined;

  return { 'zh-CN': zhCN };
}

function firstPromptsI18n(...values: unknown[]): AssistantPromptsI18n | undefined {
  for (const value of values) {
    const normalized = normalizePromptsI18n(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizePackagePromptsI18n(value: unknown): AssistantPromptsI18n | undefined {
  if (!isRecord(value)) return undefined;
  return { 'zh-CN': normalizeStringList(stringArray(value['zh-CN'])) };
}

async function fetchVisibleAssistantOverlayMap(accessToken?: string): Promise<Map<string, VisibleAssistantOverlay> | null> {
  if (!accessToken?.trim()) return null;

  try {
    const response = await fetch(`${getSudoworkServerBaseUrlSync()}/api/v1/agents/visible`, {
      headers: { Authorization: bearerHeader(accessToken) },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as VisibleAssistantsResponse;
    if (!body.success || !Array.isArray(body.data)) return null;

    const map = new Map<string, VisibleAssistantOverlay>();
    for (const item of body.data) {
      const id = firstNonEmptyString(item.assistant_id, item.id);
      if (id) map.set(id, item);
    }
    return map;
  } catch (error) {
    mainWarn('AssistantHub', 'Failed to fetch visible assistant overlays:', error);
    return null;
  }
}

function applyVisibleAssistantOverlay(raw: Record<string, unknown>, overlay?: VisibleAssistantOverlay): Record<string, unknown> {
  if (!overlay) return raw;

  const merged: Record<string, unknown> = { ...raw };
  const displayName = firstNonEmptyString(overlay.display_name, overlay.profession, overlay.name);
  if (displayName) merged.display_name = displayName;

  const profession = firstString(overlay.profession, overlay.display_name, overlay.name);
  if (profession !== undefined) merged.profession = profession;

  const description = firstString(overlay.description);
  if (description !== undefined) merged.description = description;

  const tenantIds = tenantIdsWithFallback(overlay.tenantIds, overlay.tenant_ids, overlay.tenantId, overlay.tenant_id);
  const tenantId = firstString(overlay.tenantId, overlay.tenant_id) ?? tenantIds[0];
  if (tenantIds.length > 0) {
    merged.tenantIds = tenantIds;
    merged.tenant_ids = tenantIds;
  }
  if (tenantId !== undefined) {
    merged.tenantId = tenantId;
    merged.tenant_id = tenantId;
  }

  const avatar = firstString(overlay.avatar);
  if (avatar !== undefined) merged.avatar = avatar;

  const categories = stringArray(overlay.categories);
  if (categories) merged.categories = categories;

  const skills = stringArray(overlay.skills);
  if (skills) merged.skills = skills;

  const defaultInitPrompt = firstString(overlay.defaultInitPrompt, overlay.default_init_prompt);
  if (defaultInitPrompt !== undefined) {
    merged.defaultInitPrompt = defaultInitPrompt;
    merged.default_init_prompt = defaultInitPrompt;
  }

  const promptsI18n = firstPromptsI18n(overlay.promptsI18n, overlay.prompts_i18n);
  if (promptsI18n) {
    merged.promptsI18n = promptsI18n;
    merged.prompts_i18n = promptsI18n;
  }

  const updatedAt = firstString(overlay.updatedAt, overlay.updated_at);
  if (updatedAt !== undefined) {
    merged.updatedAt = updatedAt;
    merged.updated_at = updatedAt;
  }

  return merged;
}

function matchesAssistantCategory(assistant: IAssistantHubSkill, category: string): boolean {
  const normalizedCategory = category.trim();
  if (!normalizedCategory || normalizedCategory === 'all') return true;
  return assistant.categories.some((assistantCategory) => assistantCategory.trim() === normalizedCategory);
}

// ==================== Helper Functions ====================

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
          'User-Agent': 'Sudowork-AssistantHub/1.0',
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
 * Normalize zip entry path
 */
function normalizeZipEntryPath(entryPath: string): string {
  return path.posix.normalize(entryPath.replaceAll('\\', '/').replace(/^\.\/+/, ''));
}

/**
 * Check if zip entry path is unsafe
 */
function isUnsafeZipEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath === '.') return false;
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) return true;
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return true;
  const normalized = normalizeZipEntryPath(entryPath);
  return normalized === '..' || normalized.startsWith('../');
}

/**
 * Resolve zip layout (handle top-level directory wrapper)
 * If all files are under a single top-level directory, strip it
 */
function resolveZipAssistantLayout(zip: JSZip): { stripPrefix: string } {
  const fileEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => normalizeZipEntryPath(entry.name))
    // Skip macOS system files
    .filter((entryPath) => !entryPath.includes('__MACOSX') && !entryPath.endsWith('.DS_Store'))
    .filter(Boolean);

  for (const entryPath of fileEntries) {
    if (isUnsafeZipEntryPath(entryPath)) {
      throw new Error(`Unsafe zip entry path: ${entryPath}`);
    }
  }

  // Check if all files are under a single top-level directory
  const topLevelParts = fileEntries.map((entryPath) => entryPath.split('/')[0]);
  const uniqueTopLevel = Array.from(new Set(topLevelParts));

  // If there's a single top-level directory and all files have path separator, strip it
  if (uniqueTopLevel.length === 1 && fileEntries.every((e) => e.includes('/'))) {
    return { stripPrefix: `${uniqueTopLevel[0]}/` };
  }

  // No wrapper directory or multiple directories - extract directly
  return { stripPrefix: '' };
}

/**
 * Extract assistant zip to directory
 */
async function extractAssistantZipToDirectory(zipBuffer: Buffer, assistantDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const { stripPrefix } = resolveZipAssistantLayout(zip);

  await fs.mkdir(assistantDir, { recursive: true });

  for (const zipEntry of Object.values(zip.files)) {
    if (zipEntry.dir) continue;
    if (isUnsafeZipEntryPath(zipEntry.name)) {
      throw new Error(`Unsafe zip entry path: ${zipEntry.name}`);
    }

    const normalizedPath = normalizeZipEntryPath(zipEntry.name);
    // Skip macOS system files
    if (normalizedPath.includes('__MACOSX') || normalizedPath.endsWith('.DS_Store')) continue;

    let targetPath = normalizedPath;

    if (stripPrefix) {
      if (!normalizedPath.startsWith(stripPrefix)) continue;
      targetPath = normalizedPath.slice(stripPrefix.length);
    }

    if (!targetPath) continue;

    const fullPath = path.join(assistantDir, targetPath);
    const fullDir = path.dirname(fullPath);
    await fs.mkdir(fullDir, { recursive: true });

    const content = await zipEntry.async('nodebuffer');
    await fs.writeFile(fullPath, content);
  }
}

/**
 * Scan directory for .md files and select the best one as ruleFile
 * Priority: {assistantName}.md > any .md file
 */
async function selectRuleFileFromDirectory(assistantDir: string, assistantName: string): Promise<string | undefined> {
  try {
    const files = await fs.readdir(assistantDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    if (mdFiles.length === 0) return undefined;

    // Priority 1: {assistantName}.md
    const primaryRuleFile = mdFiles.find((f) => f === `${assistantName}.md`);
    if (primaryRuleFile) return primaryRuleFile;

    // Priority 2: Any .md file (first one)
    return mdFiles[0];
  } catch {
    return undefined;
  }
}

// ==================== Bridge Initialization ====================

export function initAssistantHubBridge(): void {
  // === Local CRUD operations ===

  ipcBridge.assistantHub.getInstalledAssistants.provider(async () => {
    try {
      const assistants = await assistantManager.getInstalledAssistants();
      return { success: true, data: assistants };
    } catch (error) {
      mainError('AssistantHub', 'Failed to get installed assistants:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.assistantHub.refreshUploadedAssistantStatuses.provider(async () => {
    if (isEnterpriseMode()) {
      return { success: true, data: { checked: 0, updated: 0 } };
    }

    try {
      const token = getSkillhubToken();
      if (!token) {
        mainError('AssistantHub', 'skillhub token not provisioned, skip refreshUploadedAssistantStatuses');
        return tokenMissingResponse('assistantHub');
      }

      const result = await refreshUploadedAssistantStatusesFromHub(token);
      return { success: true, data: result };
    } catch (error) {
      mainError('AssistantHub', 'Failed to refresh uploaded assistant statuses:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.assistantHub.getInstalledAssistantsWithVisibility.provider(async ({ accessToken }) => {
    try {
      const assistants = await assistantManager.getInstalledAssistantsWithVisibility(accessToken || '');
      return { success: true, data: assistants };
    } catch (error) {
      mainError('AssistantHub', 'Failed to get installed assistants with visibility:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.assistantHub.enableAssistant.provider(async ({ name, category }) => {
    const result = await assistantManager.enableAssistant(name, category);
    return result.success ? { success: true, data: undefined } : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.disableAssistant.provider(async ({ name, category }) => {
    const result = await assistantManager.disableAssistant(name, category);
    return result.success ? { success: true, data: undefined } : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.updateAssistantMeta.provider(async ({ name, updates, category }) => {
    const result = await assistantManager.updateAssistantMeta(name, updates, category);
    return result.success ? { success: true, data: undefined } : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.getAssistantMeta.provider(async ({ name }) => {
    try {
      const meta = await assistantManager.getAssistantMeta(name);
      return { success: true, data: meta };
    } catch (error) {
      mainError('AssistantHub', 'Failed to get assistant meta:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.assistantHub.createAssistant.provider(async ({ meta, ruleContent }) => {
    const result = await assistantManager.createAssistant(meta, ruleContent);
    return result.success ? { success: true, data: undefined } : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.uninstallAssistant.provider(async ({ name, category }) => {
    // Reap associated conversations before uninstalling assistant. This must go
    // through the reaper SSOT (not a raw DB delete) so live agent processes,
    // terminals, cron, channel sessions, Moss sessions and workspace dirs are
    // released — the old raw delete leaked all of them.
    const deletedConversationIds: string[] = [];
    try {
      const db = getDatabase();
      // The presetAssistantId stored in conversation.extra matches the assistant's name/id.
      // Match both the original name and the 'builtin-' prefix-stripped id.
      const presetAssistantId = name.startsWith('builtin-') ? name.slice('builtin-'.length) : name;
      const idsToReap = new Set<string>();
      const collect = (key: string) => {
        const found = db.findConversationIdsByPresetAssistantId(key);
        if (!found.success) {
          mainWarn('AssistantHub', `Failed to find associated conversations for ${key}: ${found.error}`);
          return;
        }
        found.data?.conversationIds.forEach((cid) => idsToReap.add(cid));
      };
      collect(name);
      if (presetAssistantId !== name) {
        collect(presetAssistantId);
      }

      for (const cid of idsToReap) {
        const res = await reapConversation(cid, { reason: 'assistant-uninstall' });
        if (res.dbDeleted) {
          deletedConversationIds.push(cid);
        }
      }
      if (deletedConversationIds.length > 0) {
        mainLog('AssistantHub', `Reaped ${deletedConversationIds.length} conversations associated with assistant ${name}`);
      }
    } catch (dbError) {
      mainWarn('AssistantHub', 'Error reaping associated conversations:', dbError);
    }

    const result = await assistantManager.uninstallAssistant(name, category);

    // Emit conversationChanged events to notify renderer to refresh conversation list
    if (deletedConversationIds.length > 0) {
      for (const conversationId of deletedConversationIds) {
        ipcBridge.database.conversationChanged.emit({
          conversationId,
          source: 'sudowork',
          action: 'deleted',
        });
      }
    }

    return result.success ? { success: true, data: undefined } : { success: false, msg: result.msg };
  });

  // === Hub API operations ===

  // Fetch assistants list from Hub API with cursor-based pagination
  ipcBridge.assistantHub.fetchAssistants.provider(async ({ cursor, limit = 20, query = '', category = '', tenantId, sourceType, accessToken }) => {
    try {
      mainLog('AssistantHub', `fetchAssistants called with tenantId: ${tenantId}, sourceType: ${sourceType}, isEnterpriseMode: ${isEnterpriseMode()}`);

      // 企业模式：从本地 hub/ 或 tenant/ 目录加载已同步的助手
      if (isEnterpriseMode()) {
        // 企业模式下，根据 sourceType 决定从哪个目录加载
        // sourceType='tenant' 表示专属助手，从 tenant/ 目录加载
        // 其他情况从 hub/ 目录加载
        const dirType = sourceType === 'tenant' ? 'tenant' : 'hub';
        const assistantsDir = path.join(ASSISTANTS_ROOT_DIR, ENTERPRISE_ASSISTANT_SUBDIRS[dirType]);

        mainLog('AssistantHub', `Enterprise mode: dirType=${dirType}, loading assistants from ${assistantsDir}`);

        // 读取本地目录中的助手
        const assistants: IAssistantHubSkill[] = [];

        mainLog('AssistantHub', `Directory exists: ${existsSync(assistantsDir)}`);

        if (existsSync(assistantsDir)) {
          const entries = await fs.readdir(assistantsDir, { withFileTypes: true });
          mainLog('AssistantHub', `Found ${entries.length} entries in ${assistantsDir}`);

          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            // Skip directories starting with _ (like _disable)
            if (entry.name.startsWith('_')) continue;

            const assistantName = entry.name;
            const assistantDir = path.join(assistantsDir, assistantName);

            // Read metadata first for search filtering
            const metaResult = await readAssistantMetaFileWithFallback(assistantDir);
            if (metaResult) {
              const meta = JSON.parse(metaResult.content) as AssistantHubMeta;

              const displayName = meta.nameI18n?.['en-US'] || meta.nameI18n?.['zh-CN'] || meta.display_name || meta.name || assistantName;
              const description = meta.descriptionI18n?.['en-US'] || meta.descriptionI18n?.['zh-CN'] || '';

              // Search filter: search by name, display_name, and description
              if (query) {
                const queryLower = query.toLowerCase();
                const nameMatch = assistantName.toLowerCase().includes(queryLower);
                const displayNameMatch = displayName.toLowerCase().includes(queryLower);
                const descriptionMatch = description.toLowerCase().includes(queryLower);
                if (!nameMatch && !displayNameMatch && !descriptionMatch) continue;
              }

              // Category filter
              if (category && category !== 'all') {
                const assistantCategories = meta.categories || [];
                if (!assistantCategories.includes(category)) continue;
              }

              const promptsI18n = normalizePromptsI18n(meta.promptsI18n);

              assistants.push({
                id: meta.id || assistantName,
                name: assistantName,
                display_name: displayName,
                description: description,
                avatar: meta.avatar || null,
                emoji: meta.emoji || null,
                categories: meta.categories || [],
                category: (meta.categories || [])[0] || '',
                preset_agent_type: meta.presetAgentType || null,
                skills: meta.enabledSkills || meta.defaultEnabledSkills || [],
                tag: 'hub' as const,
                homepage: meta.homepage || null,
                author_id: meta.author_id || '',
                star_count: 0,
                applicable_scenarios: meta.applicable_scenarios || null,
                core_features: meta.core_features || null,
                created_at: meta.installed_at || new Date().toISOString(),
                updated_at: meta.installed_at || new Date().toISOString(),
                defaultInitPrompt: meta.defaultInitPrompt || null,
                promptsI18n,
                prompts_i18n: promptsI18n,
                tenantId: meta.tenantId ?? null,
                tenantIds: tenantIdsWithFallback(meta.tenantIds, undefined, meta.tenantId, undefined),
                tenant_id: meta.tenantId ?? null,
                tenant_ids: tenantIdsWithFallback(meta.tenantIds, undefined, meta.tenantId, undefined),
                visible_to: meta.visible_to || null,
                version: meta.installed_version || '1.0.0',
              });
            }
          }
        }

        // 企业模式不支持分页，返回所有结果
        return {
          success: true,
          data: {
            assistants,
            next_cursor: null,
            has_more: false,
          },
        };
      }

      // 个人模式：从 SudoPrivacy Assistant Hub API 获取数据
      const params = new URLSearchParams();
      const isTenantScopedAssistantList = typeof tenantId === 'string' && tenantId.trim().length > 0;
      const visibleOverlayMap = isTenantScopedAssistantList ? await fetchVisibleAssistantOverlayMap(accessToken) : null;
      const isOverlayCategoryFilter = Boolean(category && category !== 'all' && visibleOverlayMap);
      if (cursor) params.set('cursor', cursor);
      if (limit) params.set('limit', String(limit));
      if (query) params.set('query', query);
      if (category && !isOverlayCategoryFilter) params.set('category', category);
      if (isTenantScopedAssistantList) params.set('tenant_id', tenantId.trim());

      const token = getSkillhubToken();
      if (!token) {
        mainError('AssistantHub', 'skillhub token not provisioned, skip fetchAssistants');
        return tokenMissingResponse('assistantHub');
      }
      const response = await fetch(`${getSkillHubBaseUrl()}/api/assistants/cursor?${params}`, {
        headers: { Authorization: token },
      });
      const result = await response.json();

      // Map API response to our type structure
      // API returns: { data: { assistants: [{ id, name, profession, description, avatar, categories, sourceUrl, ... }] } }
      const rawAssistants = result.data?.assistants || [];
      const visibleAssistants = visibleOverlayMap ? rawAssistants.filter((a: Record<string, unknown>) => typeof a.id === 'string' && visibleOverlayMap.has(a.id)) : rawAssistants;

      const mappedAssistants: IAssistantHubSkill[] = visibleAssistants
        .map((raw: Record<string, unknown>): IAssistantHubSkill => {
          const overlay = typeof raw.id === 'string' ? visibleOverlayMap?.get(raw.id) : undefined;
          const a = applyVisibleAssistantOverlay(raw, overlay);
          const versions = a.versions as IAssistantHubVersionLike[] | undefined;
          const latestVersion = (a.latestVersion as IAssistantHubVersionLike | undefined) || versions?.[0] || null;
          const version = [a.version, a.latest_version, latestVersion?.version, versions?.[0]?.version].find((value): value is string => typeof value === 'string' && value.length > 0);
          const sourceUrl = [a.sourceUrl, a.source_url, latestVersion?.source_url, versions?.[0]?.source_url].find((value): value is string => typeof value === 'string' && value.length > 0);
          const promptsI18n = firstPromptsI18n(a.promptsI18n, a.prompts_i18n);
          const tenantIds = tenantIdsWithFallback(a.tenantIds, a.tenant_ids, a.tenantId, a.tenant_id);
          const tenantId = firstNonEmptyString(a.tenantId, a.tenant_id) || tenantIds[0] || null;
          const categories = (a.categories as string[]) || [];

          return {
            id: a.id as string,
            name: a.name as string,
            display_name: firstNonEmptyString(a.display_name, a.profession, a.name) || (a.name as string),
            description: a.description as string,
            avatar: a.avatar as string | null,
            emoji: null as string | null,
            // Use categories array from API or visible assistant overlay.
            categories,
            category: categories[0] || '',
            preset_agent_type: null as string | null,
            skills: (a.skills as string[]) || ([] as string[]),
            tag: 'hub' as const,
            homepage: null as string | null,
            author_id: '',
            star_count: 0,
            applicable_scenarios: null as string | null,
            core_features: null as string | null,
            created_at: a.createdAt as string,
            updated_at: a.updatedAt as string,
            // Default init prompt from API
            defaultInitPrompt: (a.defaultInitPrompt as string) || null,
            promptsI18n,
            prompts_i18n: promptsI18n,
            tenantId,
            tenantIds,
            tenant_id: tenantId,
            tenant_ids: tenantIds,
            version,
            latestVersion,
            // Store sourceUrl for download (not in original type but needed for install)
            _sourceUrl: sourceUrl,
          };
        })
        .filter((assistant: IAssistantHubSkill) => !isOverlayCategoryFilter || matchesAssistantCategory(assistant, category));

      const mappedData = {
        assistants: mappedAssistants,
        next_cursor: result.data?.next_cursor || null,
        has_more: result.data?.has_more || false,
      };

      return { success: true, data: mappedData };
    } catch (error) {
      mainError('AssistantHub', 'Failed to fetch assistants:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch assistant categories from Hub API (type=1 for assistants)
  ipcBridge.assistantHub.fetchCategories.provider(async () => {
    try {
      // 企业模式：从本地 hub/ 目录的 meta 文件中提取分类
      if (isEnterpriseMode()) {
        const hubAssistantsDir = path.join(ASSISTANTS_ROOT_DIR, ENTERPRISE_ASSISTANT_SUBDIRS.hub);

        mainLog('AssistantHub', `Enterprise mode: extracting categories from ${hubAssistantsDir}`);

        const categoriesSet = new Set<string>();

        if (existsSync(hubAssistantsDir)) {
          const entries = await fs.readdir(hubAssistantsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const assistantName = entry.name;
            const assistantDir = path.join(hubAssistantsDir, assistantName);

            const metaResult = await readAssistantMetaFileWithFallback(assistantDir);
            if (metaResult) {
              const meta = JSON.parse(metaResult.content) as AssistantHubMeta;
              const assistantCategories = meta.categories || [];
              for (const cat of assistantCategories) {
                if (cat) categoriesSet.add(cat);
              }
            }
          }
        }

        return { success: true, data: Array.from(categoriesSet) };
      }

      // 个人模式：从 SudoPrivacy Assistant Hub API 获取分类
      const token = getSkillhubToken();
      if (!token) {
        mainError('AssistantHub', 'skillhub token not provisioned, skip fetchCategories');
        return tokenMissingResponse('assistantHub');
      }
      const response = await fetch(`${getSkillHubBaseUrl()}/api/categories?type=1`, {
        headers: { Authorization: token },
      });
      const data = await response.json();
      return { success: true, data: data.data || [] };
    } catch (error) {
      mainError('AssistantHub', 'Failed to fetch categories:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch assistant detail from Hub API
  ipcBridge.assistantHub.fetchAssistantDetail.provider(async ({ assistantId, silent }) => {
    try {
      // 企业模式：从本地 hub/ 目录读取详情
      if (isEnterpriseMode()) {
        const hubAssistantsDir = path.join(ASSISTANTS_ROOT_DIR, ENTERPRISE_ASSISTANT_SUBDIRS.hub);
        const assistantDir = path.join(hubAssistantsDir, assistantId);

        mainLog('AssistantHub', `Enterprise mode: loading assistant detail from ${assistantDir}`);

        const metaResult = await readAssistantMetaFileWithFallback(assistantDir);
        if (!metaResult) {
          return { success: false, msg: `Assistant "${assistantId}" not found in local hub` };
        }

        const meta = JSON.parse(metaResult.content) as AssistantHubMeta;
        const promptsI18n = normalizePromptsI18n(meta.promptsI18n);

        const assistant: IAssistantHubSkill = {
          id: meta.id || assistantId,
          name: assistantId,
          display_name: meta.nameI18n?.['en-US'] || meta.nameI18n?.['zh-CN'] || assistantId,
          description: meta.descriptionI18n?.['en-US'] || meta.descriptionI18n?.['zh-CN'] || '',
          avatar: meta.avatar || null,
          emoji: meta.emoji || null,
          categories: meta.categories || [],
          category: (meta.categories || [])[0] || '',
          preset_agent_type: meta.presetAgentType || null,
          skills: meta.enabledSkills || meta.skills || [],
          tag: 'hub' as const,
          homepage: meta.homepage || null,
          author_id: meta.author_id || '',
          star_count: 0,
          applicable_scenarios: meta.applicable_scenarios || null,
          core_features: meta.core_features || null,
          created_at: meta.installed_at || new Date().toISOString(),
          updated_at: meta.installed_at || new Date().toISOString(),
          defaultInitPrompt: meta.defaultInitPrompt || null,
          promptsI18n,
          prompts_i18n: promptsI18n,
          tenantId: meta.tenantId ?? null,
          tenantIds: tenantIdsWithFallback(meta.tenantIds, undefined, meta.tenantId, undefined),
          tenant_id: meta.tenantId ?? null,
          tenant_ids: tenantIdsWithFallback(meta.tenantIds, undefined, meta.tenantId, undefined),
          visible_to: meta.visible_to || null,
          version: meta.installed_version || '1.0.0',
        };

        const detail: IAssistantHubDetail = {
          assistant,
          versions: [],
        };

        return { success: true, data: detail };
      }

      // 个人模式：从 SudoPrivacy Assistant Hub API 获取详情
      const token = getSkillhubToken();
      if (!token) {
        if (!silent) {
          mainError('AssistantHub', 'skillhub token not provisioned, skip fetchAssistantDetail');
        }
        return tokenMissingResponse('assistantHub');
      }
      const url = `${getSkillHubBaseUrl()}/api/assistants/${assistantId}`;
      const response = await fetch(url, {
        headers: { Authorization: token },
      });
      const data = await response.json();
      return { success: true, data: data.data };
    } catch (error) {
      if (!silent) {
        mainError('AssistantHub', 'Failed to fetch assistant detail:', error);
      }
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch skill details by IDs from Skill Hub API (for installation preview)
  ipcBridge.assistantHub.fetchSkillDetailsByIds.provider(async ({ skillIds }) => {
    try {
      if (!skillIds || skillIds.length === 0) {
        return { success: true, data: [] };
      }

      const token = getSkillhubToken();
      if (!token) {
        mainError('AssistantHub', 'skillhub token not provisioned, skip fetchSkillDetailsByIds');
        return tokenMissingResponse('assistantHub');
      }

      // Fetch all skills in parallel
      const responses = await Promise.all(
        skillIds.map(async (id) => {
          try {
            const response = await fetch(`${getSkillHubBaseUrl()}/api/skills/${id}`, {
              headers: { Authorization: token },
            });
            const data = await response.json();
            if (data.success && data.data?.skill) {
              return data.data.skill as ISkillHubSkill;
            }
            return null;
          } catch {
            return null;
          }
        })
      );

      const skills = responses.filter((s): s is ISkillHubSkill => s !== null);
      return { success: true, data: skills };
    } catch (error) {
      mainError('AssistantHub', 'Failed to fetch skill details:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Download and install assistant from Hub, optionally installing selected associated skills
  ipcBridge.assistantHub.downloadAndInstallAssistant.provider(async ({ assistantName, displayName, sourceUrl, version, checksum, assistantMeta, selectedSkillIds }) => {
    try {
      const token = getSkillhubToken();
      if (!token) {
        mainError('AssistantHub', 'skillhub token not provisioned, skip downloadAndInstallAssistant');
        return tokenMissingResponse('assistantHub');
      }

      // Download zip file
      const zipBuffer = await downloadFile(sourceUrl);

      // Verify checksum if provided
      if (checksum) {
        const isValid = await verifyChecksum(zipBuffer, checksum);
        if (!isValid) {
          mainWarn('AssistantHub', 'Checksum verification failed, but continuing anyway');
        }
      }

      // Determine target directory based on tag type
      const targetDir = assistantMeta.tag === 'system' ? getSystemAssistantsDir() : getHubAssistantsDir();
      await fs.mkdir(targetDir, { recursive: true });

      const assistantDir = path.join(targetDir, assistantName);

      // Remove existing if present
      try {
        await fs.access(assistantDir);
        await fs.rm(assistantDir, { recursive: true, force: true });
      } catch {
        // Directory doesn't exist
      }

      await fs.mkdir(assistantDir, { recursive: true });

      // Extract zip contents
      await extractAssistantZipToDirectory(zipBuffer, assistantDir);

      // Scan for .md files and select ruleFile
      const ruleFile = await selectRuleFileFromDirectory(assistantDir, assistantName);

      let extractedMeta: AssistantHubMeta | null = null;
      const extractedMetaResult = await readAssistantMetaFileWithFallback(assistantDir);
      if (extractedMetaResult) {
        try {
          extractedMeta = JSON.parse(extractedMetaResult.content) as AssistantHubMeta;
        } catch {
          mainWarn('AssistantHub', `Failed to parse extracted assistant meta for "${assistantName}"`);
        }
      }
      const extractedMetaRecord = extractedMeta as Record<string, unknown> | null;
      const extractedNameI18n = stringRecord(extractedMeta?.nameI18n);
      const extractedDescriptionI18n = stringRecord(extractedMeta?.descriptionI18n);
      const extractedCategories = hasRecordKey(extractedMetaRecord, 'categories') ? (stringArray(extractedMetaRecord.categories) ?? []) : undefined;
      const categories = extractedCategories ?? firstStringArray(assistantMeta.categories) ?? [];
      const promptsI18n = hasRecordKey(extractedMetaRecord, 'promptsI18n') ? (normalizePackagePromptsI18n(extractedMetaRecord.promptsI18n) ?? { 'zh-CN': [] }) : firstPromptsI18n(assistantMeta.promptsI18n, assistantMeta.prompts_i18n);
      const packageDisplayName = firstNonEmptyString(extractedMeta?.display_name, extractedNameI18n?.['zh-CN'], extractedNameI18n?.['en-US'], extractedMeta?.name);
      const resolvedDisplayName = firstNonEmptyString(packageDisplayName, assistantMeta.display_name, displayName, assistantMeta.name, assistantName) || assistantName;
      const resolvedName = firstNonEmptyString(extractedMeta?.name, assistantMeta.name, assistantName) || assistantName;
      const nameI18n = extractedNameI18n ?? { 'zh-CN': resolvedDisplayName };
      const assistantDescription = firstString(assistantMeta.description);
      const descriptionI18n = hasRecordKey(extractedMetaRecord, 'descriptionI18n') ? (extractedDescriptionI18n ?? {}) : assistantDescription !== undefined ? { 'zh-CN': assistantDescription } : undefined;
      const defaultInitPrompt = hasRecordKey(extractedMetaRecord, 'defaultInitPrompt') ? (firstString(extractedMetaRecord.defaultInitPrompt) ?? null) : (firstString(assistantMeta.defaultInitPrompt) ?? null);
      const categoryId = firstNonEmptyString(extractedMeta?.category_id) ?? (extractedCategories !== undefined ? categories[0] || '' : firstNonEmptyString(assistantMeta.category, categories[0]) || '');
      const packageTenantIds = tenantIdsWithFallback(extractedMeta?.tenantIds, extractedMetaRecord?.tenant_ids, extractedMeta?.tenantId, extractedMetaRecord?.tenant_id);
      const tenantIds = packageTenantIds.length > 0 ? packageTenantIds : tenantIdsWithFallback(assistantMeta.tenantIds, assistantMeta.tenant_ids, assistantMeta.tenantId, assistantMeta.tenant_id);
      const tenantId = firstString(extractedMeta?.tenantId, extractedMetaRecord?.tenant_id, assistantMeta.tenantId, assistantMeta.tenant_id) ?? tenantIds[0] ?? null;
      const avatar = hasRecordKey(extractedMetaRecord, 'avatar') ? firstString(extractedMetaRecord.avatar) : firstString(assistantMeta.avatar, assistantMeta.emoji);
      const emoji = hasRecordKey(extractedMetaRecord, 'emoji') ? (firstString(extractedMetaRecord.emoji) ?? null) : assistantMeta.emoji;
      const profession = firstString(extractedMeta?.profession, assistantMeta.display_name, assistantMeta.name) ?? resolvedDisplayName;
      const resolvedRuleFile = ruleFile || firstNonEmptyString(extractedMeta?.ruleFile);

      // Install selected associated skills FIRST, collect skill IDs for meta
      const installedSkillNames: string[] = [];
      const failedSkillIds: string[] = [];
      const allAssociatedSkillIds: string[] = []; // All skill IDs (installed + already installed)

      if (selectedSkillIds && selectedSkillIds.length > 0) {
        // Get current installed skills to check which need installation
        const installedSkills = await skillManager.getInstalledSkills();
        // Build a map for quick lookup by skill ID (meta.id) and name
        const installedSkillByIdMap = new Map<string, { name: string; isBuiltin: boolean }>();
        const installedSkillNamesSet = new Set<string>();
        for (const skill of installedSkills) {
          installedSkillNamesSet.add(skill.name);
          if (skill.meta?.id) {
            installedSkillByIdMap.set(skill.meta.id, { name: skill.name, isBuiltin: skill.isBuiltin === true });
          }
        }

        for (const skillId of selectedSkillIds) {
          // First check if skill is already installed locally (including builtin skills)
          const localSkillInfo = installedSkillByIdMap.get(skillId);
          if (localSkillInfo) {
            // Track all associated skill IDs (for enabledSkills)
            allAssociatedSkillIds.push(skillId);

            if (installedSkillNamesSet.has(localSkillInfo.name)) {
              // Skill already installed (builtin or previously installed hub skill)
              continue;
            }
          }

          // Fetch skill detail from Hub to get name and download URL (for non-builtin skills)
          try {
            const skillDetailResponse = await fetch(`${getSkillHubBaseUrl()}/api/skills/${skillId}`, {
              headers: { Authorization: token },
            });
            const skillDetailData = await skillDetailResponse.json();

            if (skillDetailData.success && skillDetailData.data?.skill) {
              const skillInfo = skillDetailData.data.skill as ISkillHubSkill;
              const skillName = skillInfo.name;

              // Track all associated skill IDs (for enabledSkills)
              allAssociatedSkillIds.push(skillId);

              // Skip if already installed (check by name as fallback)
              if (installedSkillNamesSet.has(skillName)) {
                continue;
              }

              // Need version info for download
              if (!skillDetailData.data?.versions?.[0]) {
                mainWarn('AssistantHub', `Skill "${skillName}" has no versions available`);
                failedSkillIds.push(skillId);
                continue;
              }

              const latestVersion = skillDetailData.data.versions[0];

              // Download and install skill
              const skillZipBuffer = await downloadFile(latestVersion.source_url);
              if (latestVersion.checksum) {
                const isValid = await verifyChecksum(skillZipBuffer, latestVersion.checksum);
                if (!isValid) {
                  mainWarn('AssistantHub', `Skill "${skillName}" checksum verification failed, but continuing`);
                }
              }

              // Get hub skills directory
              const { getHubSkillsDir } = await import('@/process/initStorage');
              const hubSkillsDir = getHubSkillsDir();
              await fs.mkdir(hubSkillsDir, { recursive: true });
              const skillDir = path.join(hubSkillsDir, skillName);

              // Remove existing
              try {
                await fs.access(skillDir);
                await fs.rm(skillDir, { recursive: true, force: true });
              } catch {
                // ignored
              }

              await fs.mkdir(skillDir, { recursive: true });

              // Extract skill zip
              const skillZip = await JSZip.loadAsync(skillZipBuffer);
              for (const zipEntry of Object.values(skillZip.files)) {
                if (zipEntry.dir) continue;
                const normalizedPath = normalizeZipEntryPath(zipEntry.name);
                let targetPath = normalizedPath;
                // Handle top-level directory wrapper
                if (!normalizedPath.includes('/')) {
                  // Root file — use directly
                } else {
                  const parts = normalizedPath.split('/');
                  if (parts.length > 1) {
                    targetPath = parts.slice(1).join('/');
                  }
                }
                if (!targetPath) continue;

                const fullPath = path.join(skillDir, targetPath);
                const fullDir = path.dirname(fullPath);
                await fs.mkdir(fullDir, { recursive: true });
                const content = await zipEntry.async('nodebuffer');
                await fs.writeFile(fullPath, content);
              }

              // Write skill metadata
              const skillMeta = {
                id: skillInfo.id,
                name: skillInfo.name,
                display_name: skillInfo.display_name,
                description: skillInfo.description,
                icon: skillInfo.icon,
                emoji: skillInfo.emoji,
                category: skillInfo.category,
                categories: skillInfo.categories,
                applicable_scenarios: skillInfo.applicable_scenarios,
                core_features: skillInfo.core_features,
                homepage: skillInfo.homepage,
                author_id: skillInfo.author_id,
                source_type: 'hub',
                is_builtin: false,
                enabled: true,
                installed_version: latestVersion.version,
                installed_at: new Date().toISOString(),
              };
              // Use skillHubBridge's writeSkillMetaFile for consistency
              const { isEnterpriseMode: checkEnterprise } = await import('@/common/enterpriseDebugConfig');
              const isEnterprise = checkEnterprise();
              const skillMetaFileName = isEnterprise ? '_moss_meta.json' : '_sudowork_meta.json';
              await fs.writeFile(path.join(skillDir, skillMetaFileName), JSON.stringify(skillMeta, null, 2), 'utf-8');

              installedSkillNames.push(skillName);
              installedSkillNamesSet.add(skillName); // Update set for subsequent checks
            } else {
              mainWarn('AssistantHub', `Failed to fetch skill detail for "${skillId}"`);
              failedSkillIds.push(skillId);
            }
          } catch (skillError) {
            mainWarn('AssistantHub', `Failed to install associated skill "${skillId}":`, skillError);
            failedSkillIds.push(skillId);
          }
        }
      }

      // Write assistant meta with skill IDs in enabledSkills
      const meta: AssistantHubMeta = {
        id: assistantMeta.id,
        name: resolvedName,
        display_name: resolvedDisplayName,
        profession,
        nameI18n,
        descriptionI18n,
        avatar,
        emoji,
        presetAgentType: normalizePresetAgentType(assistantMeta.preset_agent_type) || DEFAULT_PRESET_AGENT_TYPE,
        source_type: assistantMeta.tag === 'system' ? 'builtin' : 'hub',
        tag: assistantMeta.tag || 'hub',
        // skills: store skill IDs (UUID format)
        skills: allAssociatedSkillIds,
        category_id: categoryId,
        categories,
        author_id: assistantMeta.author_id,
        homepage: assistantMeta.homepage,
        applicable_scenarios: assistantMeta.applicable_scenarios,
        core_features: assistantMeta.core_features,
        is_builtin: assistantMeta.tag === 'system',
        enabled: true,
        defaultInitPrompt,
        tenantId,
        tenantIds,
        promptsI18n,
        installed_version: version,
        installed_at: new Date().toISOString(),
        // enabledSkills: skill IDs that will be enabled for this assistant
        enabledSkills: allAssociatedSkillIds,
        // Rule file for displaying assistant rules
        ruleFile: resolvedRuleFile,
      };
      await writeAssistantMetaFile(assistantDir, meta);

      return {
        success: true,
        data: {
          assistantName,
          installedVersion: version,
          installedSkills: installedSkillNames,
          failedSkills: failedSkillIds,
        },
      };
    } catch (error) {
      mainError('AssistantHub', 'Failed to install assistant:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Register upload handler
  registerUploadAssistantToHubBridge();
}

// ==================== Upload Assistant to Hub ====================

/**
 * Register upload assistant to Hub handler.
 * Creates a zip file from assistant directory (excluding _sudowork_meta.json),
 * and uploads to /api/assistants endpoint.
 * Requires tenantId - users without tenantId cannot upload.
 */
export function registerUploadAssistantToHubBridge() {
  ipcBridge.assistantHub.uploadAssistantToHub.provider(async (params) => {
    const { name, displayName, profession, description, categories, skills, tenantId } = params;
    const isEnterprise = isEnterpriseMode();

    // Validate tenantId - required for upload
    if (!tenantId || !tenantId.trim()) {
      return {
        success: false,
        msg: '用户无租户ID，无法上传助手',
      };
    }

    try {
      const token = getSkillhubToken();
      if (!token) {
        mainError('AssistantHub', 'skillhub token not provisioned, skip uploadAssistantToHub');
        return tokenMissingResponse('assistantHub');
      }

      // Get custom assistants directory
      const assistantsDir = getCustomAssistantsDir();
      const assistantDir = path.join(assistantsDir, name);

      // Check if assistant exists
      try {
        await fs.access(assistantDir);
      } catch {
        return {
          success: false,
          msg: `助手 "${name}" 未找到`,
        };
      }

      // Read assistant meta for additional info
      const metaResult = await readAssistantMetaFileWithFallback(assistantDir);
      let assistantMeta: AssistantHubMeta | null = null;
      if (metaResult) {
        assistantMeta = JSON.parse(metaResult.content) as AssistantHubMeta;
      } else {
        mainWarn('AssistantHub', `No meta file found for assistant "${name}"`);
      }

      // Create zip file (excluding meta files)
      const zip = new JSZip();
      const files = await fs.readdir(assistantDir, { withFileTypes: true });

      let promptFilePath: string | null = null;
      let avatarFilePath: string | null = null;

      for (const file of files) {
        if (file.isDirectory()) continue;
        // Exclude both meta file variants
        if (file.name === ASSISTANT_META_FILE || file.name === MOSS_ASSISTANT_META_FILE) continue;

        const filePath = path.join(assistantDir, file.name);
        const content = await fs.readFile(filePath);

        zip.file(file.name, content);

        // Track prompt file (.md) and avatar file (.png)
        if (file.name.endsWith('.md') && !promptFilePath) {
          promptFilePath = filePath;
        }
        if (file.name.match(/\.(png|jpg|jpeg|svg|webp|gif)$/i) && !avatarFilePath) {
          avatarFilePath = filePath;
        }
      }

      // Generate zip buffer
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const zipFileName = `${name}.zip`;

      // Build multipart/form-data request
      const formData = new FormData();

      // Required fields
      formData.append('name', displayName);
      formData.append('profession', profession);

      // Optional fields
      if (description) {
        formData.append('description', description);
      }

      // Default init prompt from description
      if (description) {
        formData.append('default_init_prompt', description);
      }

      // Categories
      if (categories && categories.length > 0) {
        formData.append('categories', JSON.stringify(categories));
      }

      // Skills
      if (isEnterprise) {
        if (skills && skills.length > 0) {
          formData.append('skills', JSON.stringify(skills));
        } else if (assistantMeta?.enabledSkills && assistantMeta.enabledSkills.length > 0) {
          formData.append('skills', JSON.stringify(assistantMeta.enabledSkills));
        }
      } else {
        const uploadSkillIds = await resolveAssistantUploadSkillIds(skills, assistantMeta);
        if (uploadSkillIds.length > 0) {
          formData.append('skills', JSON.stringify(uploadSkillIds));
        }
      }

      // TenantId (required)
      formData.append('tenantIds', JSON.stringify([tenantId.trim()]));
      formData.append('tenant_id', tenantId.trim());

      // Prompt file (.md)
      if (promptFilePath) {
        const promptContent = await fs.readFile(promptFilePath);
        const promptBlob = new Blob([new Uint8Array(promptContent)], { type: 'text/markdown' });
        formData.append('prompt_file', promptBlob, path.basename(promptFilePath));
      }

      // Avatar file
      if (avatarFilePath) {
        const avatarContent = await fs.readFile(avatarFilePath);
        const avatarExt = path.extname(avatarFilePath).toLowerCase();
        const avatarMimeType = avatarExt === '.png' ? 'image/png' : avatarExt === '.jpg' || avatarExt === '.jpeg' ? 'image/jpeg' : avatarExt === '.svg' ? 'image/svg+xml' : avatarExt === '.webp' ? 'image/webp' : avatarExt === '.gif' ? 'image/gif' : 'application/octet-stream';
        const avatarBlob = new Blob([new Uint8Array(avatarContent)], { type: avatarMimeType });
        formData.append('avatar', avatarBlob, path.basename(avatarFilePath));
      }

      // Source url (zip file)
      const zipBlob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });
      formData.append('source_url', zipBlob, zipFileName);

      // Upload to Hub API
      const uploadUrl = `${getSkillHubBaseUrl()}/api/assistants`;

      // Real API call
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: token,
        },
        body: formData,
      });

      if (isEnterprise) {
        if (!response.ok) {
          const errorText = await response.text();
          mainError('AssistantHub', `Upload failed: ${response.status} - ${errorText}`);
          return {
            success: false,
            msg: `上传失败: ${response.status} - ${errorText}`,
          };
        }

        return {
          success: true,
          data: {
            success: true,
            message: `助手 "${displayName}" 上传成功`,
          },
        };
      }

      const responseBody = await parseAssistantHubUploadResponse(response);

      if (!response.ok) {
        const errorText = responseBody?.message || responseBody?.msg || JSON.stringify(responseBody);
        mainError('AssistantHub', `Upload failed: ${response.status} - ${errorText}`);
        return {
          success: false,
          msg: `上传失败: ${response.status} - ${errorText}`,
        };
      }

      const uploadedId = resolveAssistantHubUploadId(responseBody, assistantMeta?.id || name);
      const publishStatus = resolveAssistantHubUploadStatus(responseBody);
      const now = new Date().toISOString();
      const nextMeta: AssistantHubMeta = {
        ...(assistantMeta || {}),
        id: uploadedId,
        source_type: 'custom',
        tag: assistantMeta?.tag || 'custom',
        is_builtin: false,
        enabled: assistantMeta?.enabled !== false,
        uploaded: true,
        uploaded_at: now,
        publish_status: publishStatus,
      };
      await writeAssistantMetaFile(assistantDir, nextMeta);

      return {
        success: true,
        data: {
          success: true,
          message: `助手 "${displayName}" 上传成功`,
        },
      };
    } catch (error) {
      mainError('AssistantHub', 'Failed to upload assistant:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
