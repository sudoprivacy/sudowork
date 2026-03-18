/**
 * Test script to verify Word to Markdown conversion without LibreOffice
 */

import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';
import TurndownService from 'turndown';

const turndownService = new TurndownService();

async function testWordConversion(filePath: string) {
  console.log(`\n=== Testing Word Conversion ===`);
  console.log(`File: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }

  try {
    // Step 1: Read file
    console.log('\n1. Reading file...');
    const buffer = fs.readFileSync(filePath);
    console.log(`   ✓ File size: ${buffer.length} bytes`);

    // Step 2: Convert to HTML using mammoth
    console.log('\n2. Converting to HTML with mammoth...');
    const result = await mammoth.convertToHtml({ buffer });
    console.log(`   ✓ HTML generated: ${result.value.length} characters`);

    if (result.messages && result.messages.length > 0) {
      console.log(`   Messages: ${JSON.stringify(result.messages)}`);
    }

    // Step 3: Convert HTML to Markdown
    console.log('\n3. Converting HTML to Markdown...');
    const markdown = turndownService.turndown(result.value);
    console.log(`   ✓ Markdown generated: ${markdown.length} characters`);

    // Step 4: Show preview
    console.log('\n=== Markdown Preview (first 500 chars) ===');
    console.log(markdown.substring(0, 500) || '(empty)');

    if (markdown.trim().length === 0) {
      console.log('\n⚠️  WARNING: Markdown content is empty!');
    } else {
      console.log('\n✅ SUCCESS: Word conversion completed with content!');
    }
  } catch (error) {
    console.error('\n❌ ERROR:', error instanceof Error ? error.message : error);
  }
}

// Test with a sample .docx file
const testFiles = ['/Users/yobach/Downloads/sudowork/test-document.docx', '/Users/yobach/Downloads/sudowork/node_modules/.pnpm/mammoth@1.12.0/node_modules/mammoth/test/test-data/tables.docx', '/Users/yobach/Downloads/sudowork/test.docx', '/Users/yobach/Downloads/test.docx'];

async function runTests() {
  console.log('Starting Word conversion tests...');

  for (const file of testFiles) {
    if (fs.existsSync(file)) {
      await testWordConversion(file);
      return;
    }
  }

  console.log('\n❌ No test .docx files found in common locations');
  console.log('Please create or specify a test file path');
}

runTests();
