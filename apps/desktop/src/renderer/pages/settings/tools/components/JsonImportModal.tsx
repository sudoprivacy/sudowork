/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Modal } from '@arco-design/web-react';
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import type { IMcpServer, IMcpServerTransport, IMcpTool } from '@/common/storage';
import { useThemeContext } from '@/renderer/context/ThemeContext';
import type { IValidationResult } from '../types';

const JsonImportModal: React.FC<IJsonImportModalProps> = ({ visible, server, onCancel, onSubmit, onBatchImport }) => {
  const { t } = useTranslation();
  const { theme } = useThemeContext();
  const [jsonInput, setJsonInput] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [validation, setValidation] = useState<IValidationResult>({ isValid: true });

  /**
   * JSON语法校验
   */
  const validateJsonSyntax = useCallback((input: string): IValidationResult => {
    if (!input.trim()) {
      return { isValid: true }; // 空值视为有效
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

  // 监听 jsonInput 变化，实时更新校验结果
  React.useEffect(() => {
    setValidation(validateJsonSyntax(jsonInput));
  }, [jsonInput, validateJsonSyntax]);

  // 当编辑现有服务器时，预填充JSON数据
  React.useEffect(() => {
    if (visible && server) {
      // 优先使用存储的originalJson，如果没有则生成JSON配置
      if (server.originalJson) {
        setJsonInput(server.originalJson);
      } else {
        // 兼容没有originalJson的旧数据，生成JSON配置
        const serverConfig = {
          mcpServers: {
            [server.name]: {
              description: server.description,
              ...(server.transport.type === 'stdio'
                ? {
                    command: server.transport.command,
                    args: server.transport.args || [],
                    env: server.transport.env || {},
                  }
                : {
                    type: server.transport.type,
                    url: server.transport.url,
                    ...(server.transport.headers && { headers: server.transport.headers }),
                  }),
            },
          },
        };
        setJsonInput(JSON.stringify(serverConfig, null, 2));
      }
    } else if (visible && !server) {
      // 新建模式下清空JSON输入
      setJsonInput('');
    }
  }, [visible, server]);

  /**
   * Parse transport config from JSON server config.
   * Supports both "type" field (standard) and "transport" field (Gemini CLI format).
   */
  const parseTransport = (serverConfig: Record<string, any>): IMcpServerTransport => {
    if (serverConfig.command) {
      return {
        type: 'stdio',
        command: serverConfig.command,
        args: serverConfig.args || [],
        env: serverConfig.env || {},
      };
    }

    // Check both "type" and "transport" fields for transport type detection
    // Gemini CLI uses "transport" field, standard format uses "type" field
    const transportType = serverConfig.type || serverConfig.transport;

    if (transportType === 'sse' || serverConfig.url?.includes('/sse')) {
      return { type: 'sse', url: serverConfig.url, headers: serverConfig.headers };
    }
    if (transportType === 'streamable_http') {
      return { type: 'streamable_http', url: serverConfig.url, headers: serverConfig.headers };
    }
    return { type: 'http', url: serverConfig.url, headers: serverConfig.headers };
  };

  const handleSubmit = () => {
    // 语法校验已经通过了（按钮禁用逻辑保证），直接解析
    const config = JSON.parse(jsonInput);
    const mcpServers = config.mcpServers || config;

    if (Array.isArray(mcpServers)) {
      // TODO: 支持数组格式的导入
      console.warn('Array format not supported yet');
      return;
    }

    const serverKeys = Object.keys(mcpServers);
    if (serverKeys.length === 0) {
      console.warn('No MCP server found in configuration');
      return;
    }

    // 如果有多个服务器，使用批量导入
    if (serverKeys.length > 1 && onBatchImport) {
      const serversToImport = serverKeys.map((serverKey) => {
        const serverConfig = mcpServers[serverKey];
        return {
          name: serverKey,
          description: serverConfig.description || `Imported from JSON`,
          enabled: true,
          transport: parseTransport(serverConfig),
          status: 'disconnected' as const,
          tools: [] as IMcpTool[], // JSON导入时初始化为空数组，后续可通过连接测试获取
          originalJson: JSON.stringify({ mcpServers: { [serverKey]: serverConfig } }, null, 2),
        };
      });

      onBatchImport(serversToImport);
      onCancel();
      return;
    }

    // 单个服务器导入
    const firstServerKey = serverKeys[0];
    const serverConfig = mcpServers[firstServerKey];

    onSubmit({
      name: firstServerKey,
      description: serverConfig.description || 'Imported from JSON',
      enabled: true,
      transport: parseTransport(serverConfig),
      status: 'disconnected',
      tools: [] as IMcpTool[], // JSON导入时初始化为空数组，后续可通过连接测试获取
      originalJson: jsonInput,
    });
    onCancel();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      okButtonProps={{ disabled: !validation.isValid }}
      title={server ? t('settings.mcpEditServer', '编辑') : t('settings.mcpImportFromJSON', '从 JSON 导入')}
      style={{ width: 600 }}
      okText={t('common.confirm', '确定')}
      cancelText={t('common.cancel', '取消')}
    >
      <div className='space-y-3'>
        <div>
          <div className='mb-2 text-sm text-secondary'>{t('settings.mcpImportPlaceholder', '从 MCP 服务介绍页面复制 JSON 配置（最好是 NPX 或 UVX 配置），并粘贴到下面的输入框中。')}</div>
          <div className='relative'>
            <CodeMirror
              value={jsonInput}
              height='300px'
              theme={theme}
              extensions={[json()]}
              onChange={(value: string) => setJsonInput(value)}
              placeholder={`{
  "mcpServers": {
    "weather": {
      "command": "uv",
      "args": ["--directory", "/path/to/weather", "run", "weather.py"],
      "description": "Weather information server"
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
                border: validation.isValid || !jsonInput.trim() ? '1px solid var(--border-light)' : '1px solid var(--danger)',
                borderRadius: '6px',
                marginBottom: '20px',
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
                        // Fallback to legacy method 降级到传统方法
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
                      console.error('Copy failed 复制失败:', err);
                      setCopyStatus('error');
                      setTimeout(() => setCopyStatus('idle'), 2000);
                    }
                  };

                  void copyToClipboard();
                }}
                style={{
                  backdropFilter: 'blur(4px)',
                }}
              >
                {copyStatus === 'success' ? t('common.copySuccess', '已复制') : copyStatus === 'error' ? t('common.copyFailed', '复制失败') : t('common.copy', '复制')}
              </Button>
            )}
          </div>

          {/* JSON 格式错误提示 */}
          {!validation.isValid && jsonInput.trim() && <div className='mt-2 text-sm text-danger'>{t('settings.mcpJsonFormatError', 'JSON 格式错误')}</div>}
        </div>

        <Alert
          type='info'
          title={t('settings.mcpImportTips', '导入提示')}
          content={
            <div>
              <ul className='list-disc pl-5 mt-2 space-y-1 text-sm'>
                <li>{t('settings.mcpImportTip1', '请使用包含顶层 "mcpServers" 字段的有效 JSON 对象。')}</li>
                <li>{t('settings.mcpImportTip2', '每个服务需定义 "command"（stdio）或 "url"（http/sse）之一。')}</li>
                <li>{t('settings.mcpImportTip3', '支持一次导入多个服务。')}</li>
              </ul>
            </div>
          }
        />
      </div>
    </Modal>
  );
};

export default JsonImportModal;

interface IJsonImportModalProps {
  visible: boolean;
  server?: IMcpServer;
  onCancel: () => void;
  onSubmit: (server: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onBatchImport?: (servers: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>[]) => void;
}
