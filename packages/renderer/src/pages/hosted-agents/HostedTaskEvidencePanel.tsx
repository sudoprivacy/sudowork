import { Alert, Button, Tag, Typography } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HostedTaskEvidence } from '@sudowork/contracts/task';
import { hostedTasks } from '@sudowork/host-bridge/ipcBridge';

export default function HostedTaskEvidencePanel({ taskId }: IHostedTaskEvidencePanelProps) {
  const { t } = useTranslation();
  const [evidence, setEvidence] = useState<HostedTaskEvidence | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const isMounted = useRef(true),
    isRequesting = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  async function onLoad(isMore = false) {
    if (isRequesting.current) return;
    isRequesting.current = true;
    setIsLoading(true);
    setIsFailed(false);
    setIsOpen(true);
    try {
      const result = await hostedTasks.evidence.invoke({ taskId, cursor: isMore ? (evidence?.trace_next_cursor ?? 0) : 0 });
      if (!isMounted.current) return;
      if (!result.success || !result.data || result.data.task_id !== taskId) throw new Error('HOSTED_EVIDENCE_UNAVAILABLE');
      const next = result.data;
      if (isMore && evidence && (JSON.stringify(evidence.release) !== JSON.stringify(next.release) || next.trace_next_cursor < evidence.trace_next_cursor)) throw new Error('HOSTED_EVIDENCE_MISMATCH');
      setEvidence(isMore && evidence ? { ...next, trace: [...evidence.trace, ...next.trace] } : next);
    } catch {
      if (isMounted.current) setIsFailed(true);
    } finally {
      isRequesting.current = false;
      if (isMounted.current) setIsLoading(false);
    }
  }
  return (
    <div className='mt-2'>
      <Button size='mini' loading={isLoading} onClick={() => (isOpen ? setIsOpen(false) : void onLoad())}>
        {t(isOpen ? 'agent.hosted.evidence.hide' : 'agent.hosted.evidence.show')}
      </Button>
      {isOpen && (
        <section aria-label={t('agent.hosted.evidence.show')} className='mt-2 p-3 rounded border border-border-2 space-y-2'>
          {isFailed && <Alert type='warning' content={t('agent.hosted.evidence.failed')} />}
          <Button size='mini' disabled={isLoading} onClick={() => void onLoad()}>
            {t('agent.external.refresh')}
          </Button>
          {evidence && (
            <>
              <Typography.Paragraph>{t('agent.hosted.evidence.captured', { time: new Date(evidence.captured_at).toLocaleString() })}</Typography.Paragraph>
              {evidence.release && (
                <>
                  <Typography.Paragraph>{t('agent.hosted.version', { version: evidence.release.version })}</Typography.Paragraph>
                  <Typography.Paragraph className='break-all'>{t('agent.hosted.evidence.artifact', { id: evidence.release.artifact_id })}</Typography.Paragraph>
                  <Typography.Paragraph className='break-all'>{t('agent.hosted.evidence.digest', { digest: evidence.release.spec_digest })}</Typography.Paragraph>
                </>
              )}
              <Tag>{t(`agent.hosted.evidence.usage.${evidence.usage.status}`)}</Tag>
              {evidence.usage.status !== 'not_invoked' && (
                <>
                  <Typography.Paragraph>{t('agent.hosted.evidence.quota', { quota: evidence.usage.verified_quota })}</Typography.Paragraph>
                  <Typography.Paragraph>{t('agent.hosted.evidence.tokens', { input: evidence.usage.verified_prompt_tokens, output: evidence.usage.verified_completion_tokens })}</Typography.Paragraph>
                </>
              )}
              {evidence.usage.status === 'pending' && <Alert type='info' content={t('agent.hosted.evidence.pending')} />}
              <Typography.Paragraph>{t(`agent.hosted.evidence.cleanup.${evidence.cleanup}`)}</Typography.Paragraph>
              <Typography.Paragraph type='secondary'>{t('agent.hosted.evidence.traceOrigin')}</Typography.Paragraph>
              {evidence.trace.length === 0 && <Typography.Paragraph>{t('agent.hosted.evidence.noTrace')}</Typography.Paragraph>}
              <ol className='pl-4 space-y-1'>
                {evidence.trace.map((event) => (
                  <li key={event.sequence} className='break-words'>
                    {event.node} · {t(`agent.hosted.evidence.phase.${event.phase}`)} · {new Date(event.created_at).toLocaleTimeString()}
                  </li>
                ))}
              </ol>
              {evidence.trace_has_more && (
                <Button size='mini' disabled={isLoading} onClick={() => void onLoad(true)}>
                  {t('agent.hosted.evidence.more')}
                </Button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
interface IHostedTaskEvidencePanelProps {
  taskId: string;
}
