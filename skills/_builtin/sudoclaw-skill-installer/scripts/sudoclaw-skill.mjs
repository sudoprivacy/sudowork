#!/usr/bin/env node

/**
 * SudoClaw Skill CLI - Search and install skills from SudoClaw skill hub
 *
 * Usage:
 *   sudoclaw-skill search <query>       - Search skills by keyword
 *   sudoclaw-skill install <skill-name> - Install a skill by name
 *   sudoclaw-skill list                 - List installed skills from hub
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'module';

// Load jszip from Sudoclaw CLI node_modules if available
const require = createRequire(import.meta.url);
const sudoclawNodeModules = path.join(os.homedir(), '.nexus', 'sudoclaw', 'cli', 'package', 'node_modules');
let JSZip;
try {
  JSZip = require(path.join(sudoclawNodeModules, 'jszip'));
} catch {
  JSZip = require('jszip');
}

const SKILL_HUB_BASE_URL = 'https://sudoclawhub.sudoprivacy.com/api/skills';
const SKILL_HUB_CURSOR_URL = 'https://sudoclawhub.sudoprivacy.com/api/skills/cursor';
const AUTHORIZATION = 'sud0@sudo';

const NEXUS_DIR = path.join(os.homedir(), '.nexus');
const SKILLS_DIR = path.join(NEXUS_DIR, 'skills');
const HUB_SKILLS_DIR = path.join(SKILLS_DIR, '_hub');

// Skill markdown file names that indicate a skill package
const SKILL_MD_FILE_NAMES = ['SKILL.md', 'skill.md', 'SKILL', 'skill'];

function normalizeZipEntryPath(entryPath) {
  return entryPath.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function isSkillMarkdownFileName(filename) {
  return SKILL_MD_FILE_NAMES.includes(filename);
}

/**
 * Detect zip layout and return prefix to strip.
 * If zip contains SKILL.md at root, return ''.
 * If zip has single top-level directory containing SKILL.md, return that directory path.
 */
function resolveZipSkillLayout(zip) {
  const fileEntries = Object.values(zip.files)
    .filter(entry => !entry.dir)
    .map(entry => normalizeZipEntryPath(entry.name))
    .filter(Boolean);

  // Find all SKILL.md paths
  const skillMdPaths = fileEntries.filter(entryPath => {
    const basename = entryPath.split('/').pop();
    return isSkillMarkdownFileName(basename);
  });

  // If SKILL.md at root, no prefix to strip
  if (skillMdPaths.includes('SKILL.md') || skillMdPaths.includes('skill.md')) {
    return { stripPrefix: '' };
  }

  // Find unique skill roots (directories containing SKILL.md)
  const skillRoots = Array.from(new Set(
    skillMdPaths.map(entryPath => {
      const parts = entryPath.split('/');
      return parts.slice(0, -1).join('/');
    }).filter(p => p && p !== '.')
  ));

  // If single skill root, strip that prefix
  if (skillRoots.length === 1) {
    const skillRoot = skillRoots[0];
    return { stripPrefix: skillRoot + '/' };
  }

  // Multiple or no skill roots - don't strip
  return { stripPrefix: '' };
}

/**
 * Extract skill zip to target directory, stripping top-level prefix if needed.
 * This matches the logic in skillHubBridge.ts extractSkillZipToDirectory.
 */
async function extractSkillZipToDirectory(zipBuffer, targetDir) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const { stripPrefix } = resolveZipSkillLayout(zip);

  const extractedFiles = [];

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const normalizedPath = normalizeZipEntryPath(relativePath);
    let targetPath = normalizedPath;

    // Strip prefix if detected
    if (stripPrefix) {
      if (!normalizedPath.startsWith(stripPrefix)) {
        continue; // Skip files outside skill root
      }
      targetPath = normalizedPath.slice(stripPrefix.length);
    }

    if (!targetPath) continue;

    const fullPath = path.join(targetDir, targetPath);
    const fullDir = path.dirname(fullPath);

    // Ensure directory exists
    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true });
    }

    // Extract file content
    const content = await zipEntry.async('nodebuffer');
    fs.writeFileSync(fullPath, content);
    extractedFiles.push(targetPath);
  }

  return extractedFiles;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { Authorization: AUTHORIZATION }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function searchSkills(query, limit = 10) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('query', query.trim());

  const result = await fetchJson(`${SKILL_HUB_CURSOR_URL}?${params}`);
  return result.data?.skills || [];
}

async function getSkillDetail(skillId) {
  const result = await fetchJson(`${SKILL_HUB_BASE_URL}/${skillId}`);
  return result.data;
}

async function installSkill(skillName) {
  // First search for the skill
  console.log(`Searching for skill: ${skillName}...`);

  const skills = await searchSkills(skillName, 20);

  if (!skills.length) {
    console.log(`No skills found matching "${skillName}"`);
    console.log('Try searching with different keywords or check SudoClaw skill hub for available skills.');
    return { success: false, error: 'No skills found' };
  }

  // Find exact match or best match
  const exactMatch = skills.find(s => s.name === skillName || s.display_name === skillName);
  const targetSkill = exactMatch || skills[0];

  console.log(`Found skill: ${targetSkill.display_name} (${targetSkill.name})`);
  console.log(`Description: ${targetSkill.description}`);

  // Get skill detail to get download URL
  const detail = await getSkillDetail(targetSkill.id);

  if (!detail?.versions?.length) {
    console.log('No versions available for this skill');
    return { success: false, error: 'No versions available' };
  }

  const latestVersion = detail.versions[0];
  console.log(`Latest version: ${latestVersion.version}`);

  // Create target directory
  const targetDir = path.join(HUB_SKILLS_DIR, targetSkill.name);

  if (fs.existsSync(targetDir)) {
    console.log(`Skill already installed at: ${targetDir}`);
    console.log('To reinstall, remove the existing directory first.');
    return { success: true, installed: false, reason: 'Already installed' };
  }

  // Download zip file to memory (for JSZip extraction)
  console.log(`Downloading from: ${latestVersion.source_url}`);

  // Ensure hub directory exists
  if (!fs.existsSync(HUB_SKILLS_DIR)) {
    fs.mkdirSync(HUB_SKILLS_DIR, { recursive: true });
  }

  // Download zip file as buffer
  const zipBuffer = await new Promise((resolve, reject) => {
    const chunks = [];
    https.get(latestVersion.source_url, {
      headers: { Authorization: AUTHORIZATION }
    }, (res) => {
      if (res.statusCode === 200) {
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      } else {
        reject(new Error(`Download failed with status ${res.statusCode}`));
      }
    }).on('error', reject);
  });

  console.log('Download complete, extracting...');

  // Extract using JSZip with prefix stripping (matches skillHubBridge logic)
  await extractSkillZipToDirectory(zipBuffer, targetDir);

  // Save metadata
  const metaPath = path.join(targetDir, '_sudowork_meta.json');
  const meta = {
    id: targetSkill.id,
    name: targetSkill.name,
    display_name: targetSkill.display_name,
    description: targetSkill.description,
    icon: targetSkill.icon,
    emoji: targetSkill.emoji,
    categories: targetSkill.categories,
    homepage: targetSkill.homepage,
    author_id: targetSkill.author_id,
    source_type: 'hub',
    is_builtin: false,
    enabled: true,
    installed_version: latestVersion.version,
    installed_at: new Date().toISOString(),
    checksum: latestVersion.checksum,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log(`\n✓ Skill installed successfully!`);
  console.log(`  Name: ${targetSkill.display_name}`);
  console.log(`  Version: ${latestVersion.version}`);
  console.log(`  Location: ${targetDir}`);
  console.log('\nThe skill is now available in your conversations.');

  return { success: true, skill: targetSkill, version: latestVersion.version };
}

function listInstalledSkills() {
  if (!fs.existsSync(HUB_SKILLS_DIR)) {
    console.log('No hub-installed skills found.');
    return [];
  }

  const skills = [];
  const dirs = fs.readdirSync(HUB_SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'));

  for (const dir of dirs) {
    const metaPath = path.join(HUB_SKILLS_DIR, dir.name, '_sudowork_meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        skills.push(meta);
      } catch {}
    }
  }

  if (skills.length === 0) {
    console.log('No hub-installed skills found.');
  } else {
    console.log('Installed skills from SudoClaw skill hub:');
    console.log('');
    for (const skill of skills) {
      console.log(`  • ${skill.display_name} (${skill.name}) - v${skill.installed_version || 'unknown'}`);
      if (skill.description) {
        console.log(`    ${skill.description.slice(0, 80)}${skill.description.length > 80 ? '...' : ''}`);
      }
    }
  }

  return skills;
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('SudoClaw Skill CLI - Search and install skills from SudoClaw skill hub');
    console.log('');
    console.log('Usage:');
    console.log('  sudoclaw-skill search <query>       - Search skills by keyword');
    console.log('  sudoclaw-skill install <skill-name> - Install a skill');
    console.log('  sudoclaw-skill list                 - List installed skills');
    console.log('');
    console.log('Examples:');
    console.log('  sudoclaw-skill search "pdf"');
    console.log('  sudoclaw-skill install shareone-skill');
    console.log('  sudoclaw-skill install "ShareOne文件分享助手"');
    return;
  }

  switch (command) {
    case 'search': {
      const query = args.slice(1).join(' ');
      if (!query) {
        console.log('Please provide a search query');
        return;
      }

      console.log(`Searching for: "${query}"...`);
      const skills = await searchSkills(query, 20);

      if (!skills.length) {
        console.log('No skills found. Try different keywords.');
        return;
      }

      console.log(`\nFound ${skills.length} skills:\n`);
      for (const skill of skills) {
        console.log(`  ${skill.display_name} (${skill.name})`);
        console.log(`    ${skill.description?.slice(0, 100) || 'No description'}${skill.description?.length > 100 ? '...' : ''}`);
        if (skill.categories?.length) {
          console.log(`    Categories: ${skill.categories.join(', ')}`);
        }
        console.log('');
      }
      break;
    }

    case 'install': {
      const skillName = args.slice(1).join(' ');
      if (!skillName) {
        console.log('Please provide a skill name to install');
        return;
      }
      await installSkill(skillName);
      break;
    }

    case 'list': {
      listInstalledSkills();
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Available commands: search, install, list');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});