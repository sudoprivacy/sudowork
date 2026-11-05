import { Button, Message } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { BrowserSessionReplySchema } from '@sudowork/contracts/browser-session';
import type { CanonicalModelProject } from '@sudowork/contracts/conversations';
import { openBrowserSessionWindow } from './openBrowserSessionWindow';

/** A normal conversation's model entry; the existing browser panel owns its UX. */
export default function BoundModelReviewAction({ conversationId }: IBoundModelReviewActionProps) {
  const { t } = useTranslation();
  const [project, setProject] = useState<CanonicalModelProject | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const isMounted = useRef(true);
  const isOpeningRef = useRef(false);
  useEffect(() => {
    let isCancelled = false;
    isMounted.current = true;
    void (async () => {
      const result = await ipcBridge.ontology.getSessionProject.invoke({ conversationId });
      if (!result.success) throw new Error('MODEL_PROJECT_UNAVAILABLE');
      if (!isCancelled) setProject(result.data || null);
    })().catch(() => {
      if (!isCancelled) setIsUnavailable(true);
    });
    return () => {
      isCancelled = true;
      isMounted.current = false;
    };
  }, [conversationId]);

  const onOpen = async () => {
    if (!project || isOpeningRef.current) return;
    isOpeningRef.current = true;
    setIsOpening(true);
    try {
      const state = await ipcBridge.browserSession.invoke.invoke({ conversationId, action: { kind: 'state' } });
      if (!isMounted.current) return;
      if (!state.success) throw new Error(t('ontology.studio.reviewBrowserRequired'));
      let browser = BrowserSessionReplySchema.parse(state.data).session;
      if (browser.state === 'stopped') {
        const started = await ipcBridge.browserSession.invoke.invoke({ conversationId, action: { kind: 'start', isHeadless: false, transport: browser.transport === 'cdp' ? 'cdp' : 'extension' } });
        if (!started.success) throw new Error(t('ontology.studio.reviewBrowserRequired'));
        browser = BrowserSessionReplySchema.parse(started.data).session;
      }
      if (!isMounted.current) return;
      if (browser.state !== 'human' || !browser.isController) throw new Error(t('ontology.studio.reviewBrowserRequired'));
      const result = await ipcBridge.ontology.openSessionReview.invoke({ conversationId, epochs: { controlEpoch: browser.controlEpoch, targetEpoch: browser.targetEpoch } });
      if (!result.success || result.data?.surface !== 'viewer' || result.data.conversationId !== conversationId) throw new Error(t('ontology.studio.reviewUnavailable'));
      if (isMounted.current) openBrowserSessionWindow(conversationId);
    } catch (error) {
      if (isMounted.current) Message.error(error instanceof Error ? error.message : t('ontology.studio.reviewUnavailable'));
    } finally {
      isOpeningRef.current = false;
      if (isMounted.current) setIsOpening(false);
    }
  };
  if (!project && !isUnavailable) return null;
  return (
    <Button size='small' loading={isOpening} disabled={isUnavailable} title={isUnavailable ? t('ontology.studio.reviewUnavailable') : project?.modelRef} onClick={() => void onOpen()}>
      {t('ontology.studio.openReview')}
    </Button>
  );
}

interface IBoundModelReviewActionProps {
  conversationId: string;
}
