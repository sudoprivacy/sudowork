/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getLogsDir } from '@process/utils/mainLogger';
import { ipcBridge } from '../../common';

// 仅导出与 sudowork / scode / sudoclaw 相关的日志文件，跳过 .DS_Store 等无关文件
const LOG_FILE_PATTERN = /^(sudowork\.log|scode\.log|sudoclaw\.log)/;

export function initLogsBridge(): void {
  ipcBridge.logs.listLogFiles.provider(async () => {
    try {
      const dir = getLogsDir();
      const files = readdirSync(dir)
        .filter((name) => LOG_FILE_PATTERN.test(name))
        .map((name) => {
          const path = join(dir, name);
          const stats = statSync(path);
          return { name, path, size: stats.size, isFile: stats.isFile() };
        })
        .filter((entry) => entry.isFile)
        .map(({ name, path, size }) => ({ name, path, size }));

      return { success: true, data: { files } };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
