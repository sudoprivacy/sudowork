/**
 * Direct test of LibreOffice detection logic
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);

async function findLibreOffice() {
  // First try PATH
  try {
    const { stdout } = await execAsync('soffice --version');
    if (stdout) {
      console.log('[Test] LibreOffice found in PATH:', stdout.trim());
      return 'soffice';
    }
  } catch (e) {
    console.log('[Test] soffice not in PATH');
  }

  // Common LibreOffice paths
  const commonPaths = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/local/bin/soffice',
    '/opt/libreoffice/program/soffice',
  ];

  for (const libPath of commonPaths) {
    try {
      await fs.promises.access(libPath);
      console.log('[Test] LibreOffice found at:', libPath);
      return libPath;
    } catch (e) {
      console.log('[Test] Not found at:', libPath);
    }
  }

  console.log('[Test] LibreOffice not found');
  return null;
}

async function test() {
  console.log('=== Testing LibreOffice Detection ===\n');
  const path = await findLibreOffice();
  console.log('\nFinal result:', path);
  console.log('Available:', path !== null);
}

test().catch(console.error);
