import { Alert, Button, Modal, Spin, Typography } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { externalProviders } from '@sudowork/host-bridge/ipcBridge';
import type { ExternalTaskEvidence as Evidence } from '@sudowork/contracts/external-provider';

export default function ExternalTaskEvidence({ taskId, onClose }: IExternalTaskEvidenceProps) {
  const { t } = useTranslation();
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFailed, setIsFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setIsFailed(false);
    setEvidence(null);
    void externalProviders.evidence
      .invoke({ taskId })
      .then((result) => {
        if (isCancelled) return;
        if (!result.success || !result.data) throw new Error('Execution evidence unavailable');
        setEvidence(result.data);
      })
      .catch(() => {
        if (!isCancelled) setIsFailed(true);
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [taskId, generation]);
  return (
    <Modal
      visible
      title={t('agent.external.versions.evidence')}
      onCancel={onClose}
      footer={
        <Button disabled={isLoading} onClick={() => setGeneration((current) => current + 1)}>
          {t('agent.external.refresh')}
        </Button>
      }
    >
      {isLoading && <Spin />}
      {isFailed && <Alert type='error' content={t('agent.external.loadFailed')} />}
      {evidence && (
        <div className='flex flex-col gap-3 break-all'>
          <Typography.Text>{t('agent.external.versions.task', { id: evidence.task_id })}</Typography.Text>
          <Typography.Text>{t('agent.external.registry.session', { id: evidence.session_id })}</Typography.Text>
          {evidence.attempt_id && <Typography.Text>{t('agent.external.registry.attempt', { id: evidence.attempt_id })}</Typography.Text>}
          {evidence.selection ? (
            <>
              <Typography.Text bold>{t('agent.external.versions.selected', { version: evidence.selection.version })}</Typography.Text>
              {evidence.selection.resolved_from_channel && <Typography.Text>{t('agent.external.versions.channel', { channel: evidence.selection.resolved_from_channel, revision: evidence.selection.channel_revision })}</Typography.Text>}
              <Typography.Text type='secondary'>{t('agent.external.versions.source', { digest: evidence.selection.source_digest })}</Typography.Text>
              {evidence.selection.release_digest && <Typography.Text type='secondary'>{t('agent.external.registry.release', { digest: evidence.selection.release_digest })}</Typography.Text>}
              {evidence.selection.registry ? (
                <>
                  <Typography.Text bold>{t('agent.external.registry.verified')}</Typography.Text>
                  <Typography.Text>{t('agent.external.registry.principal', { principal: `${evidence.selection.registry.principal.trust_domain}/${evidence.selection.registry.principal.agent_name}` })}</Typography.Text>
                  <Typography.Text type='secondary'>{t('agent.external.registry.digest', { digest: evidence.selection.registry.registration_digest })}</Typography.Text>
                  <Typography.Text type='secondary'>{t('agent.external.registry.key', { key: evidence.selection.registry.signing_key_id })}</Typography.Text>
                  <Alert type='info' content={t('agent.external.registry.boundary')} />
                </>
              ) : (
                <Typography.Text type='secondary'>{t('agent.external.registry.unrecorded')}</Typography.Text>
              )}
            </>
          ) : (
            <Typography.Text>{t('agent.external.versions.noSelection')}</Typography.Text>
          )}
          {evidence.execution ? (
            <>
              <Typography.Text>{evidence.execution.provider_run_id ? t('agent.external.versions.run', { id: evidence.execution.provider_run_id }) : t('agent.external.protocol.noRun')}</Typography.Text>
              {evidence.execution.protocol && <Typography.Text>{evidence.execution.protocol}</Typography.Text>}
              {evidence.execution.provider_response_id && <Typography.Text>{t('agent.external.protocol.response', { id: evidence.execution.provider_response_id })}</Typography.Text>}
              {evidence.execution.trace_id && <Typography.Text>{t('agent.external.protocol.trace', { id: evidence.execution.trace_id })}</Typography.Text>}
              {evidence.execution.usage && <Typography.Text>{t('agent.external.protocol.usage', { input: evidence.execution.usage.input_tokens, output: evidence.execution.usage.output_tokens })}</Typography.Text>}
              {evidence.execution.execution_revision ? <Typography.Text>{t('agent.external.versions.executed', { revision: evidence.execution.execution_revision })}</Typography.Text> : <Alert type='info' content={t('agent.external.versions.snapshotOnly')} />}
            </>
          ) : (
            <Typography.Text>{t('agent.external.versions.awaitingEvidence')}</Typography.Text>
          )}
        </div>
      )}
    </Modal>
  );
}

interface IExternalTaskEvidenceProps {
  taskId: string;
  onClose: () => void;
}
