import { Button, Empty, Input, Message, Modal, Select, Spin } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { BrowserFileSchema, BrowserInputSchema, BrowserSessionReplySchema, isCurrentBrowserFrame, type BrowserFile, type BrowserSessionAction, type BrowserSessionReply, type BrowserSessionState } from '@sudowork/contracts/browser-session';
import { PageSurface } from '@ai-dev-browser/remote-page';

/** Shared remote browser UI. The host authenticates and enforces every action. */
export default function BrowserSessionPanel({ conversationId, isActive = true, isViewer = false }: IBrowserSessionPanelProps) {
  const { t } = useTranslation();
  const [session, setSession] = useState<BrowserSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isFileTransferring, setIsFileTransferring] = useState(false);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [dialogText, setDialogText] = useState('');
  const [isFrameReady, setIsFrameReady] = useState(false);
  const [isHeadless, setIsHeadless] = useState(true);
  const [transport, setTransport] = useState<'extension' | 'cdp'>('extension');
  const [selectedSurface, setSelectedSurface] = useState<'page' | 'window' | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileChoiceRef = useRef<{ generation: number; chooserId: string; controlEpoch: number; targetEpoch: number } | null>(null);
  const surfaceRef = useRef<PageSurface | null>(null);
  const sessionRef = useRef<BrowserSessionState | null>(null);
  const invokeRef = useRef<((action: BrowserSessionAction) => Promise<BrowserSessionReply>) | undefined>(undefined);
  const isInteractiveRef = useRef(false);
  const surfaceModeRef = useRef<'page' | 'window'>('page');
  const generationRef = useRef(0);

  const invoke = useCallback(
    async (action: BrowserSessionAction) => {
      const reply = await ipcBridge.browserSession.invoke.invoke({ conversationId, action });
      if (!reply?.success) {
        const code = reply?.msg || 'unavailable';
        throw new Error(t(`conversation.browserSession.errors.${code}`, { defaultValue: t('conversation.browserSession.unavailable') }));
      }
      return BrowserSessionReplySchema.parse(reply.data);
    },
    [conversationId, t]
  );
  invokeRef.current = invoke;

  const update = useCallback((next: BrowserSessionState) => {
    const previous = sessionRef.current;
    const isSameBrowser = previous?.browserSessionId === next.browserSessionId;
    const isSameProfile = previous?.profileId === next.profileId;
    if (previous && isSameProfile && (next.controlEpoch < previous.controlEpoch || (next.controlEpoch === previous.controlEpoch && next.targetEpoch < previous.targetEpoch))) return;
    if (previous && (!isSameBrowser || next.controlEpoch !== previous.controlEpoch || next.targetEpoch !== previous.targetEpoch)) {
      surfaceRef.current?.clear();
      setIsFrameReady(false);
    }
    sessionRef.current = next;
    setSession(next);
    if ((!previous || !isSameBrowser) && next.state !== 'stopped') {
      setIsHeadless(next.isHeadless);
      if (next.transport !== 'electron') setTransport(next.transport);
    }
    const target = next.tabs.find((tab) => tab.id === next.activeTargetId);
    if (!previous || previous.activeTargetId !== next.activeTargetId || previous.tabs.find((tab) => tab.id === previous.activeTargetId)?.url !== target?.url) setUrl(target?.url || '');
    setError(null);
  }, []);
  const updateRef = useRef(update);
  updateRef.current = update;

  useEffect(() => {
    const generation = ++generationRef.current;
    let isClosed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const viewerId = crypto.randomUUID();
    sessionRef.current = null;
    setSession(null);
    setError(null);
    setIsFrameReady(false);
    setIsFileTransferring(false);
    fileChoiceRef.current = null;
    if (!isActive || !conversationId) return;

    async function poll() {
      try {
        const stateReply = await invoke({ kind: 'state' });
        if (isClosed) return;
        update(stateReply.session);
        const viewMode = selectedSurface === 'page' || !stateReply.session.capabilities.windowView ? 'page' : 'window';
        surfaceModeRef.current = viewMode;
        if (document.visibilityState === 'visible' && stateReply.session.state !== 'stopped' && stateReply.session.capabilities.pageView && stateReply.session.activeTargetId) {
          await invoke({ kind: 'attach', viewerId, surface: viewMode });
          if (isClosed) return;
          const state = sessionRef.current!;
          const reply = await invoke({ kind: 'frame', viewerId, surface: viewMode, controlEpoch: state.controlEpoch, targetEpoch: state.targetEpoch });
          if (isClosed || generationRef.current !== generation) return;
          update(reply.session);
          if (reply.frame && (reply.frame.surface || 'page') === viewMode && sessionRef.current && isCurrentBrowserFrame(sessionRef.current, reply.frame)) {
            surfaceRef.current?.frame(reply.frame);
          }
        } else {
          await invoke({ kind: 'detach', viewerId });
        }
      } catch (failure) {
        if (!isClosed) {
          setError(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
          surfaceRef.current?.clear();
          setIsFrameReady(false);
        }
      }
      if (!isClosed) timer = setTimeout(() => void poll(), document.visibilityState === 'visible' ? 350 : 2000);
    }
    void poll();
    return () => {
      isClosed = true;
      generationRef.current += 1;
      if (timer) clearTimeout(timer);
      surfaceRef.current?.clear();
      // Detach only the view. The server retains the browser and human lease.
      void invoke({ kind: 'detach', viewerId }).catch(() => {});
    };
  }, [conversationId, invoke, isActive, selectedSurface, t, update]);

  const isController = session?.state === 'human' && session.isController && !isTransferring && !isFileTransferring && !error;
  const isStoppedController = session?.state === 'stopped' && session.isController && session.isHumanControlHeld && !isTransferring && !error;
  const isReturnAvailable = !!(isController || isStoppedController);
  isInteractiveRef.current = !!isController;

  const onAction = useCallback(
    async (kind: 'take' | 'return' | 'navigate' | 'back' | 'forward' | 'reload' | 'new-tab' | 'select-tab' | 'close-tab', targetId?: string) => {
      const current = sessionRef.current;
      if (!current) return;
      const generation = generationRef.current;
      const epochs = { controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch };
      const action: BrowserSessionAction = kind === 'navigate' ? { kind, url, ...epochs } : kind === 'return' ? { kind, note, ...epochs } : kind === 'select-tab' || kind === 'close-tab' ? { kind, targetId: targetId!, ...epochs } : { kind, ...epochs };
      if (kind === 'take' || kind === 'return') setIsTransferring(true);
      try {
        const reply = await invoke(action);
        if (generationRef.current !== generation) return;
        update(reply.session);
        if (kind === 'return') setNote('');
      } catch (failure) {
        if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
      } finally {
        if (generationRef.current === generation) setIsTransferring(false);
      }
    },
    [invoke, note, t, update, url]
  );

  useEffect(() => {
    if (!imageRef.current) return;
    const surface = new PageSurface(imageRef.current, (value: unknown) => {
      const current = sessionRef.current;
      if (!isInteractiveRef.current || !current || current.state !== 'human' || !current.isController) return;
      const input = BrowserInputSchema.safeParse(value);
      if (!input.success) return;
      const generation = generationRef.current;
      void invokeRef
        .current?.({ kind: 'input', input: input.data, surface: surfaceModeRef.current, controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch })
        .then((reply) => {
          if (generationRef.current === generation) updateRef.current(reply.session);
        })
        .catch((failure: unknown) => {
          if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
        });
    });
    surfaceRef.current = surface;
    return () => {
      surface.dispose();
      surfaceRef.current = null;
    };
  }, [t]);

  const onInsertText = async () => {
    const current = sessionRef.current;
    if (!current || !isController || !text) return;
    try {
      const reply = await invoke({ kind: 'input', input: { kind: 'text', text }, surface: surfaceModeRef.current, controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch });
      update(reply.session);
      setText('');
    } catch (failure) {
      Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
    }
  };

  const onStart = async () => {
    const generation = generationRef.current;
    setIsTransferring(true);
    try {
      const reply = await invoke({ kind: 'start', isHeadless, transport });
      if (generationRef.current === generation) update(reply.session);
    } catch (failure) {
      Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
    } finally {
      if (generationRef.current === generation) setIsTransferring(false);
    }
  };

  const onRespondDialog = async (isAccepted: boolean) => {
    const current = sessionRef.current;
    if (!current || current.state !== 'human' || !current.isController) return;
    try {
      const reply = await invoke({ kind: 'input', surface: 'page', input: { kind: 'dialog', accept: isAccepted, text: dialogText }, controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch });
      update(reply.session);
      setDialogText('');
    } catch (failure) {
      Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
    }
  };

  const onLifecycle = (kind: 'stop' | 'restart') => {
    const generation = generationRef.current;
    const requestedMode = { isHeadless, transport };
    Modal.confirm({
      title: t(`conversation.browserSession.${kind}ConfirmTitle`),
      content: t(`conversation.browserSession.${kind}ConfirmBody`, { mode: t(`conversation.browserSession.${isHeadless ? 'headless' : 'headful'}`), transport: t(`conversation.browserSession.${transport}`) }),
      okText: t(`conversation.browserSession.${kind}`),
      cancelText: t('common.cancel'),
      onOk: async () => {
        const current = sessionRef.current;
        if (generationRef.current !== generation || !current || current.state !== 'human' || !current.isController) return;
        setIsTransferring(true);
        surfaceRef.current?.clear();
        setIsFrameReady(false);
        try {
          const epochs = { controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch };
          const action: BrowserSessionAction = kind === 'stop' ? { kind, ...epochs } : { kind, ...requestedMode, acknowledgeStateLoss: true, ...epochs };
          const reply = await invoke(action);
          if (generationRef.current === generation) update(reply.session);
        } catch (failure) {
          if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
        } finally {
          if (generationRef.current === generation) setIsTransferring(false);
        }
      },
    });
  };

  const onSelectFiles = async (files: FileList | null) => {
    const current = sessionRef.current;
    const chooser = current?.fileChooser;
    const choice = fileChoiceRef.current;
    fileChoiceRef.current = null;
    if (!current || !chooser || !choice || !isController || !files?.length) return;
    if (choice.generation !== generationRef.current || choice.chooserId !== chooser.id || choice.controlEpoch !== current.controlEpoch || choice.targetEpoch !== current.targetEpoch) {
      Message.error(t('conversation.browserSession.fileChooserChanged'));
      return;
    }
    const generation = generationRef.current;
    const selected = Array.from(files);
    if (selected.length > 20 || (chooser.mode === 'selectSingle' && selected.length !== 1) || selected.some((file) => file.size > 16 * 1024 * 1024)) {
      Message.error(t('conversation.browserSession.fileLimit'));
      return;
    }
    const isCurrentChooser = () => {
      const next = sessionRef.current;
      return generationRef.current === generation && next?.isController && next.state === 'human' && next.fileChooser?.id === chooser.id && next.controlEpoch === current.controlEpoch && next.targetEpoch === current.targetEpoch;
    };
    setIsFileTransferring(true);
    try {
      const fileIds: string[] = [];
      for (const file of selected) {
        if (!isCurrentChooser()) throw new Error(t('conversation.browserSession.fileChooserChanged'));
        const data = new Uint8Array(await file.arrayBuffer());
        if (!isCurrentChooser()) throw new Error(t('conversation.browserSession.fileChooserChanged'));
        const reply = await ipcBridge.browserSession.uploadFile.invoke({ conversationId, name: file.name, data, controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch });
        if (!reply.success) throw new Error(t('conversation.browserSession.fileTransferFailed'));
        fileIds.push(BrowserFileSchema.parse(reply.data).id);
      }
      if (!isCurrentChooser()) throw new Error(t('conversation.browserSession.fileChooserChanged'));
      const reply = await invoke({ kind: 'upload-files', chooserId: chooser.id, fileIds, controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch });
      if (generationRef.current === generation) update(reply.session);
    } catch (failure) {
      if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.fileTransferFailed'));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (generationRef.current === generation) setIsFileTransferring(false);
    }
  };

  const onDownloadFile = async (file: BrowserFile) => {
    const generation = generationRef.current;
    setIsFileTransferring(true);
    try {
      const reply = await ipcBridge.browserSession.downloadFile.invoke({ conversationId, fileId: file.id });
      if (generationRef.current !== generation) return;
      if (!reply.success || !reply.data) throw new Error(t('conversation.browserSession.fileTransferFailed'));
      const data = new Uint8Array(reply.data);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (data.byteLength !== file.bytes || digest !== file.sha256) throw new Error(t('conversation.browserSession.fileTransferFailed'));
      if (generationRef.current !== generation) return;
      const url = URL.createObjectURL(new Blob([data.buffer], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (failure) {
      if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.fileTransferFailed'));
    } finally {
      if (generationRef.current === generation) setIsFileTransferring(false);
    }
  };

  return (
    <div className='h-full min-h-0 flex flex-col gap-2 p-2' data-testid='browser-session-panel'>
      <div className='flex flex-wrap items-center gap-2'>
        <span role='status'>{isTransferring ? t('conversation.browserSession.transferring') : t(`conversation.browserSession.state.${session?.state || 'stopped'}`)}</span>
        {session ? <span className='text-xs text-t-secondary'>{t(`conversation.browserSession.${session.isHeadless ? 'headless' : 'headful'}`)}</span> : null}
        <Button size='mini' disabled={!session || session.state !== 'ai' || isTransferring || !!error} onClick={() => void onAction('take')}>
          {t('conversation.browserSession.take')}
        </Button>
        <Button size='mini' disabled={!isReturnAvailable} onClick={() => void onAction('return')}>
          {t('conversation.browserSession.return')}
        </Button>
        {!isViewer ? (
          <Button size='mini' onClick={() => window.open(`${location.pathname}${location.search}#/browser-viewer/${encodeURIComponent(conversationId)}`, '_blank', 'noopener')}>
            {t('conversation.browserSession.openViewer')}
          </Button>
        ) : null}
        {session?.capabilities.windowView ? (
          <Select
            aria-label={t('conversation.browserSession.viewMode')}
            value={selectedSurface || 'window'}
            onChange={setSelectedSurface}
            style={{ width: 180 }}
            options={[
              { value: 'window', label: t('conversation.browserSession.windowView') },
              { value: 'page', label: t('conversation.browserSession.pageView') },
            ]}
          />
        ) : null}
      </div>
      {session?.state === 'stopped' || (isController && session?.capabilities.lifecycle) ? (
        <div className='flex flex-wrap items-center gap-2'>
          <Select
            aria-label={t('conversation.browserSession.launchMode')}
            value={isHeadless ? 'headless' : 'headful'}
            disabled={isTransferring}
            onChange={(value) => setIsHeadless(value === 'headless')}
            style={{ width: 140 }}
            options={[
              { value: 'headless', label: t('conversation.browserSession.headless') },
              { value: 'headful', label: t('conversation.browserSession.headful') },
            ]}
          />
          <Select
            aria-label={t('conversation.browserSession.transport')}
            value={transport}
            disabled={isTransferring}
            onChange={setTransport}
            style={{ width: 220 }}
            options={[
              { value: 'extension', label: t('conversation.browserSession.extension') },
              { value: 'cdp', label: t('conversation.browserSession.cdp') },
            ]}
          />
          {session.state === 'stopped' ? (
            <Button size='mini' disabled={isTransferring || !!error} onClick={() => void onStart()}>
              {t('conversation.browserSession.start')}
            </Button>
          ) : (
            <>
              <Button size='mini' disabled={!isController} onClick={() => onLifecycle('restart')}>
                {t('conversation.browserSession.restart')}
              </Button>
              <Button size='mini' disabled={!isController} onClick={() => onLifecycle('stop')}>
                {t('conversation.browserSession.stop')}
              </Button>
            </>
          )}
        </div>
      ) : null}
      {isStoppedController ? <div role='status'>{t('conversation.browserSession.stoppedHuman')}</div> : null}
      {session?.capabilities.fileTransfer && session.fileChooser ? (
        <div className='flex items-center gap-2' data-testid='browser-file-chooser'>
          <span>{t('conversation.browserSession.chooseFilesPrompt')}</span>
          <input ref={fileInputRef} type='file' className='hidden' aria-label={t('conversation.browserSession.chooseFiles')} multiple={session.fileChooser.mode === 'selectMultiple'} disabled={!isController} onChange={(event) => void onSelectFiles(event.target.files)} />
          <Button
            size='mini'
            disabled={!isController}
            loading={isFileTransferring}
            onClick={() => {
              const current = sessionRef.current;
              if (!current?.fileChooser || current.state !== 'human' || !current.isController) return;
              fileChoiceRef.current = { generation: generationRef.current, chooserId: current.fileChooser.id, controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch };
              fileInputRef.current?.click();
            }}
          >
            {t('conversation.browserSession.chooseFiles')}
          </Button>
        </div>
      ) : null}
      {session?.capabilities.fileTransfer && session.downloads?.length ? (
        <div aria-label={t('conversation.browserSession.downloads')} className='flex flex-wrap gap-2' data-testid='browser-downloads'>
          {session.downloads.map((file) => (
            <Button key={file.id} size='mini' disabled={isFileTransferring} onClick={() => void onDownloadFile(file)}>
              {t('conversation.browserSession.downloadFile', { name: file.name })}
            </Button>
          ))}
        </div>
      ) : null}
      {session?.dialog ? (
        <div role='alertdialog' aria-label={t('conversation.browserSession.dialog')} className='flex flex-wrap items-center gap-2'>
          <span>{session.dialog.message}</span>
          {session.dialog.type === 'prompt' ? <Input aria-label={t('conversation.browserSession.dialogText')} value={dialogText} onChange={setDialogText} maxLength={512} style={{ width: 240 }} /> : null}
          <Button size='mini' disabled={session.state !== 'human' || !session.isController || isTransferring} onClick={() => void onRespondDialog(true)}>
            {t('conversation.browserSession.acceptDialog')}
          </Button>
          <Button size='mini' disabled={session.state !== 'human' || !session.isController || isTransferring} onClick={() => void onRespondDialog(false)}>
            {t('conversation.browserSession.dismissDialog')}
          </Button>
        </div>
      ) : null}
      {session?.tabs.length ? (
        <div role='tablist' className='flex flex-wrap gap-1'>
          {session.tabs.map((tab) => (
            <div key={tab.id} className='flex items-center'>
              <Button size='mini' role='tab' aria-selected={tab.id === session.activeTargetId} disabled={!isController} onClick={() => void onAction('select-tab', tab.id)}>
                {tab.title || tab.url || t('conversation.browserSession.tab')}
              </Button>
              <Button size='mini' aria-label={t('conversation.browserSession.closeTab')} disabled={!isController} onClick={() => void onAction('close-tab', tab.id)}>
                ×
              </Button>
            </div>
          ))}
          <Button size='mini' disabled={!isController} onClick={() => void onAction('new-tab')}>
            +
          </Button>
        </div>
      ) : null}
      <div className='flex items-center gap-1'>
        <Button size='mini' aria-label={t('conversation.browserSession.back')} disabled={!isController} onClick={() => void onAction('back')}>
          ←
        </Button>
        <Button size='mini' aria-label={t('conversation.browserSession.forward')} disabled={!isController} onClick={() => void onAction('forward')}>
          →
        </Button>
        <Button size='mini' disabled={!isController} onClick={() => void onAction('reload')}>
          {t('conversation.browserSession.reload')}
        </Button>
        <Input aria-label={t('conversation.browserSession.address')} value={url} disabled={!isController} onChange={setUrl} onPressEnter={() => void onAction('navigate')} />
      </div>
      <div className='relative flex-1 min-h-0 overflow-auto flex items-start justify-center'>
        <img
          ref={imageRef}
          alt={t('conversation.browserSession.page')}
          tabIndex={isController ? 0 : -1}
          onLoad={() => setIsFrameReady(true)}
          className='max-w-full max-h-full object-contain outline-none'
          style={{ pointerEvents: isController ? 'auto' : 'none', touchAction: 'none', visibility: isFrameReady ? 'visible' : 'hidden' }}
        />
        {!isFrameReady ? <div className='absolute inset-0 flex items-center justify-center'>{error ? <Empty description={error} /> : session?.state === 'stopped' ? <Empty description={t('conversation.browserSession.waiting')} /> : <Spin />}</div> : null}
      </div>
      {isController ? (
        <>
          <div className='flex gap-1'>
            <Input aria-label={t('conversation.browserSession.text')} value={text} maxLength={512} onChange={setText} onPressEnter={() => void onInsertText()} />
            <Button size='mini' disabled={!text} onClick={() => void onInsertText()}>
              {t('conversation.browserSession.insert')}
            </Button>
          </div>
        </>
      ) : null}
      {isReturnAvailable ? <Input aria-label={t('conversation.browserSession.note')} placeholder={t('conversation.browserSession.note')} value={note} maxLength={2000} onChange={setNote} /> : null}
      {session?.state === 'human' && error ? <div role='alert'>{t('conversation.browserSession.disconnected')}</div> : null}
    </div>
  );
}

interface IBrowserSessionPanelProps {
  conversationId: string;
  isActive?: boolean;
  isViewer?: boolean;
}
