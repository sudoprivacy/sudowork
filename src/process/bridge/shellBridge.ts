/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { shell } from 'electron';
import { ipcBridge } from '../../common';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { exec } from 'child_process';

export function initShellBridge(): void {
  ipcBridge.shell.openFile.provider(async (path) => {
    await shell.openPath(path);
  });

  ipcBridge.shell.showItemInFolder.provider((path) => {
    shell.showItemInFolder(path);
    return Promise.resolve();
  });

  ipcBridge.shell.openExternal.provider((url) => {
    return shell.openExternal(url);
  });

  // 打开系统通知设置 / Open system notification settings
  ipcBridge.shell.openSystemNotificationSettings.provider(async () => {
    try {
      if (process.platform === 'darwin') {
        // macOS 15+ (Sequoia): 系统设置(System Settings)而非系统偏好设置(System Preferences)
        mainLog('ShellBridge', 'Opening macOS notification settings');
        // macOS Sequoia 使用 System Settings，pane ID 为 com.apple.notifications-settings
        exec(
          'osascript -e \'tell application "System Settings"\' -e \'activate\' -e \'end tell\'',
          (error) => {
            if (error) {
              mainWarn('ShellBridge', 'Failed to open System Settings:', error);
              // 备用方案：直接打开系统设置应用
              exec('open "/System/Applications/System Settings.app"', (err2) => {
                if (err2) {
                  mainWarn('ShellBridge', 'Failed to open System Settings app:', err2);
                }
              });
            }
          }
        );
        // 打开后尝试导航到通知设置
        exec('open "x-apple-systemsettings:com.apple.notifications-settings"', (error) => {
          if (error) {
            mainLog('ShellBridge', 'Direct notification settings URL not available, opened System Settings instead');
          }
        });
      } else if (process.platform === 'win32') {
        // Windows: 打开系统通知设置
        mainLog('ShellBridge', 'Opening Windows notification settings');
        exec('start ms-settings:notifications', (error) => {
          if (error) {
            mainWarn('ShellBridge', 'Failed to open Windows notification settings:', error);
          }
        });
      }
    } catch (error) {
      mainWarn('ShellBridge', 'Failed to open system notification settings:', error);
    }
  });
}
