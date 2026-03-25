#!/usr/bin/env node
/**
 * Generate unique icons for each skill based on their metadata
 * Usage: node generate-skill-icons.js
 */

const fs = require('fs');
const path = require('path');

// Skill icon prompts - describe what each icon should look like
const SKILL_ICON_PROMPTS = {
  'cron': 'A minimalist clock icon with gear elements, representing scheduled tasks and timing. Clean modern design with blue and white colors. Simple geometric style suitable for a small app icon.',
  'pdf': 'A document icon with PDF letters, red accent color, clean minimalist design showing a paper document with folded corner. Professional and modern style.',
  'pptx': 'A presentation slide icon with chart and text elements, orange and blue gradient background. Modern corporate style showing a slide with graphs.',
  'docx': 'A Word document icon with blue color scheme, showing a paper document with text lines. Clean Microsoft Office inspired design.',
  'xlsx': 'A spreadsheet icon with green accent, showing a grid of cells with some highlighted. Modern Excel-inspired design with table elements.',
  'mermaid': 'A flowchart diagram icon with connected nodes and arrows, purple and teal colors. Shows a simple flow diagram representing diagram generation.',
  'moltbook': 'A cute lobster mascot icon, friendly cartoon style, orange/red colors. Social network themed with a cheerful expression.',
  'story-roleplay': 'Two theater masks (comedy and tragedy) icon, dramatic purple and gold colors. Represents roleplay and storytelling.',
  'skill-creator': 'A puzzle piece icon with a lightbulb inside, representing creation and building. Blue and yellow colors, modern tech style.',
  'browser': 'A globe icon with a cursor arrow, representing web browsing. Blue and green colors, clean modern internet symbol.',
  'star-office-helper': 'A star icon with an office building silhouette inside, gold and blue colors. Represents office productivity and monitoring.',
  'x-recruiter': 'A bird (X/Twitter logo style) with a briefcase, blue and white colors. Represents job posting on X platform.',
  'xiaohongshu-recruiter': 'A red book icon with a small heart, representing Xiaohongshu platform job posting. Modern social media style.',
  'openclaw-setup': 'A robot head icon with gear settings, teal and white colors. Represents AI assistant configuration.',
  'sudowork-webui-setup': 'A monitor screen with WiFi signal icon, blue and white colors. Represents web UI and remote access configuration.'
};

// Skill directories
const SKILLS_DIR = path.join(__dirname, '..', 'skills');

// Get all skill directories with metadata
function getSkillsWithMetadata() {
  const skills = [];
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(SKILLS_DIR, entry.name);

    // Handle _builtin subdirectories
    if (entry.name === '_builtin') {
      const builtinEntries = fs.readdirSync(skillDir, { withFileTypes: true });
      for (const subEntry of builtinEntries) {
        if (!subEntry.isDirectory()) continue;
        const metaPath = path.join(skillDir, subEntry.name, '_sudowork_meta.json');
        if (fs.existsSync(metaPath)) {
          skills.push({
            name: subEntry.name,
            dir: path.join(skillDir, subEntry.name),
            meta: JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          });
        }
      }
    } else {
      const metaPath = path.join(skillDir, '_sudowork_meta.json');
      if (fs.existsSync(metaPath)) {
        skills.push({
          name: entry.name,
          dir: skillDir,
          meta: JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        });
      }
    }
  }

  return skills;
}

// Generate image using canvas (fallback for when no AI is available)
function generatePlaceholderIcon(skillName, outputPath) {
  // For now, just log what we would generate
  console.log(`Would generate icon for ${skillName}`);
  console.log(`  Prompt: ${SKILL_ICON_PROMPTS[skillName] || 'No prompt defined'}`);
  console.log(`  Output: ${outputPath}`);

  // Return false to indicate placeholder wasn't generated
  // User needs to use AI image generation separately
  return false;
}

async function main() {
  console.log('=== Skill Icon Generator ===\n');

  const skills = getSkillsWithMetadata();
  console.log(`Found ${skills.length} skills with metadata\n`);

  console.log('Icon prompts for each skill:\n');
  console.log('---\n');

  for (const skill of skills) {
    const prompt = SKILL_ICON_PROMPTS[skill.name] || `Icon for ${skill.meta.display_name || skill.name} - ${skill.meta.description}`;
    console.log(`## ${skill.meta.display_name || skill.name} (${skill.name})`);
    console.log(`Prompt: "${prompt}"`);
    console.log(`Output: ${path.join(skill.dir, 'icon.png')}`);
    console.log('');
  }

  console.log('---\n');
  console.log('To generate icons with AI:');
  console.log('1. Use an image generation AI with the prompts above');
  console.log('2. Generate 400x400 or 512x512 pixel icons');
  console.log('3. Save each icon as "icon.png" in the skill directory');
}

main().catch(console.error);