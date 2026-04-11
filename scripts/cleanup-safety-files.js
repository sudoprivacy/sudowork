#!/usr/bin/env node

/**
 * Clean up safety hook event and action files
 * Usage: node scripts/cleanup-safety-files.js
 */

const NEXUS_URL = 'http://127.0.0.1:12012';

async function callRPC(method, params = {}) {
  const url = new URL(`/api/nfs/${method}`, NEXUS_URL);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method,
      params,
    }),
  });
  const data = await response.json();
  if (data.error) {
    return { error: data.error };
  }
  return { result: data.result };
}

async function cleanupDirectory(dirPath, dirName) {
  console.log(`Cleaning ${dirName} (${dirPath})...`);

  try {
    const listResult = await callRPC('list', { path: dirPath });

    if (listResult.error) {
      console.log(`  Directory not found or empty`);
      return 0;
    }

    const files = listResult.result?.files || [];
    if (files.length === 0) {
      console.log(`  No files to delete`);
      return 0;
    }

    let deletedCount = 0;
    let errorCount = 0;

    for (const file of files) {
      const deleteResult = await callRPC('delete', { path: file });
      if (deleteResult.error) {
        errorCount++;
      } else {
        deletedCount++;
      }
    }

    console.log(`  Deleted: ${deletedCount}, Errors: ${errorCount}`);
    return deletedCount;
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    return 0;
  }
}

async function main() {
  console.log('=== Cleaning Safety Hook Files ===\n');

  const eventDeleted = await cleanupDirectory('/safe/event', 'Event Files');
  console.log('');
  const actionDeleted = await cleanupDirectory('/safe/action', 'Action Files');

  console.log(`\n=== Summary ===`);
  console.log(`Total deleted: ${eventDeleted + actionDeleted} files`);
  console.log('=== Done ===');
}

main().catch(console.error);
