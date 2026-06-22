/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Form, Input, InputNumber, Message, Modal, Switch, Tooltip } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/storage';
import LanguageSwitcher from '@/renderer/components/LanguageSwitcher';
import ProductImprovementDialog from '@/renderer/components/ProductImprovementDialog';
import { formatTimestamp, joinFilePath } from '@/renderer/pages/conversation/grouped-history/utils/exportHelpers';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useShowToolCalls } from '@/renderer/hooks/useShowToolCalls';

/** Default prompt timeout in seconds */
const DEFAULT_PROMPT_TIMEOUT = 300;
/** Prompt timeout range (seconds) */
const PROMPT_TIMEOUT_MIN = 30;
const PROMPT_TIMEOUT_MAX = 3600;

/** Default idle timeout in minutes */
const DEFAULT_IDLE_TIMEOUT = 5;
/** Idle timeout range (minutes) */
const IDLE_TIMEOUT_MIN = 1;
const IDLE_TIMEOUT_MAX = 60;

/**
 * 目录选择输入组件 / Directory selection input component
 * 用于选择和显示系统目录路径 / Used for selecting and displaying system directory paths
 */
const DirInputItem: React.FC<{
  /** 标签文本 / Label text */
  label: string;
  /** 表单字段名 / Form field name */
  field: string;
}> = ({ label, field }) => {
  const { t } = useTranslation();
  return (
    <Form.Item label={label} field={field}>
      {(value, form) => {
        const currentValue = form.getFieldValue(field) || '';

        const handlePick = () => {
          ipcBridge.dialog.showOpen
            .invoke({
              defaultPath: currentValue,
              properties: ['openDirectory', 'createDirectory'],
            })
            .then((res) => {
              if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
                form.setFieldValue(field, res.data.filePaths[0]);
              }
            })
            .catch((error) => {
              console.error('Failed to open directory dialog:', error);
            });
        };

        return (
          <div className='aion-dir-input h-[32px] flex items-center rounded-8px border border-solid border-transparent pl-14px bg-[var(--fill-0)]'>
            <Tooltip content={currentValue || t('settings.dirNotConfigured')} position='top'>
              <div className='flex-1 min-w-0 text-13px text-foreground truncate '>{currentValue || t('settings.dirNotConfigured')}</div>
            </Tooltip>
            <Button
              type='text'
              style={{ borderLeft: '1px solid var(--color-border-2)', borderRadius: '0 8px 8px 0' }}
              icon={<FolderOpen theme='outline' size='18' fill={'var(--foreground)'} />}
              onClick={(e) => {
                e.stopPropagation();
                handlePick();
              }}
            />
          </div>
        );
      }}
    </Form.Item>
  );
};

/**
 * 偏好设置行组件 / Preference row component
 * 用于显示标签和对应的控件，统一的水平布局 / Used for displaying labels and corresponding controls in a unified horizontal layout
 */
const PreferenceRow: React.FC<{
  /** 标签文本 / Label text */
  label: string;
  /** 控件元素 / Control element */
  children: React.ReactNode;
  /** 提示文本 / Hint text */
  hint?: string;
}> = ({ label, children, hint }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex flex-col'>
      <div className='text-14px text-2'>{label}</div>
      {hint && <div className='text-12px text-secondary opacity-60'>{hint}</div>}
    </div>
    <div className='flex-1 flex justify-end'>{children}</div>
  </div>
);

/**
 * 系统设置内容组件 / System settings content component
 *
 * 提供系统级配置选项，包括语言和目录配置
 * Provides system-level configuration options including language and directory config
 *
 * @features
 * - 语言设置 / Language setting
 * - 高级设置：缓存目录、工作目录配置 / Advanced: cache directory, work directory configuration
 * - 配置变更自动保存 / Auto-save on configuration changes
 */
const SystemModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [modal, modalContextHolder] = Modal.useModal();
  const [error, setError] = useState<string | null>(null);
  const { isEnterprise } = useAppMode();
  const initializingRef = useRef(true);

  // 关闭到托盘状态 / Close to tray state
  const [closeToTray, setCloseToTray] = useState(false);
  const [closeToTrayLoading, setCloseToTrayLoading] = useState(true);
  const [showTokenUsageBadges, setShowTokenUsageBadges] = useState(false);
  const [showTokenUsageBadgesLoading, setShowTokenUsageBadgesLoading] = useState(true);

  // 获取关闭到托盘设置 / Fetch close-to-tray setting
  useEffect(() => {
    ipcBridge.systemSettings.getCloseToTray
      .invoke()
      .then((enabled) => setCloseToTray(enabled))
      .catch(() => {})
      .finally(() => {
        setCloseToTrayLoading(false);
      });
  }, []);

  // 切换关闭到托盘 / Toggle close-to-tray
  const handleCloseToTrayChange = useCallback((checked: boolean) => {
    setCloseToTray(checked);
    // 通过 bridge 设置，provider 会处理持久化和主进程通知
    ipcBridge.systemSettings.setCloseToTray.invoke({ enabled: checked }).catch(() => {
      // 失败时回滚 UI 状态
      setCloseToTray(!checked);
    });
  }, []);

  useEffect(() => {
    ipcBridge.systemSettings.getShowTokenUsageBadges
      .invoke()
      .then((enabled) => setShowTokenUsageBadges(enabled))
      .catch(() => {})
      .finally(() => {
        setShowTokenUsageBadgesLoading(false);
      });
  }, []);

  const handleShowTokenUsageBadgesChange = useCallback((checked: boolean) => {
    setShowTokenUsageBadges(checked);
    ipcBridge.systemSettings.setShowTokenUsageBadges.invoke({ enabled: checked }).catch(() => {
      setShowTokenUsageBadges(!checked);
    });
  }, []);

  // 对话流工具调用显示开关。开关显示解析后的生效值（本地覆盖值 > 企业默认值 > 显示）；
  // 首次切换即写入本地覆盖值，写入成功后通过 changed 事件回流到 hook。
  // Show-tool-calls toggle. The switch displays the resolved effective value
  // (local override > enterprise default > shown); the first toggle writes a
  // local override, which flows back into the hook via the changed event.
  const showToolCalls = useShowToolCalls();
  const [showToolCallsPending, setShowToolCallsPending] = useState<boolean | null>(null);
  const showToolCallsChecked = showToolCallsPending ?? showToolCalls;
  const handleShowToolCallsChange = useCallback((checked: boolean) => {
    setShowToolCallsPending(checked);
    ipcBridge.systemSettings.setShowToolCalls
      .invoke({ enabled: checked })
      .catch(() => {})
      .finally(() => setShowToolCallsPending(null));
  }, []);

  // 桌面 avatar 浮窗开关 / Floating desktop avatar toggle
  const [avatarEnabled, setAvatarEnabled] = useState(false);

  useEffect(() => {
    ipcBridge.systemSettings.getAvatarEnabled
      .invoke()
      .then((enabled) => setAvatarEnabled(enabled))
      .catch(() => {});
  }, []);

  // 导出日志：打包 ~/.nexus/logs/ 下全部日志为 zip / Export all logs under ~/.nexus/logs/ as a zip
  const [isExporting, setIsExporting] = useState(false);

  const handleExportLogs = useCallback(async () => {
    setIsExporting(true);
    try {
      const listRes = await ipcBridge.logs.listLogFiles.invoke();
      if (!listRes.success || !listRes.data || listRes.data.files.length === 0) {
        Message.warning(t('settings.exportLogsEmpty'));
        return;
      }
      const { files } = listRes.data;

      const dirRes = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
      if (!dirRes.success || !dirRes.data || dirRes.data.canceled || dirRes.data.filePaths.length === 0) {
        return;
      }
      const targetDir = dirRes.data.filePaths[0];
      const zipPath = joinFilePath(targetDir, `sudowork-logs-${formatTimestamp()}.zip`);

      const ok = await ipcBridge.fs.createZip.invoke({
        path: zipPath,
        files: files.map((f) => ({ name: f.name, sourcePath: f.path })),
      });
      if (!ok) {
        Message.error(t('settings.exportLogsFailed'));
        return;
      }
      await ipcBridge.shell.showItemInFolder.invoke(zipPath);
      Message.success(t('settings.exportLogsSuccess'));
    } catch (error) {
      console.error('Failed to export logs:', error);
      Message.error(t('settings.exportLogsFailed'));
    } finally {
      setIsExporting(false);
    }
  }, [t]);

  const handleAvatarEnabledChange = useCallback((checked: boolean) => {
    setAvatarEnabled(checked);
    ipcBridge.systemSettings.setAvatarEnabled.invoke({ enabled: checked }).catch(() => {
      setAvatarEnabled(!checked);
    });
  }, []);

  // 产品体验改进计划状态 / Product improvement program state
  const [productImprovementEnabled, setProductImprovementEnabled] = useState(false);
  const [productImprovementLoading, setProductImprovementLoading] = useState(true);
  const [showProductImprovementDialog, setShowProductImprovementDialog] = useState(false);

  // 获取产品体验改进计划设置 / Fetch product improvement setting
  useEffect(() => {
    if (isEnterprise) {
      setProductImprovementEnabled(false);
      setProductImprovementLoading(false);
      setShowProductImprovementDialog(false);
      return;
    }

    ipcBridge.telemetry.getStatus
      .invoke()
      .then((res) => {
        if (res.success && res.data) {
          setProductImprovementEnabled(res.data.enabled);
        }
      })
      .catch(() => {})
      .finally(() => {
        setProductImprovementLoading(false);
      });
  }, [isEnterprise]);

  // 处理产品体验改进计划开关变更 / Handle product improvement toggle change
  const handleProductImprovementChange = useCallback((checked: boolean) => {
    if (checked) {
      // 开启时先弹出告知弹窗
      setShowProductImprovementDialog(true);
    } else {
      // 关闭时直接保存
      setProductImprovementEnabled(false);
      ipcBridge.telemetry.setEnabled.invoke({ enabled: false }).catch(() => {
        // 失败时回滚 UI 状态
        setProductImprovementEnabled(true);
      });
    }
  }, []);

  // 弹窗确认处理 / Dialog confirm handler
  const handleProductImprovementDialogClose = useCallback((confirmed: boolean) => {
    setShowProductImprovementDialog(false);
    if (confirmed) {
      setProductImprovementEnabled(true);
      ipcBridge.telemetry.setEnabled.invoke({ enabled: true }).catch(() => {
        // 失败时回滚 UI 状态
        setProductImprovementEnabled(false);
      });
    }
  }, []);

  // 超时设置状态 / Timeout settings state
  const [promptTimeout, setPromptTimeout] = useState(DEFAULT_PROMPT_TIMEOUT);
  const [idleTimeout, setIdleTimeout] = useState(DEFAULT_IDLE_TIMEOUT);

  // 获取超时设置 / Fetch timeout settings
  useEffect(() => {
    ConfigStorage.get('agent.promptTimeout')
      .then((value) => {
        if (value && value > 0) {
          setPromptTimeout(Math.max(PROMPT_TIMEOUT_MIN, Math.min(PROMPT_TIMEOUT_MAX, value)));
        }
      })
      .catch(() => {});
    ConfigStorage.get('agent.idleTimeout')
      .then((value) => {
        if (value && value > 0) {
          setIdleTimeout(Math.max(IDLE_TIMEOUT_MIN, Math.min(IDLE_TIMEOUT_MAX, value)));
        }
      })
      .catch(() => {});
  }, []);

  // 保存 promptTimeout（失焦时校验范围） / Save promptTimeout on blur with range clamping
  const handlePromptTimeoutBlur = useCallback(() => {
    const clamped = Math.max(PROMPT_TIMEOUT_MIN, Math.min(PROMPT_TIMEOUT_MAX, promptTimeout));
    setPromptTimeout(clamped);
    ConfigStorage.set('agent.promptTimeout', clamped).catch(() => {});
  }, [promptTimeout]);

  // 保存 idleTimeout（失焦时校验范围） / Save idleTimeout on blur with range clamping
  const handleIdleTimeoutBlur = useCallback(() => {
    const clamped = Math.max(IDLE_TIMEOUT_MIN, Math.min(IDLE_TIMEOUT_MAX, idleTimeout));
    setIdleTimeout(clamped);
    ConfigStorage.set('agent.idleTimeout', clamped).catch(() => {});
  }, [idleTimeout]);

  // 右栏浏览器默认主页 / Right-panel browser default homepage
  const [browserDefaultUrl, setBrowserDefaultUrl] = useState<string>('');

  useEffect(() => {
    ipcBridge.systemSettings.getBrowserDefaultUrl
      .invoke()
      .then((url) => {
        if (typeof url === 'string') setBrowserDefaultUrl(url);
      })
      .catch(() => {});
  }, []);

  const handleBrowserDefaultUrlBlur = useCallback(() => {
    const trimmed = browserDefaultUrl.trim();
    if (!trimmed) return; // empty input — leave previous value, don't persist
    ipcBridge.systemSettings.setBrowserDefaultUrl.invoke({ url: trimmed }).catch(() => {});
  }, [browserDefaultUrl]);

  // Get system directory info
  const { data: systemInfo } = useSWR('system.dir.info', () => ipcBridge.application.systemInfo.invoke());

  // Initialize form data
  useEffect(() => {
    if (systemInfo) {
      initializingRef.current = true;
      // Initialize both cacheDir and workDir, but cacheDir will be disabled in UI
      form.setFieldsValue({ cacheDir: systemInfo.cacheDir, workDir: systemInfo.workDir });
      // Allow onValuesChange to fire after initialization settles
      requestAnimationFrame(() => {
        initializingRef.current = false;
      });
    }
  }, [systemInfo, form]);

  // 偏好设置项配置 / Preference items configuration
  const preferenceItems = [
    { key: 'language', label: t('settings.language'), component: <LanguageSwitcher /> },
    {
      key: 'closeToTray',
      label: t('settings.closeToTray'),
      component: closeToTrayLoading ? <div style={{ width: 44, height: 22 }} /> : <Switch checked={closeToTray} onChange={handleCloseToTrayChange} className='settings-accent-switch' style={closeToTray ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />,
    },
    ...(isEnterprise
      ? []
      : [
          {
            key: 'showTokenUsageBadges',
            label: t('settings.showTokenUsageBadges'),
            hint: t('settings.showTokenUsageBadgesDesc'),
            component: showTokenUsageBadgesLoading ? <div style={{ width: 44, height: 22 }} /> : <Switch checked={showTokenUsageBadges} onChange={handleShowTokenUsageBadgesChange} className='settings-accent-switch' style={showTokenUsageBadges ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />,
          },
        ]),
    {
      key: 'showToolCalls',
      label: t('settings.showToolCalls'),
      hint: t('settings.showToolCallsDesc'),
      component: <Switch checked={showToolCallsChecked} onChange={handleShowToolCallsChange} className='settings-accent-switch' style={showToolCallsChecked ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />,
    },
    {
      key: 'avatarEnabled',
      label: t('settings.avatarEnabled'),
      hint: t('settings.avatarEnabledDesc'),
      component: <Switch checked={avatarEnabled} onChange={handleAvatarEnabledChange} className='settings-accent-switch' style={avatarEnabled ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />,
    },
    ...(isEnterprise
      ? []
      : [
          {
            key: 'productImprovement',
            label: t('settings.productImprovement.title'),
            hint: t('settings.productImprovement.hint'),
            component: productImprovementLoading ? <div style={{ width: 44, height: 22 }} /> : <Switch checked={productImprovementEnabled} onChange={handleProductImprovementChange} className='settings-accent-switch' style={productImprovementEnabled ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />,
          },
        ]),
    {
      key: 'promptTimeout',
      label: t('settings.promptTimeout'),
      hint: t('settings.promptTimeoutDesc'),
      component: <InputNumber value={promptTimeout} onChange={setPromptTimeout} onBlur={handlePromptTimeoutBlur} min={PROMPT_TIMEOUT_MIN} max={PROMPT_TIMEOUT_MAX} step={30} style={{ width: 120 }} suffix='s' />,
    },
    {
      key: 'idleTimeout',
      label: t('settings.idleTimeout'),
      hint: t('settings.idleTimeoutDesc'),
      component: <InputNumber value={idleTimeout} onChange={setIdleTimeout} onBlur={handleIdleTimeoutBlur} min={IDLE_TIMEOUT_MIN} max={IDLE_TIMEOUT_MAX} step={5} style={{ width: 120 }} suffix='min' />,
    },
    {
      key: 'browserDefaultUrl',
      label: t('settings.browserDefaultUrl'),
      hint: t('settings.browserDefaultUrlDesc'),
      component: <Input value={browserDefaultUrl} onChange={setBrowserDefaultUrl} onBlur={handleBrowserDefaultUrlBlur} placeholder='https://www.baidu.com/' style={{ width: 260 }} />,
    },
    {
      key: 'exportLogs',
      label: t('settings.exportLogs'),
      hint: t('settings.exportLogsDesc'),
      component: (
        <Button onClick={handleExportLogs} loading={isExporting} disabled={isExporting}>
          {t('settings.exportLogs')}
        </Button>
      ),
    },
  ];

  // 目录配置保存确认 / Directory configuration save confirmation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveDirConfigValidate = (_values: { cacheDir: string; workDir: string }): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      modal.confirm({
        title: t('settings.updateConfirm'),
        content: t('settings.restartConfirm'),
        onOk: resolve,
        onCancel: reject,
      });
    });
  };

  // Auto-save: when directory changes, prompt for restart
  const savingRef = useRef(false);

  const handleValuesChange = useCallback(
    async (_changedValue: unknown, allValues: Record<string, string>) => {
      if (initializingRef.current || savingRef.current || !systemInfo) return;
      const { cacheDir, workDir } = allValues;
      const needsRestart = workDir !== systemInfo.workDir; // Only workDir changes trigger restart since cacheDir is disabled in UI
      if (!needsRestart) return;

      savingRef.current = true;
      setError(null);
      try {
        await saveDirConfigValidate({ cacheDir, workDir });
        const result = await ipcBridge.application.updateSystemInfo.invoke({ cacheDir, workDir });
        if (result.success) {
          await ipcBridge.application.restart.invoke();
        } else {
          setError(result.msg || 'Failed to update system info');
          // Revert form to original values on failure
          form.setFieldValue('cacheDir', systemInfo.cacheDir);
          form.setFieldValue('workDir', systemInfo.workDir);
        }
      } catch (caughtError: unknown) {
        // User cancelled the confirm dialog — revert
        form.setFieldValue('cacheDir', systemInfo.cacheDir);
        form.setFieldValue('workDir', systemInfo.workDir);
        if (caughtError) {
          setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        }
      } finally {
        savingRef.current = false;
      }
    },
    [systemInfo, form, saveDirConfigValidate]
  );

  return (
    <div className='flex flex-col h-full w-full'>
      {modalContextHolder}

      {/* 产品体验改进计划弹窗 / Product improvement dialog */}
      <ProductImprovementDialog visible={showProductImprovementDialog} onClose={handleProductImprovementDialogClose} />

      {/* 内容区域 / Content Area */}
      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow>
        <div className='space-y-16px'>
          {/* 偏好设置与高级设置合并展示 / Combined preferences and advanced settings */}
          <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-12px'>
            <div className='w-full flex flex-col divide-y divide-light'>
              {preferenceItems.map((item) => (
                <PreferenceRow key={item.key} label={item.label} hint={item.hint}>
                  {item.component}
                </PreferenceRow>
              ))}
            </div>
            <Form form={form} layout='vertical' className='space-y-16px' onValuesChange={handleValuesChange}>
              {/* <DirInputItem label={t('settings.cacheDir')} field='cacheDir' /> */} {/* Cache directory setting temporarily disabled */}
              <DirInputItem label={t('settings.workDir')} field='workDir' />
              {error && <Alert className='mt-16px' type='error' content={typeof error === 'string' ? error : JSON.stringify(error)} />}
            </Form>
          </div>
        </div>
      </AionScrollArea>
    </div>
  );
};

export default SystemModalContent;
