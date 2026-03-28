/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 模拟安全事件测试脚本
 *
 * 手动触发时写入一个对接方事件文件到 /safe/event/{uuid}
 * 用于测试安全 Hook 轮询服务是否正常检测并弹窗
 *
 * 使用方法：bunx tsx tests/simulate-safety-event.ts [network|file]
 *
 * 测试完成后请手动清理：
 * bunx tsx tests/cleanup-safety-event.ts
 */

import { getNexusRpcClient } from '../src/common/nexus';
import type { EventFileData } from '../src/common/safetyTypes';

const EVENT_DIR = '/safe/event';

/**
 * 生成 32 位 UUID 字符串
 */
function generateUuid(): string {
  // 生成类似：a1b2c3d4e5f6789012345678abcdef90 格式的 32 位 UUID
  const chars = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 32; i++) {
    uuid += chars.charAt(Math.floor(Math.random() * 16));
  }
  return uuid;
}

async function simulateSafetyEvent(eventType: 'network' | 'file' = 'network') {
  console.log('\n========================================');
  console.log('  模拟安全事件生成器');
  console.log('========================================\n');

  const client = getNexusRpcClient();

  // 确保目录存在
  try {
    await client.mkdir(EVENT_DIR, true);
    console.log('✓ 事件目录已准备');
  } catch {
    console.log('✓ 事件目录已存在');
  }

  // 生成事件 UUID
  const eventUuid = generateUuid();
  const eventFilePath = `${EVENT_DIR}/${eventUuid}`;

  // 根据类型生成事件数据
  let eventData: EventFileData;

  if (eventType === 'network') {
    eventData = {
      type: 'network',
      data: {
        requestId: `req_${Date.now()}`,
        url: 'https://api.example.com/v1/users/export',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ***',
          'User-Agent': 'SudoWork/1.0'
        },
        body: JSON.stringify({ action: 'export_all_users' })
      }
    };
    console.log('\n📡 事件类型：网络请求');
    console.log(`   URL: ${eventData.data.url}`);
    console.log(`   方法：${eventData.data.method}`);
  } else {
    eventData = {
      type: 'file',
      data: {
        path: '/Users/Shared/sensitive_data.json',
        flags: ['O_WRONLY', 'O_CREAT', 'O_TRUNC']
      }
    };
    console.log('\n📁 事件类型：文件操作');
    console.log(`   路径：${eventData.data.path}`);
    console.log(`   标志：${eventData.data.flags.join(', ')}`);
  }

  // 写入事件文件
  try {
    await client.write(eventFilePath, JSON.stringify(eventData, null, 2));

    console.log('\n✅ 事件文件已写入');
    console.log(`   文件路径：${eventFilePath}`);
    console.log(`   UUID: ${eventUuid}`);

    console.log('\n----------------------------------------');
    console.log('等待轮询服务检测 (约 5 秒后弹窗)...');
    console.log('----------------------------------------');
    console.log('\n测试完成后，运行以下命令清理:');
    console.log(`  bunx tsx tests/cleanup-safety-event.ts ${eventUuid}`);
    console.log();

  } catch (error) {
    console.error('\n❌ 写入事件文件失败:', error);
    process.exit(1);
  }
}

// 主程序
const args = process.argv.slice(2);
const eventType = args[0] as 'network' | 'file' || 'network';

if (!['network', 'file'].includes(eventType)) {
  console.error('用法：bunx tsx tests/simulate-safety-event.ts [network|file]');
  console.error('  network - 模拟网络请求事件 (默认)');
  console.error('  file    - 模拟文件操作事件');
  process.exit(1);
}

simulateSafetyEvent(eventType).catch((error) => {
  console.error('模拟失败:', error);
  process.exit(1);
});
