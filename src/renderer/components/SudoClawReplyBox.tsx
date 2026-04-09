/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef } from 'react';
import { Button, Input, Space, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

/**
 * SudoClaw AskUser request data for the WebUI.
 */
export interface SudoClawAskUserData {
  /** Unique request ID */
  requestId: string;
  /** Conversation ID */
  conversationId: string;
  /** Question from the model */
  question: string;
  /** Urgency level */
  urgency: 'info' | 'action_needed' | 'critical';
  /** Suggested actions */
  suggestedActions?: Array<{ label: string; value: string; style?: 'primary' | 'default' | 'danger' }>;
  /** Context */
  context?: {
    toolName?: string;
    summary?: string;
  };
}

/**
 * Response callback type
 */
export type SudoClawReplyCallback = (
  requestId: string,
  conversationId: string,
  responseType: 'approve' | 'deny' | 'reply',
  message?: string
) => void;

interface SudoClawReplyBoxProps {
  /** The AskUser request data */
  request: SudoClawAskUserData;
  /** Callback when the user responds */
  onRespond: SudoClawReplyCallback;
  /** Whether the request has been responded to */
  responded?: boolean;
  /** The response that was sent (for display after responding) */
  responseType?: string;
}

/**
 * SudoClawReplyBox — Inline reply component for WebUI.
 *
 * Displayed in the conversation view when the model calls AskUserTool.
 * Provides Approve / Deny buttons and an optional text reply input.
 */
const SudoClawReplyBox: React.FC<SudoClawReplyBoxProps> = ({ request, onRespond, responded = false, responseType }) => {
  const { t } = useTranslation();
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const urgencyColor = request.urgency === 'critical' ? 'red' : request.urgency === 'action_needed' ? 'orange' : 'blue';
  const urgencyLabel = request.urgency === 'critical' ? 'Critical' : request.urgency === 'action_needed' ? 'Action Needed' : 'Info';

  const handleApprove = useCallback(() => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    onRespond(request.requestId, request.conversationId, 'approve');
  }, [request, onRespond, isSubmitting]);

  const handleDeny = useCallback(() => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    onRespond(request.requestId, request.conversationId, 'deny');
  }, [request, onRespond, isSubmitting]);

  const handleReply = useCallback(() => {
    if (isSubmitting || !replyText.trim()) return;
    setIsSubmitting(true);
    onRespond(request.requestId, request.conversationId, 'reply', replyText.trim());
  }, [request, onRespond, replyText, isSubmitting]);

  const handleCustomAction = useCallback(
    (value: string) => {
      if (isSubmitting) return;
      setIsSubmitting(true);
      // Map custom action values to response types
      const type = value === 'approve' ? 'approve' : value === 'deny' ? 'deny' : 'reply';
      onRespond(request.requestId, request.conversationId, type, value !== 'approve' && value !== 'deny' ? value : undefined);
    },
    [request, onRespond, isSubmitting]
  );

  const toggleReplyInput = useCallback(() => {
    setShowReplyInput((prev) => !prev);
    // Focus the text area after it renders
    setTimeout(() => textAreaRef.current?.focus(), 100);
  }, []);

  // Show responded state
  if (responded) {
    const icon = responseType === 'approve' ? '✅' : responseType === 'deny' ? '❌' : '💬';
    const label = responseType === 'approve' ? 'Approved' : responseType === 'deny' ? 'Denied' : 'Replied';
    return (
      <div className="p-12px rd-8px bg-fill-2 border border-solid border-line-2 my-8px">
        <div className="flex items-center gap-8px">
          <span>{icon}</span>
          <Text bold>{label}</Text>
        </div>
        <Paragraph className="mt-4px text-t-secondary text-12px" ellipsis={{ rows: 2 }}>
          {request.question}
        </Paragraph>
      </div>
    );
  }

  return (
    <div className="p-12px rd-8px bg-fill-1 border border-solid border-warning-3 my-8px">
      {/* Header */}
      <div className="flex items-center gap-8px mb-8px">
        <span>🔔</span>
        <Text bold>{t('sudoclaw.actionRequired', { defaultValue: 'Action Required' })}</Text>
        <Tag color={urgencyColor} size="small">
          {urgencyLabel}
        </Tag>
      </div>

      {/* Context */}
      {request.context && (
        <div className="mb-8px text-12px text-t-secondary">
          {request.context.toolName && (
            <div>
              <Text className="text-t-tertiary">Tool: </Text>
              <Text code>{request.context.toolName}</Text>
            </div>
          )}
          {request.context.summary && (
            <div>
              <Text className="text-t-tertiary">Summary: </Text>
              <Text>{request.context.summary}</Text>
            </div>
          )}
        </div>
      )}

      {/* Question */}
      <Paragraph className="mb-12px whitespace-pre-wrap">{request.question}</Paragraph>

      {/* Action buttons */}
      <Space size="small" wrap>
        {request.suggestedActions && request.suggestedActions.length > 0 ? (
          // Custom actions from the model
          request.suggestedActions.map((action) => (
            <Button
              key={action.value}
              type={action.style === 'primary' ? 'primary' : action.style === 'danger' ? 'primary' : 'default'}
              status={action.style === 'danger' ? 'danger' : undefined}
              size="small"
              disabled={isSubmitting}
              onClick={() => handleCustomAction(action.value)}
            >
              {action.label}
            </Button>
          ))
        ) : (
          // Default Approve / Deny / Reply
          <>
            <Button type="primary" size="small" disabled={isSubmitting} onClick={handleApprove}>
              ✅ {t('sudoclaw.approve', { defaultValue: 'Approve' })}
            </Button>
            <Button type="primary" status="danger" size="small" disabled={isSubmitting} onClick={handleDeny}>
              ❌ {t('sudoclaw.deny', { defaultValue: 'Deny' })}
            </Button>
            <Button type="default" size="small" disabled={isSubmitting} onClick={toggleReplyInput}>
              💬 {t('sudoclaw.reply', { defaultValue: 'Reply' })}
            </Button>
          </>
        )}
      </Space>

      {/* Reply input */}
      {showReplyInput && (
        <div className="mt-8px flex gap-8px">
          <TextArea
            ref={textAreaRef as any}
            placeholder={t('sudoclaw.replyPlaceholder', { defaultValue: 'Type your reply...' })}
            value={replyText}
            onChange={setReplyText}
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={isSubmitting}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleReply();
              }
            }}
            className="flex-1"
          />
          <Button type="primary" size="small" disabled={isSubmitting || !replyText.trim()} onClick={handleReply}>
            {t('common.send', { defaultValue: 'Send' })}
          </Button>
        </div>
      )}
    </div>
  );
};

export default SudoClawReplyBox;
