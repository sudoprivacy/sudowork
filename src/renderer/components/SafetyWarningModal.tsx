/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Modal } from '@arco-design/web-react';
import { IconInfoCircle, IconLink, IconFile, IconCode } from '@arco-design/web-react/icon';
import React, { useEffect, useState } from 'react';
import type { SafetyStatus, NetworkEventData, FileEventData, ProcessEventData } from '@/common/safetyTypes';

export interface SafetyWarningModalProps {
  visible: boolean;
  status: SafetyStatus;
  onConfirm: () => void;
  onCancel: () => void;
}

const COUNTDOWN_SECONDS = 10;

// Icons for event types
const eventTypeIcons: Record<string, React.ReactNode> = {
  network: <IconLink style={{ marginRight: 8 }} />,
  file: <IconFile style={{ marginRight: 8 }} />,
  process: <IconCode style={{ marginRight: 8 }} />,
};

export const SafetyWarningModal: React.FC<SafetyWarningModalProps> = ({ visible, status, onConfirm, onCancel }) => {
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  const t = (key: string) => {
    const translations: Record<string, string> = {
      'safety.warning': '安全警告',
      'safety.riskDetected': '检测到安全风险',
      'safety.riskDetails': '风险详情',
      'safety.riskCode': '风险代码',
      'safety.riskMessage': '风险消息',
      'safety.detectedAt': '检测时间',
      'safety.confirmContinue': '确认继续',
      'safety.deny': '拒绝',
      'safety.pleaseReviewRisk': '请审查以下风险并决定是否继续',
      'safety.waitingForConfirmation': '正在等待您的确认...',
      'safety.autoConfirmIn': '秒后自动确认',
      'safety.eventType': '事件类型',
      'safety.networkRequest': '网络请求',
      'safety.fileOperation': '文件操作',
      'safety.processExecution': '进程执行',
      'safety.url': 'URL',
      'safety.method': '方法',
      'safety.headers': '请求头',
      'safety.body': '请求体',
      'safety.filePath': '文件路径',
      'safety.fileFlags': '操作标志',
      'safety.command': '命令',
      'safety.arguments': '参数',
    };
    return translations[key] || key;
  };

  // Countdown timer for auto-confirm
  useEffect(() => {
    if (!visible) {
      setCountdown(COUNTDOWN_SECONDS);
      return;
    }

    // Reset countdown when modal opens
    setCountdown(COUNTDOWN_SECONDS);

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          // Auto-confirm after countdown
          onConfirm();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [visible, onConfirm]);

  const formatDetectedAt = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatEventType = (type: string): string => {
    const typeMap: Record<string, string> = {
      network: t('safety.networkRequest'),
      file: t('safety.fileOperation'),
      process: t('safety.processExecution'),
    };
    return typeMap[type] || type;
  };

  const formatFileFlags = (flags: string[]): string => {
    const flagDescriptions: Record<string, string> = {
      O_RDONLY: '只读',
      O_WRONLY: '只写',
      O_RDWR: '读写',
      O_CREAT: '不存在则创建',
      O_EXCL: '创建若存在则失败',
      O_TRUNC: '截断写',
      O_APPEND: '追加写',
      O_DIRECTORY: '打开目录',
      O_NOATIME: '读不更新 atime',
      O_NOFOLLOW: '读若符号链接则失败',
      O_SYNC: '同步 io',
      O_DSYNC: '同步 io',
      O_SYMLINK: '打开符号链接本身',
      O_DIRECT: '绕开系统缓存 io',
      O_NONBLOCK: '非阻塞 io',
      O_NOCTTY: '未知',
      REMOVE: '删除',
      RENAME: '重命名',
    };

    return flags.map((flag) => `${flag}${flagDescriptions[flag] ? ` (${flagDescriptions[flag]})` : ''}`).join(', ');
  };

  // Render network event details
  const renderNetworkDetails = (data: NetworkEventData) => (
    <div style={{ marginTop: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.url')}:</strong>
        <span style={{ color: 'var(--color-text-2)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{data.url}</span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.method')}:</strong>
        <span style={{ color: 'var(--color-text-2)', fontFamily: 'monospace' }}>{data.method}</span>
      </div>
      {data.headers && Object.keys(data.headers).length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.headers')}:</strong>
          <pre
            style={{
              marginTop: 4,
              padding: 8,
              backgroundColor: 'var(--color-fill-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'monospace',
              overflow: 'auto',
              maxHeight: 100,
            }}
          >
            {JSON.stringify(data.headers, null, 2)}
          </pre>
        </div>
      )}
      {data.body && data.body.trim() && (
        <div style={{ marginBottom: 8 }}>
          <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.body')}:</strong>
          <pre
            style={{
              marginTop: 4,
              padding: 8,
              backgroundColor: 'var(--color-fill-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'monospace',
              overflow: 'auto',
              maxHeight: 100,
            }}
          >
            {data.body}
          </pre>
        </div>
      )}
    </div>
  );

  // Render file event details
  const renderFileDetails = (data: FileEventData) => (
    <div style={{ marginTop: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.filePath')}:</strong>
        <span style={{ color: 'var(--color-text-2)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{data.path}</span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.fileFlags')}:</strong>
        <span style={{ color: 'var(--color-text-2)', fontFamily: 'monospace' }}>{formatFileFlags(data.flags)}</span>
      </div>
    </div>
  );

  // Render process event details
  const renderProcessDetails = (data: ProcessEventData) => (
    <div style={{ marginTop: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.command')}:</strong>
        <span style={{ color: 'var(--color-text-2)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{data.command}</span>
      </div>
      {data.args && data.args.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.arguments')}:</strong>
          <pre
            style={{
              marginTop: 4,
              padding: 8,
              backgroundColor: 'var(--color-fill-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'monospace',
              overflow: 'auto',
              maxHeight: 100,
            }}
          >
            {data.args.join('\n')}
          </pre>
        </div>
      )}
    </div>
  );

  return (
    <Modal
      visible={visible}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconInfoCircle style={{ color: 'var(--warning)' }} />
          <span>{t('safety.warning')}</span>
        </div>
      }
      closable={false}
      maskClosable={false}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={countdown > 0 ? `${t('safety.confirmContinue')} (${countdown}${t('safety.autoConfirmIn')})` : t('safety.confirmContinue')}
      cancelText={t('safety.deny')}
      style={{ width: 600 }}
    >
      <div style={{ padding: '8px 0' }}>
        <p style={{ marginBottom: 16, color: 'var(--color-text-2)' }}>{t('safety.pleaseReviewRisk')}</p>

        <div
          style={{
            backgroundColor: 'var(--color-fill-2)',
            borderRadius: 'var(--radius-md)',
            padding: 16,
            marginBottom: 16,
          }}
        >
          {status.eventType && (
            <div style={{ marginBottom: 12 }}>
              <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.eventType')}:</strong>
              <span style={{ color: 'var(--color-text-2)' }}>
                {eventTypeIcons[status.eventType]}
                {formatEventType(status.eventType)}
              </span>
            </div>
          )}

          {status.details && (
            <>
              <div style={{ marginBottom: 8 }}>
                <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.riskCode')}:</strong>
                <span style={{ color: 'var(--color-text-2)', fontFamily: 'monospace' }}>{status.details.code}</span>
              </div>

              <div style={{ marginBottom: 8 }}>
                <strong style={{ color: 'var(--color-text-1)', marginRight: 8 }}>{t('safety.riskMessage')}:</strong>
                <span style={{ color: 'var(--color-text-2)' }}>{status.details.message}</span>
              </div>

              {status.details.networkData && renderNetworkDetails(status.details.networkData)}
              {status.details.fileData && renderFileDetails(status.details.fileData)}
              {status.details.processData && renderProcessDetails(status.details.processData)}

              {status.details.detectedAt && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-text-3)', fontSize: 12, marginTop: 8 }}>
                  <span>🕐 {formatDetectedAt(status.details.detectedAt)}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-3)',
            textAlign: 'center',
            fontStyle: 'italic',
          }}
        >
          {t('safety.waitingForConfirmation')}
        </div>
      </div>
    </Modal>
  );
};
