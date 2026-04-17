import { IconDown } from '@arco-design/web-react/icon';
import classNames from 'classnames';
import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessageAcpToolCall, IMessageToolGroup } from '../../common/chatLib';
import './MessageToolGroupSummary.css';

type ToolStatus = 'success' | 'error' | 'running' | 'default';

type ToolItem = {
  key: string;
  name: string;
  desc: string;
  status: ToolStatus;
  input?: string;
  output?: string;
};

const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getResultDisplayText = (resultDisplay: IMessageToolGroup['content'][0]['resultDisplay']): string | undefined => {
  if (!resultDisplay) return undefined;
  if (typeof resultDisplay === 'string') return resultDisplay;
  if ('fileDiff' in resultDisplay) return resultDisplay.fileDiff;
  if ('img_url' in resultDisplay) return resultDisplay.relative_path || resultDisplay.img_url;
  return undefined;
};

const ToolGroupMapper = (m: IMessageToolGroup): ToolItem[] => {
  return m.content.map(({ name, callId, description, confirmationDetails, status, resultDisplay }) => {
    let desc = description.slice(0, 100);
    const type = confirmationDetails?.type;
    if (type === 'edit') desc = confirmationDetails.fileName;
    if (type === 'exec') desc = confirmationDetails.command;
    if (type === 'info') desc = confirmationDetails.urls?.join(';') || confirmationDetails.title;
    if (type === 'mcp') desc = confirmationDetails.serverName + ':' + confirmationDetails.toolName;

    // Input
    let input: string | undefined;
    if (confirmationDetails) {
      const { title: _title, type: _type, ...rest } = confirmationDetails;
      if (Object.keys(rest).length) input = formatValue(rest);
    } else if (description) {
      input = description;
    }

    const output = getResultDisplayText(resultDisplay);

    const mappedStatus: ToolStatus = status === 'Success' ? 'success' : status === 'Error' ? 'error' : status === 'Canceled' ? 'default' : 'running';

    return {
      key: callId,
      name,
      desc,
      status: mappedStatus,
      input,
      output,
    };
  });
};

const ToolAcpMapper = (message: IMessageAcpToolCall): ToolItem | undefined => {
  const update = message.content.update;
  if (!update) return;

  const input = update.rawInput ? formatValue(update.rawInput) : undefined;

  let output: string | undefined;
  if (update.content?.length) {
    output = update.content
      .map((item) => {
        if (item.type === 'content' && item.content?.text) return item.content.text;
        if (item.type === 'diff' && item.path) return `[diff] ${item.path}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  const mappedStatus: ToolStatus = update.status === 'completed' ? 'success' : update.status === 'failed' ? 'error' : 'running';

  return {
    key: update.toolCallId,
    name: (update.rawInput?.description as string) || update.title,
    desc: (update.rawInput?.command as string) || update.kind,
    status: mappedStatus,
    input,
    output,
  };
};

// SVG Icons (inlined to avoid extra dependencies)
const CheckIcon: React.FC = () => (
  <svg className='tool-step-row__status-svg' viewBox='0 0 12 12' fill='none' aria-hidden='true'>
    <path d='M2.5 6.25L5 8.75L9.5 3.75' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

const AlertIcon: React.FC = () => (
  <svg className='tool-step-row__status-svg' viewBox='0 0 12 12' fill='none' aria-hidden='true'>
    <path d='M6 2.25V6.75' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' />
    <circle cx='6' cy='9' r='0.8' fill='currentColor' />
  </svg>
);

const SpinnerIcon: React.FC = () => (
  <svg className='tool-step-row__status-svg' viewBox='0 0 24 24' fill='none' aria-hidden='true' style={{ animation: 'spin 1s linear infinite' }}>
    <circle cx='12' cy='12' r='9' stroke='currentColor' strokeOpacity='0.25' strokeWidth='3' />
    <path d='M21 12a9 9 0 0 0-9-9' stroke='currentColor' strokeWidth='3' strokeLinecap='round' />
  </svg>
);

const PendingIcon: React.FC = () => <span className='tool-step-row__status-svg' style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />;

const StatusIcon: React.FC<{ status: ToolStatus }> = ({ status }) => {
  if (status === 'success') return <CheckIcon />;
  if (status === 'error') return <AlertIcon />;
  if (status === 'running') return <SpinnerIcon />;
  return <PendingIcon />;
};

// ——— Step row ———
const ToolItemDetail: React.FC<{ item: ToolItem }> = ({ item }) => {
  const [expanded, setExpanded] = React.useState(false);
  const hasDetail = Boolean(item.input || item.output);
  const itemRef = React.useRef<HTMLDivElement>(null);

  const handleToggleDetail = React.useCallback(() => {
    if (!hasDetail) return;

    if (!itemRef.current) {
      setExpanded(!expanded);
      return;
    }

    const itemRectBefore = itemRef.current.getBoundingClientRect();
    let scrollParent: Element | null = itemRef.current.parentElement;
    while (scrollParent) {
      const style = window.getComputedStyle(scrollParent);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') && scrollParent.scrollHeight > scrollParent.clientHeight) {
        break;
      }
      scrollParent = scrollParent.parentElement;
    }

    if (!scrollParent) {
      setExpanded(!expanded);
      return;
    }

    const scrollRectBefore = scrollParent.getBoundingClientRect();
    const itemOffsetTopBefore = itemRectBefore.top - scrollRectBefore.top + scrollParent.scrollTop;
    const scrollTopBefore = scrollParent.scrollTop;

    setExpanded(!expanded);

    requestAnimationFrame(() => {
      const itemRectAfter = itemRef.current!.getBoundingClientRect();
      const scrollRectAfter = scrollParent!.getBoundingClientRect();
      const itemOffsetTopAfter = itemRectAfter.top - scrollRectAfter.top + scrollParent!.scrollTop;

      const delta = itemOffsetTopAfter - itemOffsetTopBefore;
      if (Math.abs(delta) > 1) {
        scrollParent.scrollTop = scrollTopBefore + delta;
      }
    });
  }, [expanded, hasDetail]);

  return (
    <div ref={itemRef} className='tool-step-row' onClick={handleToggleDetail} style={{ cursor: hasDetail ? 'pointer' : 'default' }}>
      <div className='tool-step-row__main'>
        <div
          className={classNames('tool-step-row__status', {
            'tool-step-row__status--success': item.status === 'success',
            'tool-step-row__status--error': item.status === 'error',
            'tool-step-row__status--running': item.status === 'running',
            'tool-step-row__status--default': item.status === 'default',
          })}
          aria-hidden='true'
        >
          <StatusIcon status={item.status} />
        </div>

        <div className='tool-step-row__content'>
          <span className='tool-step-row__name'>{item.name}</span>
          <span className={classNames('tool-step-row__desc', { 'tool-step-row__desc--expanded': expanded })}>{item.desc}</span>
        </div>

        {hasDetail && (
          <span
            className='tool-step-row__toggle'
            onClick={(e) => {
              e.stopPropagation();
              handleToggleDetail();
            }}
          >
            <IconDown style={{ fontSize: 10, transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }} />
          </span>
        )}
      </div>

      {expanded && hasDetail && (
        <div className='tool-detail-panel' onClick={(e) => e.stopPropagation()}>
          {item.input && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Input</div>
              <pre className='tool-detail-content'>{item.input}</pre>
            </div>
          )}
          {item.output && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Output</div>
              <pre className='tool-detail-content'>{item.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface MessageToolGroupSummaryProps {
  messages: Array<IMessageToolGroup | IMessageAcpToolCall>;
  summaryId: string;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  isStreaming?: boolean;
}

const MessageToolGroupSummary: React.FC<MessageToolGroupSummaryProps> = ({ messages, summaryId, isExpanded, onToggle, isStreaming }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const prevMessagesRef = useRef(messages);
  const prevIsExpandedRef = useRef(isExpanded);

  // Auto-collapse when all messages are completed
  useEffect(() => {
    const prevMessages = prevMessagesRef.current;
    const wasInProgress = prevMessages.some((m) => {
      if (m.type === 'tool_group') {
        return m.content.some((t) => t.status !== 'Success' && t.status !== 'Error' && t.status !== 'Canceled');
      }
      if (m.type === 'acp_tool_call') {
        return m.content.update.status !== 'completed' && m.content.update.status !== 'failed';
      }
      return true;
    });

    const allCompleted = messages.every((m) => {
      if (m.type === 'tool_group') {
        return m.content.every((t) => t.status === 'Success' || t.status === 'Error' || t.status === 'Canceled');
      }
      if (m.type === 'acp_tool_call') {
        return m.content.update.status === 'completed' || m.content.update.status === 'failed';
      }
      return true;
    });

    const hasErrors = messages.some((m) => {
      if (m.type === 'tool_group') return m.content.some((t) => t.status === 'Error');
      if (m.type === 'acp_tool_call') return m.content.update.status === 'failed';
      return false;
    });

    if (allCompleted && wasInProgress && isExpanded && !hasErrors) {
      const timer = setTimeout(() => {
        onToggle(summaryId);
      }, 100);
      return () => clearTimeout(timer);
    }

    prevMessagesRef.current = messages;
    prevIsExpandedRef.current = isExpanded;
  }, [messages, isExpanded, summaryId, onToggle]);

  // Preserve scroll position when toggling expand/collapse
  const handleToggleShowMore = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      const container = containerRef.current;
      const button = buttonRef.current;
      if (!container || !button) {
        onToggle(summaryId);
        return;
      }

      let scrollParent: Element | null = container.parentElement;
      while (scrollParent) {
        const style = window.getComputedStyle(scrollParent);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') {
          break;
        }
        scrollParent = scrollParent.parentElement;
      }

      if (!scrollParent) {
        onToggle(summaryId);
        return;
      }

      const buttonRectBefore = button.getBoundingClientRect();
      const scrollParentRectBefore = scrollParent.getBoundingClientRect();
      const buttonOffsetTopBefore = buttonRectBefore.top - scrollParentRectBefore.top + scrollParent.scrollTop;
      const scrollTopBefore = scrollParent.scrollTop;

      onToggle(summaryId);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const buttonRectAfter = button.getBoundingClientRect();
          const scrollParentRectAfter = scrollParent.getBoundingClientRect();
          const buttonOffsetTopAfter = buttonRectAfter.top - scrollParentRectAfter.top + scrollParent.scrollTop;

          const delta = buttonOffsetTopAfter - buttonOffsetTopBefore;

          if (Math.abs(delta) > 2) {
            scrollParent.scrollTop = scrollTopBefore + delta;
          }
        });
      });
    },
    [summaryId, onToggle]
  );

  const tools = useMemo(() => {
    const items = messages
      .map((m) => {
        if (m.type === 'tool_group') return ToolGroupMapper(m);
        return ToolAcpMapper(m);
      })
      .flat()
      .filter((item): item is ToolItem => !!item);
    // Deduplicate by key (keep last = most recent update)
    const map = new Map<string, ToolItem>();
    for (const item of items) {
      map.set(item.key, item);
    }
    return Array.from(map.values());
  }, [messages]);

  // ——— Aggregate status for header ———
  const totalCount = tools.length;
  const completedCount = tools.filter((t) => t.status === 'success').length;
  const runningCount = tools.filter((t) => t.status === 'running').length;
  const errorCount = tools.filter((t) => t.status === 'error').length;

  const overallStatus: ToolStatus = errorCount > 0 ? 'error' : runningCount > 0 ? 'running' : completedCount === totalCount && totalCount > 0 ? 'success' : 'default';

  // If isStreaming=true (aiProcessing and last message), show "Executing..." even if all tools completed
  // because the task may continue to the next step
  const isRunning = !!isStreaming || overallStatus === 'running';

  const headerLabel = isRunning ? t('conversation.chat.toolExecuting') : overallStatus === 'success' || overallStatus === 'error' ? t('conversation.chat.toolCompleted') : t('conversation.chat.toolViewSteps');

  return (
    <div ref={containerRef} className='tool-steps-card' onClick={(e) => e.stopPropagation()}>
      <div
        ref={buttonRef}
        className={classNames('tool-steps-card__header', {
          'tool-steps-card__header--expanded': isExpanded,
        })}
        onClick={handleToggleShowMore}
      >
        <div className='tool-steps-card__header-left'>
          <span
            className={classNames('tool-steps-status-dot', {
              'tool-steps-status-dot--running': isRunning,
              'tool-steps-status-dot--done': !isRunning && (overallStatus === 'success' || overallStatus === 'error'),
              'tool-steps-status-dot--default': overallStatus === 'default',
            })}
            aria-hidden='true'
          />
          <span className={classNames('tool-steps-card__title', { 'tool-steps-card__title--muted': !isRunning })}>{headerLabel}</span>
          <span
            className={classNames('tool-steps-card__count', {
              'tool-steps-card__count--running': isRunning,
              'tool-steps-card__count--done': !isRunning && (overallStatus === 'success' || overallStatus === 'error'),
            })}
          >
            {completedCount}/{totalCount}
          </span>
        </div>
        <IconDown
          className={classNames('tool-steps-card__chevron', {
            'tool-steps-card__chevron--collapsed': !isExpanded,
          })}
          style={{ fontSize: 12 }}
        />
      </div>

      {isExpanded && (
        <div className='tool-steps-card__body'>
          <div className='viewsteps-container'>
            {tools.map((item) => (
              <ToolItemDetail key={item.key} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageToolGroupSummary);
