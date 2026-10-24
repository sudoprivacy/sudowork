declare module '@novnc/novnc/lib/rfb.js' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options: { credentials: { password: string }; shared?: boolean });
    viewOnly: boolean;
    focusOnClick: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    getImageData(): ImageData;
    disconnect(): void;
  }
}
