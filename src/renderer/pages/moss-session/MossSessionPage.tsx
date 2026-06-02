/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IResponseMessage } from '@/common/ipcBridge';
import { uuid } from '@/common/utils';
import { useAddEventListener } from '@/renderer/utils/emitter';
import MessageList from '@/renderer/messages/MessageList';
import { MessageListProvider, useMessageList, useUpdateMessageList } from '@/renderer/messages/hooks';
import FlexFullContainer from '@renderer/components/FlexFullContainer';
import { Button, Input, Spin, Typography } from '@arco-design/web-react';
import { SendOne } from '@icon-park/react';
import { iconColors } from '@/renderer/theme/colors';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { TMessage } from '@/common/chatLib';
import HOC from '@/renderer/utils/HOC';

/**
 * Moss Session Page - Enterprise mode conversation
 *
 * Session is fully managed by Moss Server, no local persistence
 * Messages are stored in-memory only via MessageListProvider context
 */
const MossSessionPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const updateMessageList = useUpdateMessageList();
  const messages = useMessageList();

  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const runningRef = useRef(running);

  // Get wsUrl and initial message from sessionStorage
  useEffect(() => {
    if (!sessionId) return;

    const storedWsUrl = sessionStorage.getItem(`moss_ws_url_${sessionId}`);
    const storedMessage = sessionStorage.getItem(`moss_initial_message_${sessionId}`);

    if (!storedWsUrl) {
      setError('WebSocket URL not found. Session may have expired.');
      return;
    }

    setWsUrl(storedWsUrl);

    // Clear storage after reading
    sessionStorage.removeItem(`moss_ws_url_${sessionId}`);
    sessionStorage.removeItem(`moss_initial_message_${sessionId}`);

    // Send initial message if exists
    if (storedMessage) {
      try {
        const { input: initialInput, files, skills } = JSON.parse(storedMessage);
        sendMessageInternal(initialInput, files, skills);
      } catch (e) {
        console.error('Failed to parse initial message:', e);
      }
    }
  }, [sessionId]);

  // Listen to Moss response stream
  useAddEventListener('moss.response-stream' as any, (msg: IResponseMessage) => {
    if (msg.conversation_id !== sessionId) return;

    handleStreamMessage(msg);
  });

  const handleStreamMessage = useCallback(
    (msg: IResponseMessage) => {
      switch (msg.type) {
        case 'content':
          if (msg.msg_id && msg.data) {
            const tMessage: TMessage = {
              id: msg.msg_id,
              msg_id: msg.msg_id,
              type: 'text' as const,
              position: 'left' as const,
              conversation_id: sessionId!,
              content: { content: msg.data as string },
              createdAt: Date.now(),
            };
            // Add/update message in context (in-memory only for enterprise mode)
            updateMessageList((list) => {
              const existingIdx = list.findIndex((m) => m.msg_id === msg.msg_id);
              if (existingIdx >= 0) {
                // Update existing message
                const updated = [...list];
                const existing = updated[existingIdx];
                if (existing.type === 'text') {
                  updated[existingIdx] = {
                    ...existing,
                    content: { content: msg.data as string },
                  } as TMessage;
                }
                return updated;
              }
              return [...list, tMessage];
            });
          }
          setRunning(false);
          runningRef.current = false;
          break;

        case 'finish':
          setRunning(false);
          runningRef.current = false;
          break;

        case 'error':
          setRunning(false);
          runningRef.current = false;
          const errorMsg: TMessage = {
            id: uuid(36),
            msg_id: uuid(36),
            type: 'tips' as const,
            position: 'center' as const,
            conversation_id: sessionId!,
            content: { content: msg.data as string, type: 'error' as const },
            createdAt: Date.now(),
          };
          updateMessageList((list) => [...list, errorMsg]);
          break;
      }
    },
    [sessionId, updateMessageList]
  );

  const sendMessageInternal = async (msgContent: string, files?: string[], _skills?: string[]) => {
    if (!sessionId || !wsUrl || runningRef.current) return;

    setRunning(true);
    runningRef.current = true;

    // Add user message to UI (in-memory only)
    const userMsgId = uuid(36);
    const userMessage: TMessage = {
      id: userMsgId,
      msg_id: userMsgId,
      type: 'text' as const,
      position: 'right' as const,
      conversation_id: sessionId,
      content: { content: msgContent },
      createdAt: Date.now(),
    };
    updateMessageList((list) => [...list, userMessage]);

    // Send to Moss Server
    const result = await ipcBridge.moss.sendMessage.invoke({
      sessionId,
      wsUrl,
      content: msgContent,
      files,
    });

    if (!result.success) {
      setRunning(false);
      runningRef.current = false;
      setError(result.msg || 'Failed to send message');
    }
  };

  const handleSend = useCallback(async () => {
    if (!input.trim()) return;
    await sendMessageInternal(input.trim());
    setInput('');
  }, [input, sessionId, wsUrl, running]);

  const handleStop = useCallback(async () => {
    if (!sessionId) return;
    await ipcBridge.moss.stop.invoke({ sessionId });
    setRunning(false);
    runningRef.current = false;
  }, [sessionId]);

  const handleBack = useCallback(() => {
    navigate('/guid');
  }, [navigate]);

  if (error) {
    return (
      <div className='flex flex-col items-center justify-center h-full gap-4'>
        <Typography.Title heading={4}>Session Error</Typography.Title>
        <Typography.Text>{error}</Typography.Text>
        <Button onClick={handleBack}>Back to Guid</Button>
      </div>
    );
  }

  if (!wsUrl) {
    return (
      <div className='flex items-center justify-center h-full'>
        <Spin size={40} />
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full'>
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]'>
        <Typography.Text bold>Moss Server Session</Typography.Text>
        <Typography.Text type='secondary'>{sessionId?.slice(0, 8)}...</Typography.Text>
      </div>

      {/* Message List */}
      <div className='flex-1 overflow-hidden'>
        <FlexFullContainer>
          <MessageList className='flex-1' aiProcessing={running} />
        </FlexFullContainer>
      </div>

      {/* Send Box */}
      <div className='flex items-center gap-2 px-4 py-3 border-t border-[var(--color-border)]'>
        <Input value={input} onChange={setInput} placeholder='Send message to Moss Server...' disabled={running} className='flex-1' />
        {running ? (
          <Button type='primary' onClick={handleStop}>
            Stop
          </Button>
        ) : (
          <Button type='primary' icon={<SendOne theme='filled' size='18' fill={iconColors.primary} />} onClick={handleSend} disabled={!input.trim()} />
        )}
      </div>
    </div>
  );
};

/**
 * Moss Session Page with MessageListProvider context
 * Uses HOC pattern to wrap with MessageListProvider for in-memory message management
 */
export default HOC(MessageListProvider)(MossSessionPage);
