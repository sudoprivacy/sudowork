declare module '@ai-dev-browser/remote-page' {
  export class InputSurface {
    constructor(element: HTMLElement, send: (input: unknown) => void | Promise<void>, options?: { drag?: boolean; touchDrag?: boolean; liveDrag?: boolean; viewerId?: string });
    resize(width: number, height: number): boolean;
    clear(): void;
    dispose(): void;
  }
  export class PageSurface extends InputSurface {
    frame(value: { data: string; width: number; height: number }): void;
  }
}
