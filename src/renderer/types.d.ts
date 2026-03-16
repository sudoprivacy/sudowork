declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

declare module '*.png' {
  const content: string;
  export default content;
}

declare module 'unocss';

declare module 'pptx-preview' {
  interface PreviewerOptions {
    width?: number;
    height?: number;
  }

  interface Previewer {
    preview(arrayBuffer: ArrayBuffer): Promise<void>;
    destroy?(): void;
  }

  export function init(container: HTMLElement, options?: PreviewerOptions): Previewer;
}
