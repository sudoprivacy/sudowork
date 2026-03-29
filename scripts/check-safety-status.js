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

  // 1. Check if safety hook is enabled
  console.log('1. Safety Hook Enabled State (/safe/config/enabled):');
  try {
    const enabledResult = await callRPC('read', { path: '/safe/config/enabled' });
    if (enabledResult && enabledResult.__type__ === 'bytes') {
      const content = decodeBase64(enabledResult.data);
      console.log(`   ${content}`);
    } else if (enabledResult && enabledResult.content) {
      const content = Buffer.isBuffer(enabledResult.content)
        ? enabledResult.content.toString()
        : decodeBase64(enabledResult.content);
      console.log(`   ${content}`);
    } else {
      console.log('   (not found)');
    }
  } catch (e) {
    console.log('   (not found)');
  }

  // 2. Check blacklist config
  console.log('\n2. Blacklist Config (/safe/config/blacklist):');
  try {
    const blacklistResult = await callRPC('read', { path: '/safe/config/blacklist' });
    if (blacklistResult && blacklistResult.__type__ === 'bytes') {
      const content = decodeBase64(blacklistResult.data);
      const config = JSON.parse(content);
      console.log(`   Rules count: ${config.rules?.length || 0}`);
      if (config.rules?.length > 0) {
        config.rules.forEach((rule, i) => {
          console.log(`   [${i + 1}] ${rule.type}: ${rule.pattern} (${rule.enabled ? 'enabled' : 'disabled'})`);
        });
      }
    } else {
      console.log('   (not found)');
    }
  } catch (e) {
    console.log('   (not found or parse error)');
  }

  // 3. List event files
  console.log('\n3. Event Files (/safe/event):');
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

  // 4. List action files
  console.log('\n4. Action Files (/safe/action):');
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