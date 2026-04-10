#!/usr/bin/env node

/**
 * Check safety hook status in Nexus
 * Usage: node scripts/check-safety-status.js
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
    return null;
  }
  return data.result;
}

function decodeBase64(data) {
  return Buffer.from(data, 'base64').toString('utf-8');
}

async function main() {
  console.log('=== Safety Hook Status ===\n');

  // 1. Check unified hook config (enabled state + blacklist)
  console.log('1. Unified Hook Config (/safe/config/hook):');
  try {
    const configResult = await callRPC('read', { path: '/safe/config/hook' });
    if (configResult && configResult.__type__ === 'bytes') {
      const content = decodeBase64(configResult.data);
      const config = JSON.parse(content);
      console.log(`   Enabled: ${config.enabled}`);
      console.log(`   FastPass: ${config.fastPass}`);
      if (config.timestamp) {
        const date = new Date(config.timestamp);
        console.log(`   Timestamp: ${date.toISOString()}`);
      }
      // Show blacklist info
      const blacklist = config.blacklist || { rules: [] };
      console.log(`   Blacklist Rules: ${blacklist.rules?.length || 0}`);
      if (blacklist.rules?.length > 0) {
        blacklist.rules.forEach((rule, i) => {
          console.log(`     [${i + 1}] ${rule.type}: ${rule.pattern} (${rule.enabled ? 'enabled' : 'disabled'})`);
        });
      }
    } else if (configResult && configResult.content) {
      const content = Buffer.isBuffer(configResult.content)
        ? configResult.content.toString()
        : decodeBase64(configResult.content);
      const config = JSON.parse(content);
      console.log(`   Enabled: ${config.enabled}`);
      console.log(`   FastPass: ${config.fastPass}`);
      if (config.timestamp) {
        const date = new Date(config.timestamp);
        console.log(`   Timestamp: ${date.toISOString()}`);
      }
      // Show blacklist info
      const blacklist = config.blacklist || { rules: [] };
      console.log(`   Blacklist Rules: ${blacklist.rules?.length || 0}`);
      if (blacklist.rules?.length > 0) {
        blacklist.rules.forEach((rule, i) => {
          console.log(`     [${i + 1}] ${rule.type}: ${rule.pattern} (${rule.enabled ? 'enabled' : 'disabled'})`);
        });
      }
    } else {
      console.log('   (not found)');
    }
  } catch (e) {
    console.log('   (not found or parse error)');
  }

  // 2. List event files
  console.log('\n2. Event Files (/safe/event):');
  try {
    const eventResult = await callRPC('list', { path: '/safe/event' });
    if (eventResult && eventResult.files) {
      console.log(`   Count: ${eventResult.files.length}`);
      if (eventResult.files.length > 0) {
        eventResult.files.slice(0, 10).forEach((file, i) => {
          const filename = file.split('/').pop();
          console.log(`   [${i + 1}] ${filename}`);
        });
        if (eventResult.files.length > 10) {
          console.log(`   ... and ${eventResult.files.length - 10} more`);
        }
      }
    } else {
      console.log('   (empty or not found)');
    }
  } catch (e) {
    console.log('   (not found)');
  }

  // 3. List action files
  console.log('\n3. Action Files (/safe/action):');
  try {
    const actionResult = await callRPC('list', { path: '/safe/action' });
    if (actionResult && actionResult.files) {
      console.log(`   Count: ${actionResult.files.length}`);
      if (actionResult.files.length > 0) {
        actionResult.files.slice(0, 10).forEach((file, i) => {
          const filename = file.split('/').pop();
          console.log(`   [${i + 1}] ${filename}`);
        });
        if (actionResult.files.length > 10) {
          console.log(`   ... and ${actionResult.files.length - 10} more`);
        }
      }
    } else {
      console.log('   (empty or not found)');
    }
  } catch (e) {
    console.log('   (not found)');
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
