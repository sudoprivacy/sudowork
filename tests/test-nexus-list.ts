/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Nexus RPC List 测试脚本
 *
 * 测试 Nexus RPC list 方法返回的数据
 *
 * 使用方法：bunx tsx tests/test-nexus-list.ts [path]
 */

import { getNexusRpcClient } from '../src/common/nexus';

async function testNexusList(dirPath: string = '/safe/event') {
  console.log('\n========================================');
  console.log('  Nexus RPC List 测试');
  console.log('========================================\n');

  const client = getNexusRpcClient();

  console.log(`查询目录: ${dirPath}\n`);

  try {
    const result = await client.callRPC('list', { path: dirPath });
    console.log('原始返回结果:');
    console.log(JSON.stringify(result, null, 2));
    console.log();

    // 手动解析
    if (result && typeof result === 'object') {
      const dict = result as Record<string, unknown>;
      console.log('返回字段:', Object.keys(dict));
      console.log();

      const files = dict.files || dict.items || [];
      console.log(`files/items 数量: ${Array.isArray(files) ? files.length : '不是数组'}`);
      console.log();

      if (Array.isArray(files)) {
        console.log('文件列表详情:');
        files.forEach((item: unknown, index: number) => {
          console.log(`  [${index}] 类型: ${typeof item}`);
          if (typeof item === 'string') {
            console.log(`      值: "${item}"`);
          } else if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            console.log(`      path: "${obj.path}"`);
            console.log(`      name: "${obj.name}"`);
            if (obj.entry_type !== undefined) {
              console.log(`      entry_type: ${obj.entry_type}`);
            }
          }
        });
      }
    }

    console.log('\n----------------------------------------');
    console.log('使用 client.list() 方法:');
    console.log('----------------------------------------\n');

    const items = await client.list(dirPath);
    console.log(`返回 ${items.length} 个文件:`);
    items.forEach((item, index) => {
      console.log(`  [${index}] name="${item.name}", path="${item.path}"`);
    });

    // 测试读取第一个文件
    if (items.length > 0) {
      console.log('\n----------------------------------------');
      console.log('测试读取文件:');
      console.log('----------------------------------------\n');

      const firstItem = items[0];
      console.log(`尝试读取: ${firstItem.path}`);

      try {
        const content = await client.read(firstItem.path, false);
        if (Buffer.isBuffer(content)) {
          console.log(`读取成功，内容长度: ${content.length} bytes`);
          console.log(`内容预览: ${content.toString('utf-8').substring(0, 200)}...`);
        } else {
          console.log('读取结果:', content);
        }
      } catch (readError) {
        console.error('读取失败:', readError);
      }
    }

  } catch (error) {
    console.error('查询失败:', error);
    process.exit(1);
  }
}

// 主程序
const args = process.argv.slice(2);
const dirPath = args[0] || '/safe/event';

testNexusList(dirPath).catch((error) => {
  console.error('测试失败:', error);
  process.exit(1);
});