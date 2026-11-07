/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import CodeView from '@renderer/components/CodeView';
import { ToolOutput } from '../../tools/ToolContentView';
import { formatToolValue } from '../../tools/toolPresentation';
import { useTranslation } from 'react-i18next';
import type { CodexToolCallUpdate } from '@sudowork/common/chatLib';
import ToolFrame, { ToolBadge } from '../../tools/ToolFrame';

type McpToolUpdate = Extract<CodexToolCallUpdate, { subtype: 'mcp_tool_call_begin' | 'mcp_tool_call_end' }>;

const McpToolDisplay: React.FC<{ content: McpToolUpdate }> = ({ content }) => {
  const { toolCallId, title, status, description, subtype, data } = content;
  const { t } = useTranslation();

  const getDisplayTitle = () => {
    if (title) return title;

    const inv = data?.invocation || {};
    const toolName = inv.tool || inv.name || inv.method || 'unknown';

    switch (subtype) {
      case 'mcp_tool_call_begin':
        return t('tools.titles.mcp_tool_starting', { toolName });
      case 'mcp_tool_call_end':
        return t('tools.titles.mcp_tool', { toolName });
      default:
        return 'MCP Tool';
    }
  };

  const getToolDetails = () => {
    if (!data?.invocation) return null;

    const inv = data.invocation;
    return {
      toolName: inv.tool || inv.name || inv.method || 'unknown',
      arguments: inv.arguments,
    };
  };

  const toolDetails = getToolDetails();

  return (
    <ToolFrame toolCallId={toolCallId} title={getDisplayTitle()} status={status} description={description} icon='🔌'>
      {/* Display tool details if available 显示工具详情 */}
      {toolDetails && (
        <div className='text-sm mb-2'>
          <div className='text-xs text-secondary mb-1'>{t('tools.labels.tool_details')}</div>
          <div className='bg-1 p-2 rounded text-sm border'>
            <div className='flex items-center gap-2'>
              <ToolBadge tone='info'>{t('tools.labels.tool')}</ToolBadge>
              <span className='font-mono text-xs text-foreground'>{toolDetails.toolName}</span>
            </div>
            {toolDetails.arguments && (
              <div className='mt-2'>
                <div className='text-xs text-secondary mb-1'>{t('tools.labels.arguments')}</div>
                <CodeView source={formatToolValue(toolDetails.arguments)} language='json' />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Display result if available for end events 显示结果 */}
      {subtype === 'mcp_tool_call_end' && data?.result && (
        <div className='text-sm mb-2'>
          <div className='text-xs text-secondary mb-1'>{t('tools.labels.result')}</div>
          <div className='bg-1 p-2 rounded text-sm max-h-40 overflow-y-auto border'>
            <ToolOutput text={formatToolValue(data.result)} />
          </div>
        </div>
      )}
    </ToolFrame>
  );
};

export default McpToolDisplay;
