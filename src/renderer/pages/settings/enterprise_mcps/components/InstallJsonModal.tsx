/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Message, Alert, Button, Input, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { useThemeContext } from '@/renderer/context/ThemeContext';
import { useEnterpriseMcpClient } from '../hooks/useEnterpriseMcpClient';
import { normalizeInstallError } from '../utils/normalizeError';

interface InstallJsonModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

const InstallJsonModal: React.FC<InstallJsonModalProps> = ({ visible, onCancel, onSuccess }) => {
  const { t } = useTranslation();
  const { theme } = useThemeContext();
  const { servers: serversApi } = useEnterpriseMcpClient();

  const [name, setName] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [validation, setValidation] = useState<ValidationResult>({ isValid: true });

  // JSON 语法校验
  const validateJsonSyntax = useCallback((input: string): ValidationResult => {
    if (!input.trim()) {
      return { isValid: true };
    }
    try {
      JSON.parse(input);
      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        errorMessage: error instanceof SyntaxError ? error.message : 'Invalid JSON format',
      };
    }
  }, []);

  // 实时校验
  useEffect(() => {
    setValidation(validateJsonSyntax(jsonInput));
  }, [jsonInput, validateJsonSyntax]);

  // 打开时清空状态
  useEffect(() => {
    if (visible) {
      setName('');
      setJsonInput('');
      setLoading(false);
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (loading) return;

    // 校验：JSON 不能为空
    if (!jsonInput.trim()) {
      Message.error('请输入 JSON 配置');
      return;
    }

    // 校验：JSON 格式必须正确
    if (!validation.isValid) {
      Message.error('JSON 格式错误，请检查后重试');
      return;
    }

    setLoading(true);
    try {
      const result = await serversApi.installJson(jsonInput, name.trim() || undefined);

      if (result._requires_approval) {
        Message.info(t('settings.mcpInstallApprovalRequired', { defaultValue: '此 MCP 需要管理员审批后才可使用' }));
      } else {
        Message.success(t('settings.mcpInstallJsonSuccess', { defaultValue: '安装成功' }));
      }

      onSuccess();
    } catch (err) {
      const norm = normalizeInstallError(err);
      Message.error(norm.message);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  const canSubmit = !loading;

  return (
    <Modal visible={visible} onCancel={onCancel} onOk={handleSubmit} okText='安装' cancelText='取消' okButtonProps={{ disabled: !canSubmit, loading }} title={t('settings.mcpInstallJsonTitle', { defaultValue: '安装 MCP' })} style={{ width: 600 }}>
      <div style={{ padding: '24px', background: 'var(--bg-1)', overflow: 'auto', maxHeight: '60vh', borderRadius: 16 }}>
        <div className='space-y-3'>
          {/* 名称输入框 */}
          <div>
            <div className='mb-2 text-sm text-secondary'>{t('settings.mcpInstallJsonName', { defaultValue: '名称（选填）' })}</div>
            <Input value={name} onChange={setName} placeholder={t('settings.mcpInstallJsonNamePlaceholder', { defaultValue: '留空则从 JSON 中自动提取' })} style={{ marginBottom: 12 }} />
          </div>

          {/* JSON 编辑器 */}
          <div>
            <div className='mb-2 text-sm text-secondary'>从 MCP 服务介绍页面复制 JSON 配置，并粘贴到下面的输入框中。（必填）</div>
            <div className='relative'>
              <CodeMirror
                value={jsonInput}
                height='240px'
                theme={theme}
                extensions={[json()]}
                onChange={(value: string) => setJsonInput(value)}
                placeholder={`{
  "mcpServers": {
    "weather": {
      "command": "uv",
      "args": ["--directory", "/path/to/weather", "run", "weather.py"]
    }
  }
}`}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  dropCursor: false,
                  allowMultipleSelections: false,
                }}
                style={{
                  fontSize: '13px',
                  border: validation.isValid || !jsonInput.trim() ? '1px solid var(--bg-3)' : '1px solid var(--danger)',
                  borderRadius: '6px',
                  marginBottom: '12px',
                  overflow: 'hidden',
                }}
                className='[&_.cm-editor]:rounded-[6px]'
              />
              {jsonInput && (
                <Button
                  size='mini'
                  type='outline'
                  className='absolute top-2 right-2 z-10'
                  onClick={() => {
                    const copyToClipboard = async () => {
                      try {
                        if (navigator.clipboard && window.isSecureContext) {
                          await navigator.clipboard.writeText(jsonInput);
                        } else {
                          const textArea = document.createElement('textarea');
                          textArea.value = jsonInput;
                          textArea.style.position = 'fixed';
                          textArea.style.left = '-9999px';
                          textArea.style.top = '-9999px';
                          document.body.appendChild(textArea);
                          textArea.focus();
                          textArea.select();
                          document.execCommand('copy');
                          document.body.removeChild(textArea);
                        }
                        setCopyStatus('success');
                        setTimeout(() => setCopyStatus('idle'), 2000);
                      } catch (err) {
                        console.error('Copy failed:', err);
                        setCopyStatus('error');
                        setTimeout(() => setCopyStatus('idle'), 2000);
                      }
                    };
                    void copyToClipboard();
                  }}
                  style={{ backdropFilter: 'blur(4px)' }}
                >
                  {copyStatus === 'success' ? t('common.copySuccess') : copyStatus === 'error' ? t('common.copyFailed') : t('common.copy')}
                </Button>
              )}
            </div>

            {/* JSON 格式错误提示 */}
            {!validation.isValid && jsonInput.trim() && <div className='mt-2 text-sm text-red-600'>{t('settings.mcpJsonFormatError') || 'JSON format error'}</div>}
          </div>

          <Alert
            type='info'
            showIcon
            content={
              <div>
                <div>{t('settings.mcpImportTips')}</div>
                <ul className='list-disc pl-5 mt-2 space-y-1 text-sm'>
                  <li>{t('settings.mcpImportTip1')}</li>
                  <li>{t('settings.mcpImportTip2')}</li>
                </ul>
              </div>
            }
          />
        </div>
      </div>
    </Modal>
  );
};

export default InstallJsonModal;
