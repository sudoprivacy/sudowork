/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Nexus RPC 读写测试脚本
 *
 * 测试写入、列表、读取的完整流程
 *
 * 使用方法：bunx tsx tests/test-nexus-rw.ts
 */

import { getNexusRpcClient } from '../src/common/nexus';

const EVENT_DIR = '/safe/event';

/**
 * 生成 32 位 UUID 字符串
 */
function generateUuid(): string {
  const chars = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 32; i++) {
    uuid += chars.charAt(Math.floor(Math.random() * 16));
  }
  return uuid;
}

async function testNexusRW() {
  console.log('\n========================================');
  console.log('  Nexus RPC 读写测试');
  console.log('========================================\n');

  const client = getNexusRpcClient();
  const testUuid = generateUuid();
  const testPath = `${EVENT_DIR}/${testUuid}`;
  const testContent = JSON.stringify({
    type: 'network',
    data: {
      requestId: `test_${Date.now()}`,
      url: 'https://test.example.com',
      method: 'GET',
      headers: {},
      body: ''
    }
  }, null, 2);

  console.log(`测试 UUID: ${testUuid}`);
  console.log(`测试路径: ${testPath}\n`);

  // 1. 创建目录
  console.log('Step 1: 创建目录...');
  try {
    await client.mkdir(EVENT_DIR, true);
    console.log('✓ 目录已创建/存在\n');
  } catch (e) {
    console.log('✓ 目录已存在\n');
  }

  // 2. 写入文件
  console.log('Step 2: 写入测试文件...');
  try {
    await client.write(testPath, testContent);
    console.log(`✓ 文件已写入: ${testPath}\n`);
  } catch (error) {
    console.error('❌ 写入失败:', error);
    process.exit(1);
  }

  // 3. 列出目录
  console.log('Step 3: 列出目录内容...');
  try {
    const items = await client.list(EVENT_DIR);
    console.log(`✓ 找到 ${items.length} 个文件`);
    items.forEach((item, i) => {
      console.log(`  [${i}] name="${item.name}", path="${item.path}"`);
    });
    console.log();
  } catch (error) {
    console.error('❌ 列出失败:', error);
    process.exit(1);
  }

  // 4. 检查文件是否存在
  console.log('Step 4: 检查文件是否存在...');
  try {
    const exists = await client.exists(testPath);
    console.log(`✓ 文件存在: ${exists}\n`);
  } catch (error) {
    console.error('❌ 检查存在失败:', error);
    console.log();
  }

  // 5. 读取文件
  console.log('Step 5: 读取测试文件...');
  try {
    const result = await client.read(testPath, false);
    if (Buffer.isBuffer(result)) {
      console.log('✓ 文件内容:');
      console.log(result.toString('utf-8'));
      console.log();
    } else {
      console.log('✓ 文件内容 (object):', result);
      console.log();
    }
  } catch (error) {
    console.error('❌ 读取失败:', error);
    process.exit(1);
  }

  // 6. 删除文件
  console.log('Step 6: 删除测试文件...');
  try {
    await client.delete(testPath);
    console.log(`✓ 文件已删除: ${testPath}\n`);
  } catch (error) {
    console.error('❌ 删除失败:', error);
  }

  console.log('========================================');
  console.log('  测试完成');
  console.log('========================================\n');
}

testNexusRW().catch((error) => {
  console.error('测试失败:', error);
  process.exit(1);
});