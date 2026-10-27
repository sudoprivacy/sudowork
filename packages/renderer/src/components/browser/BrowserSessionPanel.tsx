import { Button, Collapse, Empty, Input, Message, Modal, Select, Spin } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { BrowserFileSchema, BrowserInputSchema, BrowserOwnerInfoSchema, BrowserSessionReplySchema, isCurrentBrowserFrame, type BrowserFile, type BrowserInput, type BrowserOwnerInfo, type BrowserSessionAction, type BrowserSessionReply, type BrowserSessionState } from '@sudowork/contracts/browser-session';
import { PageSurface } from '@ai-dev-browser/remote-page';
import { copyTextFromPromise } from '../../utils/clipboard';
import WindowStreamSurface, { type IWindowStreamContext } from './WindowStreamSurface';
import { openBrowserSessionWindow } from './openBrowserSessionWindow';
import { isElectronDesktop } from '../../utils/platform';

function isLiveDragCancellation(input: BrowserInput) {
  return input.kind === 'drag-stream' && input.phase === 'cancel';
}

/** Carries the untranslated bridge error code so callers can branch on the cause. */
class BrowserPanelError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** Shared remote browser UI. The host authenticates and enforces every action. */
export default function BrowserSessionPanel({ conversationId, isActive = true, isViewer = false, isControlsOnly = false, initialTransport = 'extension' }: IBrowserSessionPanelProps) {
  const { t } = useTranslation();
  const [session, setSession] = useState<BrowserSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isOpeningSeparate, setIsOpeningSeparate] = useState(false);
  const [isFileTransferring, setIsFileTransferring] = useState(false);
  const [isClipboardBusy, setIsClipboardBusy] = useState(false);
  const [isTextComposing, setIsTextComposing] = useState(false);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [dialogText, setDialogText] = useState('');
  const [isFrameReady, setIsFrameReady] = useState(false);
  const [isHeadless, setIsHeadless] = useState(true);
  const [transport, setTransport] = useState<'extension' | 'cdp'>(initialTransport);
  const [selectedSurface, setSelectedSurface] = useState<'page' | 'window' | null>(null);
  const [imageZoom, setImageZoom] = useState<number | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const [windowStream, setWindowStream] = useState<IWindowStreamContext | null>(null);
  const [pageViewerId, setPageViewerId] = useState<string | undefined>(undefined);
  const [occupancy, setOccupancy] = useState<BrowserOwnerInfo | null>(null);
  const windowStreamRef = useRef<IWindowStreamContext | null>(null);
  const isTouchInputAvailable = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileChoiceRef = useRef<{ generation: number; chooserId: string; controlEpoch: number; targetEpoch: number } | null>(null);
  const surfaceRef = useRef<PageSurface | null>(null);
  const sessionRef = useRef<BrowserSessionState | null>(null);
  const invokeRef = useRef<((action: BrowserSessionAction) => Promise<BrowserSessionReply>) | undefined>(undefined);
  const isInteractiveRef = useRef(false);
  const isFrameReadyRef = useRef(false);
  const surfaceModeRef = useRef<'page' | 'window'>('page');
  const generationRef = useRef(0);
  const pendingInputsRef = useRef<Promise<void>>(Promise.resolve());

  const invoke = useCallback(
    async (action: BrowserSessionAction) => {
      const reply = await ipcBridge.browserSession.invoke.invoke({ conversationId, action });
      if (!reply?.success) {
        const code = reply?.msg || 'unavailable';
        throw new BrowserPanelError(t(`conversation.browserSession.errors.${code}`, { defaultValue: t('conversation.browserSession.unavailable') }), code);
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
      windowStreamRef.current = null;
      setWindowStream(null);
      surfaceRef.current?.clear();
      isFrameReadyRef.current = false;
      isInteractiveRef.current = false;
      setIsFrameReady(false);
    }
    sessionRef.current = next;
    setSession(next);
    setOccupancy(null);
    if ((!previous || !isSameBrowser) && next.state !== 'stopped') {
      if (next.isHeadless !== null) setIsHeadless(next.isHeadless);
      if (next.transport !== 'electron') setTransport(next.transport);
    }
    if (!previous && next.state === 'stopped' && next.transport !== 'electron') setTransport(next.capabilities.existingExtension ? 'cdp' : next.transport);
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
    let attachedBrowserId: string | undefined;
    let attachedSurface: 'page' | 'window' | undefined;
    let isStateNeeded = true;
    let unsupportedStreamBrowserId: string | undefined;
    const viewerId = crypto.randomUUID();
    setPageViewerId(undefined);
    sessionRef.current = null;
    windowStreamRef.current = null;
    setWindowStream(null);
    setTransport(initialTransport);
    setSession(null);
    setError(null);
    isFrameReadyRef.current = false;
    isInteractiveRef.current = false;
    setIsFrameReady(false);
    setIsFileTransferring(false);
    setIsOpeningSeparate(false);
    setIsClipboardBusy(false);
    setIsTextComposing(false);
    fileChoiceRef.current = null;
    if (!isActive || !conversationId) return;
    let occupancyCheckedAt = 0;
    const refreshOccupancy = async () => {
      if (performance.now() - occupancyCheckedAt < 5_000) return;
      occupancyCheckedAt = performance.now();
      try {
        const reply = await ipcBridge.browserSession.ownerInfo.invoke({ conversationId });
        if (isClosed || !reply?.success || !reply.data) return;
        setOccupancy(BrowserOwnerInfoSchema.parse(reply.data));
      } catch {
        // The next poll cycle retries the occupancy read.
      }
    };

    async function poll() {
      const startedAt = performance.now();
      try {
        // Frame replies already carry authoritative session state. Fetching
        // state and attaching again before every frame adds two cloud round
        // trips without improving ownership checks on the host.
        const previous = sessionRef.current;
        if (isStateNeeded || !previous || windowStreamRef.current || isControlsOnly || document.visibilityState !== 'visible' || previous.state === 'stopped') {
          const stateReply = await invoke({ kind: 'state' });
          if (isClosed) return;
          update(stateReply.session);
          isStateNeeded = false;
        }
        const current = sessionRef.current!;
        const viewMode = isViewer && selectedSurface !== 'page' && current.capabilities.windowView ? 'window' : 'page';
        surfaceModeRef.current = viewMode;
        if (isControlsOnly) {
          // This window observes the lease without attaching a pixel viewer.
        } else if (document.visibilityState === 'visible' && current.state !== 'stopped' && current.capabilities.pageView && current.activeTargetId) {
          if (attachedBrowserId !== current.browserSessionId || attachedSurface !== viewMode) {
            const attached = await invoke({ kind: 'attach', viewerId, surface: viewMode });
            if (isClosed) return;
            update(attached.session);
            attachedBrowserId = attached.session.browserSessionId;
            attachedSurface = viewMode;
            setPageViewerId(viewMode === 'page' ? viewerId : undefined);
          }
          const state = sessionRef.current!;
          const isStreamingSupported = viewMode === 'window' && state.capabilities.windowStream === true && unsupportedStreamBrowserId !== state.browserSessionId;
          if (isStreamingSupported && !windowStreamRef.current) {
            const reply = await invoke({ kind: 'window-stream', viewerId, controlEpoch: state.controlEpoch, targetEpoch: state.targetEpoch });
            if (isClosed || generationRef.current !== generation) return;
            update(reply.session);
            const latest = sessionRef.current;
            const isCurrentStream = latest?.browserSessionId === reply.session.browserSessionId && latest.profileId === reply.session.profileId && latest.controlEpoch === reply.session.controlEpoch && latest.targetEpoch === reply.session.targetEpoch;
            if (reply.stream?.socketPath && isCurrentStream) {
              const stream = { viewerId, password: reply.stream.password, socketPath: reply.stream.socketPath, browserSessionId: reply.session.browserSessionId, controlEpoch: reply.session.controlEpoch, targetEpoch: reply.session.targetEpoch };
              windowStreamRef.current = stream;
              setWindowStream(stream);
            } else if (!reply.stream?.socketPath) {
              // A host without a socket adapter retains the existing frame API.
              unsupportedStreamBrowserId = state.browserSessionId;
            }
          }
          if (!windowStreamRef.current) {
            const reply = await invoke({ kind: 'frame', viewerId, surface: viewMode, controlEpoch: state.controlEpoch, targetEpoch: state.targetEpoch });
            if (isClosed || generationRef.current !== generation) return;
            update(reply.session);
            if (reply.frame && (reply.frame.surface || 'page') === viewMode && sessionRef.current && isCurrentBrowserFrame(sessionRef.current, reply.frame)) {
              surfaceRef.current?.frame(reply.frame);
            }
          }
        } else {
          if (attachedBrowserId) await invoke({ kind: 'detach', viewerId });
          attachedBrowserId = undefined;
          attachedSurface = undefined;
          setPageViewerId(undefined);
          isStateNeeded = true;
          windowStreamRef.current = null;
          setWindowStream(null);
        }
      } catch (failure) {
        // A restarted browser, expired attachment or changed target requires
        // fresh state and an explicit reattachment. Never replay user input.
        isStateNeeded = true;
        attachedBrowserId = undefined;
        attachedSurface = undefined;
        setPageViewerId(undefined);
        windowStreamRef.current = null;
        setWindowStream(null);
        if (!isClosed) {
          if (failure instanceof BrowserPanelError && failure.code === 'browser_profile_in_use') {
            // Another conversation holds this owner's profile; show who instead of a transient error.
            setOccupancy((previous) => previous ?? { owner: null, browserRunning: false });
            void refreshOccupancy();
            setError(null);
          } else {
            setOccupancy(null);
            setError(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
          }
          surfaceRef.current?.clear();
          isFrameReadyRef.current = false;
          isInteractiveRef.current = false;
          setIsFrameReady(false);
        }
      }
      if (!isClosed) {
        const interval = isControlsOnly || document.visibilityState !== 'visible' ? 2000 : sessionRef.current?.state === 'stopped' || windowStreamRef.current ? 1000 : 250;
        timer = setTimeout(() => void poll(), Math.max(0, interval - (performance.now() - startedAt)));
      }
    }
    void poll();
    return () => {
      isClosed = true;
      generationRef.current += 1;
      if (timer) clearTimeout(timer);
      surfaceRef.current?.clear();
      windowStreamRef.current = null;
      // Detach only the view. The server retains the browser and human lease.
      void invoke({ kind: 'detach', viewerId }).catch(() => {});
    };
  }, [conversationId, initialTransport, invoke, isActive, isControlsOnly, isViewer, selectedSurface, t, update]);

  const isConversationControlSupported = session?.capabilities.conversationControl === true;
  const isSessionKnown = session !== null;
  const isDragSupported = session?.capabilities.dragInput === true;
  const isPageLiveDragSupported = session?.capabilities.liveDragSurfaces?.includes('page') === true;
  // Takeover mirrors the registry claim rule: only an active session keeps a running browser.
  const isOccupancyTakeoverEnabled = occupancy !== null && !(occupancy.owner?.desiredState === 'active' && occupancy.browserRunning);
  const occupantSessionId = occupancy?.owner ? occupancy.owner.sessionId.slice(0, 8) : '';
  const occupancyView = occupancy ? (
    <div className='flex flex-wrap items-center gap-2' data-testid='browser-session-occupied'>
      <span role='status'>
        {occupancy.browserRunning
          ? t('conversation.browserSession.occupiedRunning', { sessionId: occupantSessionId })
          : t('conversation.browserSession.occupiedIdle', { sessionId: occupantSessionId })}
      </span>
      <Button size='mini' disabled={!isOccupancyTakeoverEnabled || isTransferring} onClick={() => void onStart()}>
        {t('conversation.browserSession.takeover')}
      </Button>
      <Button size='mini' disabled={!occupancy.owner || isTransferring} onClick={() => void onTerminateOccupant()}>
        {t('conversation.browserSession.terminateOccupant')}
      </Button>
    </div>
  ) : null;
>>>>>>> 134f5dbe (feat(browser): add profile occupancy handling and takeover controls)
  const isController = isConversationControlSupported && session?.state === 'human' && session.isController && !isTransferring && !isFileTransferring && !error;
  const isStoppedController = isConversationControlSupported && session?.state === 'stopped' && session.isController && session.isHumanControlHeld && !isTransferring && !error;
  isInteractiveRef.current = !!isController && isFrameReady && !isPanning;

  const onStreamReady = (size: { width: number; height: number }) => {
    const state = sessionRef.current;
    const stream = windowStreamRef.current;
    if (!state || !stream || stream.browserSessionId !== state.browserSessionId || stream.controlEpoch !== state.controlEpoch || stream.targetEpoch !== state.targetEpoch) return;
    setImageSize(size);
    isFrameReadyRef.current = true;
    setIsFrameReady(true);
  };

  const onStreamDisconnect = () => {
    windowStreamRef.current = null;
    setWindowStream(null);
    isFrameReadyRef.current = false;
    isInteractiveRef.current = false;
    setIsFrameReady(false);
  };

  useEffect(() => {
    setImageZoom(null);
    setIsPanning(false);
    panRef.current = null;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = viewport.scrollTop = 0;
  }, [conversationId]);

  const onImageLoad = () => {
    const image = imageRef.current;
    if (!image?.getAttribute('src')) return;
    setImageSize((previous) => (previous.width === image.naturalWidth && previous.height === image.naturalHeight ? previous : { width: image.naturalWidth, height: image.naturalHeight }));
    isFrameReadyRef.current = true;
    setIsFrameReady(true);
  };

  const onImageZoom = (value: string | number) => {
    const zoom = value === 'fit' ? null : Number(value);
    if (zoom !== null && (!Number.isFinite(zoom) || zoom < 0.25 || zoom > 2)) return;
    setImageZoom(zoom);
    setIsPanning(zoom !== null);
    panRef.current = null;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = viewport.scrollTop = 0;
    viewportRef.current?.focus({ preventScroll: true });
  };

  const onPanStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPanning || panRef.current || event.button !== 0) return;
    const viewport = event.currentTarget;
    panRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture?.(event.pointerId);
    viewport.focus({ preventScroll: true });
    event.preventDefault();
  };

  const onPanMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!isPanning || pan?.id !== event.pointerId) return;
    event.currentTarget.scrollLeft = pan.left + pan.x - event.clientX;
    event.currentTarget.scrollTop = pan.top + pan.y - event.clientY;
    event.preventDefault();
  };

  const onPanEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.id !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const queueInput = useCallback(
    (input: BrowserInput, context?: IBrowserInputContext) => {
      const observed = context ? context.session : sessionRef.current;
      const generation = context ? context.generation : generationRef.current;
      const surface = context ? context.surface : surfaceModeRef.current;
      const operation = pendingInputsRef.current.then(() => {
        const current = sessionRef.current;
        if (
          !observed ||
          !current ||
          (!isFrameReadyRef.current && !isLiveDragCancellation(input)) ||
          generationRef.current !== generation ||
          current.browserSessionId !== observed.browserSessionId ||
          current.profileId !== observed.profileId ||
          current.controlEpoch !== observed.controlEpoch ||
          current.targetEpoch !== observed.targetEpoch ||
          current.state !== 'human' ||
          !current.isController ||
          !invokeRef.current
        )
          throw new Error(t('conversation.browserSession.unavailable'));
        return invokeRef.current({ kind: 'input', input, surface, controlEpoch: observed.controlEpoch, targetEpoch: observed.targetEpoch });
      });
      // Mouse, keyboard and the Unicode input box share one acknowledged order.
      // A failed operation still releases the queue; each caller reports its error.
      pendingInputsRef.current = operation.then(
        () => {},
        () => {}
      );
      return operation;
    },
    [t]
  );

  const onStreamInput = useCallback(
    (value: unknown) => {
      const input = BrowserInputSchema.safeParse(value);
      if (!input.success || (!isInteractiveRef.current && !isLiveDragCancellation(input.data))) return Promise.reject(new Error(t('conversation.browserSession.unavailable')));
      const generation = generationRef.current;
      return queueInput(input.data)
        .then((reply) => {
          if (generationRef.current === generation) updateRef.current(reply.session);
        })
        .catch((failure: unknown) => {
          if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
          throw failure;
        });
    },
    [queueInput, t]
  );

  const onAction = useCallback(
    async (kind: 'navigate' | 'back' | 'forward' | 'reload' | 'new-tab' | 'select-tab' | 'close-tab', targetId?: string) => {
      const generation = generationRef.current;
      try {
        await pendingInputsRef.current;
        if (generationRef.current !== generation) return;
        const current = sessionRef.current;
        if (!current) return;
        const epochs = { controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch };
        const action: BrowserSessionAction = kind === 'navigate' ? { kind, url, ...epochs } : kind === 'select-tab' || kind === 'close-tab' ? { kind, targetId: targetId!, ...epochs } : { kind, ...epochs };
        const reply = await invoke(action);
        if (generationRef.current !== generation) return;
        update(reply.session);
      } catch (failure) {
        if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
      } finally {
        if (generationRef.current === generation) setIsTransferring(false);
      }
    },
    [invoke, t, update, url]
  );

  const interruptRef = useRef(false);
  const onBrowserInterrupt = async () => {
    if (interruptRef.current || isPanning || !isFrameReady || sessionRef.current?.state !== 'ai' || !isConversationControlSupported) return;
    const generation = generationRef.current;
    interruptRef.current = true;
    setIsTransferring(true);
    try {
      // This is the existing task interrupt, including host acknowledgements.
      // The initiating gesture is discarded: it was aimed at an older frame.
      const reply = await ipcBridge.conversation.stop.invoke({ conversation_id: conversationId });
      if (!reply?.success) throw new Error(reply?.msg || t('conversation.browserSession.unavailable'));
      const deadline = performance.now() + 30_000;
      while (generationRef.current === generation) {
        const next = await invoke({ kind: 'state' });
        if (generationRef.current !== generation) return;
        update(next.session);
        if (next.session.state === 'human' && next.session.isController) return;
        if (next.session.state === 'error' || performance.now() >= deadline) throw new Error(t('conversation.browserSession.unavailable'));
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (failure) {
      if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
    } finally {
      interruptRef.current = false;
      if (generationRef.current === generation) setIsTransferring(false);
    }
  };

  useEffect(() => {
    if (!imageRef.current || !isSessionKnown) return;
    const surface = new PageSurface(
      imageRef.current,
      (value: unknown) => {
        const pending = onStreamInput(value);
        // The shared mapper coalesces live positions until the checked API
        // acknowledges each packet. Legacy one-shot input has no promise user.
        if (value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'drag-stream') return pending;
        void pending.catch(() => {});
      },
      { drag: isDragSupported, touchDrag: isTouchDragging, liveDrag: isPageLiveDragSupported && !!pageViewerId, viewerId: pageViewerId }
    );
    surfaceRef.current = surface;
    return () => {
      surface.dispose();
      isFrameReadyRef.current = false;
      isInteractiveRef.current = false;
      setIsFrameReady(false);
      surfaceRef.current = null;
    };
  }, [onStreamInput, isControlsOnly, isSessionKnown, isDragSupported, isPageLiveDragSupported, isTouchDragging, pageViewerId, windowStream]);

  const onTouchGestureChange = (value: string) => {
    // A second finger can change this control during an unfinished gesture.
    // Discard that gesture synchronously and wait for a fresh frame.
    surfaceRef.current?.clear();
    isFrameReadyRef.current = false;
    isInteractiveRef.current = false;
    setIsFrameReady(false);
    setIsTouchDragging(value === 'drag');
  };

  const onInsertText = async () => {
    const current = sessionRef.current;
    if (!current || !isController || !text) return;
    const generation = generationRef.current;
    const submitted = text;
    try {
      const input = BrowserInputSchema.safeParse({ kind: current.capabilities.clipboardText ? 'paste' : 'text', text: submitted });
      if (!input.success) throw new Error(t('conversation.browserSession.clipboardTooLong'));
      const reply = await queueInput(input.data);
      if (generationRef.current !== generation) return;
      update(reply.session);
      setText((value) => (value === submitted ? '' : value));
    } catch (failure) {
      Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
    }
  };

  const onCopySelection = async () => {
    const current = sessionRef.current;
    if (!isController || !current?.capabilities.selectionRead || current.state !== 'human' || !current.isController || !isFrameReadyRef.current || isClipboardBusy) return;
    const context = { session: current, generation: generationRef.current, surface: surfaceModeRef.current };
    setIsClipboardBusy(true);
    try {
      const selection = queueInput({ kind: 'copy-selection' }, context).then((reply) => {
        const active = sessionRef.current;
        if (
          generationRef.current !== context.generation ||
          !active ||
          active.browserSessionId !== current.browserSessionId ||
          active.profileId !== current.profileId ||
          active.controlEpoch !== current.controlEpoch ||
          active.targetEpoch !== current.targetEpoch ||
          active.state !== 'human' ||
          !active.isController ||
          reply.session.browserSessionId !== current.browserSessionId ||
          reply.session.profileId !== current.profileId ||
          reply.session.controlEpoch !== current.controlEpoch ||
          reply.session.targetEpoch !== current.targetEpoch
        )
          throw new Error(t('conversation.browserSession.unavailable'));
        update(reply.session);
        if (!reply.selection?.isAvailable || !reply.selection.text) throw new Error(t('conversation.browserSession.selectionUnavailable'));
        return reply.selection.text;
      });
      // Begin the write in this gesture; WebKit receives remote data as a promise.
      await copyTextFromPromise(selection);
    } catch (failure) {
      if (generationRef.current === context.generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.clipboardUnavailable'));
    } finally {
      if (generationRef.current === context.generation) setIsClipboardBusy(false);
    }
  };

  const onPasteClipboard = async () => {
    const current = sessionRef.current;
    if (!isController || !current?.capabilities.clipboardText || current.state !== 'human' || !current.isController || !isFrameReadyRef.current || isClipboardBusy) return;
    const context = { session: current, generation: generationRef.current, surface: surfaceModeRef.current };
    setIsClipboardBusy(true);
    try {
      if (!navigator.clipboard?.readText) throw new Error(t('conversation.browserSession.clipboardUnavailable'));
      // Read only on this explicit user gesture. Freeze the destination before
      // the browser's clipboard permission UI can yield to another task/tab.
      // Windows clipboard reads use CRLF. Normalize before trusted insertion
      // so remote input listeners see the same text as native browser paste.
      const pasted = (await navigator.clipboard.readText()).replace(/\r\n/g, '\n');
      if (!pasted) return;
      const input = BrowserInputSchema.safeParse({ kind: 'paste', text: pasted });
      if (!input.success) throw new Error(t('conversation.browserSession.clipboardTooLong'));
      const reply = await queueInput(input.data, context);
      if (generationRef.current === context.generation) update(reply.session);
    } catch (failure) {
      if (generationRef.current === context.generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.clipboardUnavailable'));
    } finally {
      if (generationRef.current === context.generation) setIsClipboardBusy(false);
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

  const onTerminateOccupant = async () => {
    const occupant = occupancy?.owner;
    if (!occupant) return;
    const generation = generationRef.current;
    setIsTransferring(true);
    try {
      const reply = await ipcBridge.conversation.terminateMossSession.invoke({ conversation_id: occupant.sessionId });
      if (!reply?.success) {
        throw new Error(t(`conversation.browserSession.errors.${reply?.msg || 'unavailable'}`, { defaultValue: t('conversation.browserSession.unavailable') }));
      }
      if (generationRef.current === generation) {
        setOccupancy({ owner: { sessionId: occupant.sessionId, desiredState: 'terminated' }, browserRunning: occupancy?.browserRunning ?? false });
      }
    } catch (failure) {
      if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
    } finally {
      if (generationRef.current === generation) setIsTransferring(false);
    }
  };

  const onInspectExisting = async () => {
    const generation = generationRef.current;
    setIsTransferring(true);
    try {
      const inspected = await invoke({ kind: 'inspect-existing-extension' });
      if (generationRef.current !== generation) return;
      update(inspected.session);
      const selected = inspected.existingExtension;
      if (!selected) {
        Modal.info({ title: t('conversation.browserSession.personalSetupTitle'), content: <div className='whitespace-pre-wrap break-words'>{inspected.setupInstructions || t('conversation.browserSession.personalSetup')}</div> });
        return;
      }
      Modal.confirm({
        title: t('conversation.browserSession.personalConnectTitle'),
        content: t('conversation.browserSession.personalConnectBody', { profile: selected.profileId }),
        okText: t('conversation.browserSession.personalConnect'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          if (generationRef.current !== generation) return;
          setIsTransferring(true);
          try {
            const connected = await invoke({ kind: 'connect-existing-extension', ...selected });
            if (generationRef.current === generation) update(connected.session);
          } catch (failure) {
            if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
            throw failure;
          } finally {
            if (generationRef.current === generation) setIsTransferring(false);
          }
        },
      });
    } catch (failure) {
      if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
    } finally {
      if (generationRef.current === generation) setIsTransferring(false);
    }
  };

  const onDisconnectExisting = () => {
    const generation = generationRef.current;
    Modal.confirm({
      title: t('conversation.browserSession.personalDisconnectTitle'),
      content: t('conversation.browserSession.personalDisconnectBody'),
      okText: t('conversation.browserSession.personalDisconnect'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        if (generationRef.current !== generation) return;
        setIsTransferring(true);
        try {
          await pendingInputsRef.current;
          const current = sessionRef.current;
          if (generationRef.current !== generation || !current || (!current.isController && current.state !== 'stopped')) return;
          const disconnected = await invoke({ kind: 'disconnect-existing-extension', controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch });
          if (generationRef.current === generation) update(disconnected.session);
        } catch (failure) {
          if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
          throw failure;
        } finally {
          if (generationRef.current === generation) setIsTransferring(false);
        }
      },
    });
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
        isFrameReadyRef.current = false;
        isInteractiveRef.current = false;
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

  const isNativeWindowAvailable = isElectronDesktop() && session?.capabilities.nativeWindow === true;
  const onOpenSeparate = async () => {
    if (!isNativeWindowAvailable) {
      openBrowserSessionWindow(conversationId);
      return;
    }
    const generation = generationRef.current;
    setIsOpeningSeparate(true);
    try {
      await pendingInputsRef.current;
      if (generationRef.current !== generation) return;
      let current = sessionRef.current;
      if (!current?.activeTargetId || !current.capabilities.nativeWindow) throw new Error(t('conversation.browserSession.unavailable'));
      if (current.state !== 'human' || !current.isController) {
        const acquired = await invoke({ kind: 'take', controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch });
        if (generationRef.current !== generation) return;
        update(acquired.session);
        current = acquired.session;
      }
      if (!current.activeTargetId || !current.capabilities.nativeWindow || current.state !== 'human' || !current.isController) throw new Error(t('conversation.browserSession.unavailable'));
      // Selecting the existing target brings its native Chrome window forward.
      // It keeps the page, cookies, drafts and shared panel on that same target.
      const reply = await invoke({ kind: 'select-tab', targetId: current.activeTargetId, controlEpoch: current.controlEpoch, targetEpoch: current.targetEpoch });
      if (generationRef.current === generation) update(reply.session);
    } catch (failure) {
      if (generationRef.current === generation) Message.error(failure instanceof Error ? failure.message : t('conversation.browserSession.unavailable'));
    } finally {
      if (generationRef.current === generation) setIsOpeningSeparate(false);
    }
  };

  const controls = (
    <div className='flex flex-wrap items-center gap-2'>
      <span role='status'>{isTransferring ? t('conversation.browserSession.transferring') : t(`conversation.browserSession.state.${session?.state || 'stopped'}`)}</span>
      {session ? <span className='text-xs text-t-secondary'>{t(`conversation.browserSession.${session.isHeadless === null ? 'modeUnknown' : session.isHeadless ? 'headless' : 'headful'}`)}</span> : null}
      {session?.personalExtension ? <span>{t('conversation.browserSession.personalBrowser')}</span> : null}
      {isViewer && !isControlsOnly ? <a href={`${location.pathname}${location.search}#/conversation/${encodeURIComponent(conversationId)}`}>{t('conversation.browserSession.openConversation')}</a> : null}
      {!isViewer || isControlsOnly ? (
        <Button size='mini' disabled={!session || isOpeningSeparate} onClick={() => void onOpenSeparate()}>
          {t(`conversation.browserSession.${isNativeWindowAvailable ? 'openNative' : 'openViewer'}`)}
        </Button>
      ) : null}
      {isViewer && !isControlsOnly && session?.capabilities.windowView ? (
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
  );
  if (isControlsOnly)
    return (
      <div className='h-full min-h-0 box-border flex flex-col gap-2 overflow-auto p-2' data-testid='browser-session-controls'>
        {controls}
        <p className='text-xs text-t-secondary'>{t(`conversation.browserSession.${isConversationControlSupported ? 'conversationControl' : 'conversationUpdateRequired'}`)}</p>
        {error ? <div role='alert'>{error}</div> : null}
        {occupancyView}
      </div>
    );

  return (
    <div className='h-full min-h-0 box-border flex flex-col gap-2 overflow-auto p-2' data-testid='browser-session-panel'>
      {controls}
      <p className='text-xs text-t-secondary'>{t(`conversation.browserSession.${isConversationControlSupported ? 'conversationControl' : 'conversationUpdateRequired'}`)}</p>
      {occupancyView}
      <Collapse bordered={false}>
        <Collapse.Item header={t('conversation.browserSession.browserSource')} name='browser-source'>
          <p className='text-xs text-t-secondary'>{t(`conversation.browserSession.${session?.personalExtension ? 'personalSourceDescription' : session?.capabilities.existingExtension ? 'localSourceDescription' : 'cloudSourceDescription'}`)}</p>
          {session?.capabilities.existingExtension && session.state === 'stopped' ? (
            <Button size='mini' disabled={!isConversationControlSupported || isTransferring || !!error} onClick={() => void onInspectExisting()}>
              {t('conversation.browserSession.personalConnect')}
            </Button>
          ) : null}
          {session?.personalExtension ? (
            <Button size='mini' disabled={isTransferring || !!error || (!isController && session.state !== 'stopped')} onClick={onDisconnectExisting}>
              {t('conversation.browserSession.personalDisconnect')}
            </Button>
          ) : null}
          {!session?.personalExtension && (session?.state === 'stopped' || (isController && session?.capabilities.lifecycle)) ? (
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
                options={[...(!session.capabilities.existingExtension ? [{ value: 'extension', label: t('conversation.browserSession.extension') }] : []), { value: 'cdp', label: t('conversation.browserSession.cdp') }]}
              />
              {session.state === 'stopped' ? (
                <Button size='mini' disabled={!isConversationControlSupported || isTransferring || !!error} onClick={() => void onStart()}>
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
        </Collapse.Item>
      </Collapse>
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
        <div aria-label={t('conversation.browserSession.downloads')} className='max-h-24 shrink-0 overflow-y-auto flex flex-wrap gap-2' data-testid='browser-downloads'>
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
        <div role='tablist' className='max-h-24 shrink-0 overflow-y-auto flex flex-wrap gap-1'>
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
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          aria-label={t('conversation.browserSession.imageZoom')}
          value={imageZoom ?? 'fit'}
          disabled={!isFrameReady}
          onChange={onImageZoom}
          style={{ width: 110 }}
          options={[{ value: 'fit', label: t('conversation.browserSession.fitImage') }, ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({ value, label: `${value * 100}%` }))]}
        />
        <Button size='small' aria-pressed={isPanning} type={isPanning ? 'primary' : 'secondary'} disabled={!isFrameReady} onClick={() => setIsPanning(true)}>
          {t('conversation.browserSession.panImage')}
        </Button>
        <Button
          size='small'
          aria-pressed={!isPanning}
          type={!isPanning ? 'primary' : 'secondary'}
          disabled={!isController || !isFrameReady}
          onClick={() => {
            panRef.current = null;
            setIsPanning(false);
            (imageRef.current ?? viewportRef.current?.querySelector('canvas'))?.focus({ preventScroll: true });
          }}
        >
          {t('conversation.browserSession.interactPage')}
        </Button>
        {isTouchInputAvailable && isDragSupported ? (
          <Button
            aria-label={t('conversation.browserSession.touchGesture')}
            aria-pressed={isTouchDragging}
            type={isTouchDragging ? 'primary' : 'secondary'}
            disabled={!isController || !isFrameReady || isPanning}
            onClick={() => onTouchGestureChange(isTouchDragging ? 'scroll' : 'drag')}
            style={{ minHeight: 44 }}
          >
            {t(`conversation.browserSession.${isTouchDragging ? 'touchDrag' : 'touchScroll'}`)}
          </Button>
        ) : null}
      </div>
      {isController && (session?.capabilities.selectionRead || session?.capabilities.clipboardText) ? (
        <div className='flex flex-wrap gap-2'>
          {session.capabilities.selectionRead ? (
            <Button size='small' disabled={!isFrameReady || isClipboardBusy} onClick={() => void onCopySelection()}>
              {t('conversation.browserSession.copySelection')}
            </Button>
          ) : null}
          {session.capabilities.clipboardText ? (
            <Button size='small' disabled={!isFrameReady || isClipboardBusy} onClick={() => void onPasteClipboard()}>
              {t('conversation.browserSession.pasteClipboard')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={viewportRef}
        aria-label={t('conversation.browserSession.imageViewport')}
        tabIndex={isPanning ? 0 : -1}
        className='relative flex-1 min-h-32 overflow-auto outline-none'
        style={{ touchAction: isPanning ? 'none' : undefined, cursor: isPanning ? 'grab' : undefined }}
        onPointerDown={onPanStart}
        onPointerDownCapture={() => void onBrowserInterrupt()}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={onPanEnd}
        onKeyDownCapture={(event) => {
          if (!(event.ctrlKey || event.metaKey) || event.altKey || event.nativeEvent.isComposing || !isInteractiveRef.current) return;
          if (event.key.toLowerCase() === 'c' && session?.capabilities.selectionRead) {
            event.preventDefault();
            event.stopPropagation();
            void onCopySelection();
          } else if (event.key.toLowerCase() === 'v' && session?.capabilities.clipboardText) {
            event.preventDefault();
            event.stopPropagation();
            void onPasteClipboard();
          }
        }}
      >
        <div className={imageZoom === null ? 'h-full w-full flex items-start justify-center' : 'min-h-full min-w-full w-max flex items-start justify-center'}>
          {windowStream ? (
            <WindowStreamSurface
              stream={windowStream}
              isInteractive={!!isController && !isPanning}
              isDragSupported={isDragSupported}
              isLiveDragSupported={session?.capabilities.liveDragInput === true}
              isTouchDragging={isTouchDragging}
              zoom={imageZoom}
              label={t('conversation.browserSession.page')}
              onInput={onStreamInput}
              onReady={onStreamReady}
              onDisconnect={onStreamDisconnect}
            />
          ) : (
            <img
              ref={imageRef}
              alt={t('conversation.browserSession.page')}
              draggable={false}
              tabIndex={isController && !isPanning ? 0 : -1}
              onLoad={onImageLoad}
              className={imageZoom === null ? 'max-w-full max-h-full object-contain outline-none' : 'max-w-none max-h-none shrink-0 outline-none'}
              style={{
                width: imageZoom !== null && imageSize.width ? imageSize.width * imageZoom : undefined,
                height: imageZoom !== null && imageSize.height ? imageSize.height * imageZoom : undefined,
                pointerEvents: isController && !isPanning ? 'auto' : 'none',
                touchAction: 'none',
                WebkitTouchCallout: isTouchDragging ? 'none' : undefined,
                visibility: isFrameReady ? 'visible' : 'hidden',
              }}
            />
          )}
        </div>
        {!isFrameReady ? <div className='absolute inset-0 flex items-center justify-center'>{error ? <Empty description={error} /> : occupancy ? <Empty description={t('conversation.browserSession.occupiedEmpty')} /> : session?.state === 'stopped' ? <Empty description={t('conversation.browserSession.waiting')} /> : <Spin />}</div> : null}
      </div>
      {isController ? (
        <>
          <div className='flex gap-1'>
            {session?.capabilities.clipboardText ? (
              <Input.TextArea
                aria-label={t('conversation.browserSession.text')}
                value={text}
                maxLength={8192}
                autoSize={{ minRows: 2, maxRows: 5 }}
                onChange={setText}
                onCompositionStart={() => setIsTextComposing(true)}
                onCompositionEnd={() => setIsTextComposing(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !isTextComposing && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                    event.preventDefault();
                    void onInsertText();
                  }
                }}
              />
            ) : (
              <Input
                aria-label={t('conversation.browserSession.text')}
                value={text}
                maxLength={512}
                onChange={setText}
                onCompositionStart={() => setIsTextComposing(true)}
                onCompositionEnd={() => setIsTextComposing(false)}
                onPressEnter={(event) => {
                  if (!isTextComposing && !event?.nativeEvent.isComposing && event?.nativeEvent.keyCode !== 229) void onInsertText();
                }}
              />
            )}
            <Button size='mini' disabled={!text || isTextComposing || !isFrameReady || isClipboardBusy} onClick={() => void onInsertText()}>
              {t('conversation.browserSession.insert')}
            </Button>
          </div>
        </>
      ) : null}
      {session?.state === 'human' && error ? <div role='alert'>{t('conversation.browserSession.disconnected')}</div> : null}
    </div>
  );
}

interface IBrowserInputContext {
  session: BrowserSessionState;
  generation: number;
  surface: 'page' | 'window';
}

interface IBrowserSessionPanelProps {
  conversationId: string;
  isActive?: boolean;
  isViewer?: boolean;
  isControlsOnly?: boolean;
  initialTransport?: 'extension' | 'cdp';
}

export { openBrowserSessionWindow } from './openBrowserSessionWindow';
