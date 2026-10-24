import { useEffect, useRef, useState } from 'react';
import type RFB from '@novnc/novnc/lib/rfb.js';
import { InputSurface } from '@ai-dev-browser/remote-page';

/** Read-only pixels with the same checked gesture mapper as the JPEG viewer. */
export default function WindowStreamSurface({ stream, isInteractive, isDragSupported, isTouchDragging, zoom, label, onInput, onReady, onDisconnect }: IWindowStreamSurfaceProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<RFB | null>(null);
  const inputRef = useRef<InputSurface | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const callbacksRef = useRef({ onInput, onReady, onDisconnect });
  const optionsRef = useRef({ isInteractive, isDragSupported, isTouchDragging, zoom, label });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [isPainted, setIsPainted] = useState(false);
  callbacksRef.current = { onInput, onReady, onDisconnect };
  optionsRef.current = { isInteractive, isDragSupported, isTouchDragging, zoom, label };

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    let isClosed = false;
    let animation: number | undefined;
    let client: RFB | null = null;
    let inputCanvas: HTMLCanvasElement | null = null;
    // noVNC's legacy mousedown capture also runs in viewOnly mode. It can
    // cover the page with its mouse proxy after our PointerEvent capture.
    // The public InputSurface owns input; noVNC only decodes pixels here.
    const onLegacyMouseDown = (event: MouseEvent) => event.stopImmediatePropagation();
    const startedAt = performance.now();
    setIsPainted(false);
    setSize({ width: 0, height: 0 });
    const url = new URL(stream.socketPath, location.origin);
    if (url.origin !== location.origin || url.hash || !url.pathname.startsWith('/ws/browser/')) {
      callbacksRef.current.onDisconnect();
      return;
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const updateCanvas = () => {
      const canvas = target.querySelector('canvas');
      if (!canvas) return;
      canvasRef.current = canvas;
      if (canvas !== inputCanvas) {
        inputRef.current?.dispose();
        inputCanvas?.removeEventListener('mousedown', onLegacyMouseDown, true);
        inputCanvas = canvas;
        canvas.addEventListener('mousedown', onLegacyMouseDown, true);
        inputRef.current = new InputSurface(
          canvas,
          (value) => {
            if (!isClosed && optionsRef.current.isInteractive) callbacksRef.current.onInput(value);
          },
          { drag: optionsRef.current.isDragSupported, touchDrag: optionsRef.current.isTouchDragging }
        );
      }
      canvas.setAttribute('aria-label', optionsRef.current.label);
      canvas.tabIndex = optionsRef.current.isInteractive ? 0 : -1;
      canvas.style.pointerEvents = optionsRef.current.isInteractive ? 'auto' : 'none';
      canvas.style.touchAction = 'none';
      if (canvas.width && canvas.height) inputRef.current?.resize(canvas.width, canvas.height);
    };
    const observer = new MutationObserver(updateCanvas);
    observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'] });
    updateCanvas();

    // RFB connect confirms the handshake, before the first framebuffer arrives.
    // Inspect actual decoded pixels rather than accepting an empty canvas as ready.
    const paint = () => {
      if (isClosed || !client) return;
      updateCanvas();
      try {
        const image = client.getImageData();
        let isVaried = false;
        for (let index = 4; index < image.data.length; index += 64) {
          if (image.data[index] !== image.data[0] || image.data[index + 1] !== image.data[1] || image.data[index + 2] !== image.data[2]) {
            isVaried = true;
            break;
          }
        }
        if (isVaried && image.width && image.height) {
          setSize({ width: image.width, height: image.height });
          setIsPainted(true);
          callbacksRef.current.onReady({ width: image.width, height: image.height });
          return;
        }
      } catch {
        // The noVNC framebuffer has not been initialized yet.
      }
      if (performance.now() - startedAt > 30_000) {
        callbacksRef.current.onDisconnect();
        return;
      }
      animation = requestAnimationFrame(paint);
    };
    const onConnect = () => {
      animation = requestAnimationFrame(paint);
    };
    const onDisconnected = () => {
      if (!isClosed) callbacksRef.current.onDisconnect();
    };
    // Load the decoder only for an active streamed window. Ordinary Desktop
    // and page views keep their existing startup cost and module environment.
    void import('@novnc/novnc/lib/rfb.js')
      .then(({ default: Client }) => {
        if (isClosed) return;
        client = new Client(target, url.href, { credentials: { password: stream.password }, shared: true });
        clientRef.current = client;
        client.viewOnly = true;
        client.focusOnClick = false;
        client.resizeSession = false;
        client.scaleViewport = optionsRef.current.zoom === null;
        client.addEventListener('connect', onConnect);
        client.addEventListener('disconnect', onDisconnected);
        updateCanvas();
      })
      .catch(onDisconnected);
    return () => {
      isClosed = true;
      if (animation !== undefined) cancelAnimationFrame(animation);
      observer.disconnect();
      client?.removeEventListener('connect', onConnect);
      client?.removeEventListener('disconnect', onDisconnected);
      inputRef.current?.dispose();
      inputCanvas?.removeEventListener('mousedown', onLegacyMouseDown, true);
      inputRef.current = null;
      canvasRef.current = null;
      client?.disconnect();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    inputRef.current?.dispose();
    inputRef.current = new InputSurface(
      canvas,
      (value) => {
        if (optionsRef.current.isInteractive) callbacksRef.current.onInput(value);
      },
      { drag: isDragSupported, touchDrag: isTouchDragging }
    );
    inputRef.current.resize(canvas.width, canvas.height);
    canvas.tabIndex = isInteractive ? 0 : -1;
    canvas.style.pointerEvents = isInteractive ? 'auto' : 'none';
    if (isPainted) callbacksRef.current.onReady(size);
  }, [isInteractive, isDragSupported, isTouchDragging, isPainted, size]);

  useEffect(() => {
    if (clientRef.current) clientRef.current.scaleViewport = zoom === null;
  }, [zoom]);

  return (
    <div className='relative h-full w-full shrink-0' style={{ width: zoom !== null && size.width ? size.width * zoom : undefined, height: zoom !== null && size.height ? size.height * zoom : undefined, visibility: isPainted ? 'visible' : 'hidden' }}>
      <div ref={targetRef} style={{ position: 'absolute', inset: 0, width: zoom !== null && size.width ? size.width : '100%', height: zoom !== null && size.height ? size.height : '100%', transform: zoom !== null ? `scale(${zoom})` : undefined, transformOrigin: 'top left' }} />
    </div>
  );
}

export interface IWindowStreamContext {
  password: string;
  socketPath: string;
  browserSessionId: string;
  controlEpoch: number;
  targetEpoch: number;
}

interface IWindowStreamSurfaceProps {
  stream: IWindowStreamContext;
  isInteractive: boolean;
  isDragSupported: boolean;
  isTouchDragging: boolean;
  zoom: number | null;
  label: string;
  onInput: (value: unknown) => void;
  onReady: (size: { width: number; height: number }) => void;
  onDisconnect: () => void;
}
