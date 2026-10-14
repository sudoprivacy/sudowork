declare module '@ai-dev-browser/remote-page' {
  export class PageSurface {
    constructor(image: HTMLImageElement, send: (input: unknown) => void);
    frame(value: { data: string; width: number; height: number }): void;
    clear(): void;
    dispose(): void;
  }
}
