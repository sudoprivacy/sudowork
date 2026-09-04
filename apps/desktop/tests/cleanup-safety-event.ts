/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 清理安全事件测试文件
 *
 * 使用方法：
 *   bunx tsx tests/cleanup-safety-event.ts              # 清理所有事件文件
 *   bunx tsx tests/cleanup-safety-event.ts event_xxx    # 清理指定 UUID 的事件文件
 */

import { getNexusRpcClient } from '../src/common/nexus';

const EVENT_DIR = '/safe/event';
const ACTION_DIR = '/safe/action';

async function cleanupSafetyEvent(targetUuid?: string) {
  console.log('\n========================================');
  console.log('  清理安全事件文件');
  console.log('========================================\n');

  const client = getNexusRpcClient();

  let deletedCount = 0;

  // 清理事件文件
  try {
    const files = await client.list(EVENT_DIR);

    for (const item of files) {
      // 如果指定了 UUID，只清理该文件；否则清理所有
      if (targetUuid && item.name !== targetUuid) {
        continue;
      }

      try {
        await client.delete(`${EVENT_DIR}/${item.name}`);
        console.log(`✓ 已删除事件文件：${item.name}`);
        deletedCount++;
      } catch (e) {
        console.log(`- 删除失败：${item.name}`);
      }
    }
  } catch (error) {
    console.log('事件目录为空或不存在');
  }

  // 清理对应的 action 文件
  try {
    const actionFiles = await client.list(ACTION_DIR);

    for (const item of actionFiles) {
      // 如果指定了 UUID，只清理该文件；否则清理所有
      if (targetUuid && item.name !== targetUuid) {
        continue;
      }

      try {
        await client.delete(`${ACTION_DIR}/${item.name}`);
        console.log(`✓ 已删除动作文件：${item.name}`);
        deletedCount++;
      } catch (e) {
        // 忽略
      }
    }
  } catch {
    // 忽略
  }

  console.log(`\n✅ 共删除 ${deletedCount} 个文件`);
  console.log();
}

// 主程序
const args = process.argv.slice(2);
const targetUuid = args[0];

cleanupSafetyEvent(targetUuid).catch((error) => {
  console.error('清理失败:', error);
  process.exit(1);
});
