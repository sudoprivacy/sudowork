import React, { useCallback, useState } from 'react';
import ReactDOM from 'react-dom';
import katexCss from 'katex/dist/katex.min.css?inline';
import layoutCss from '../styles/markdown-layout.css?inline';
import themeCss from '../styles/markdown.css?inline';
import codeCss from '../styles/code-view.css?inline';

const SURFACE_CSS = `${layoutCss}\n${themeCss}\n${codeCss}\n${katexCss}`;
let sharedStyleSheet: CSSStyleSheet | undefined;

/** Isolates document styles while inheriting the app's semantic custom properties. */
export default function MarkdownSurface({ children }: IMarkdownSurfaceProps) {
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const onHostRef = useCallback((host: HTMLDivElement | null) => {
    if (!host) return;
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    if (!shadow.childNodes.length) {
      if (typeof CSSStyleSheet !== 'undefined' && typeof CSSStyleSheet.prototype.replaceSync === 'function' && 'adoptedStyleSheets' in shadow) {
        sharedStyleSheet ??= new CSSStyleSheet();
        if (!sharedStyleSheet.cssRules.length) sharedStyleSheet.replaceSync(SURFACE_CSS);
        shadow.adoptedStyleSheets = [sharedStyleSheet];
      } else {
        const style = document.createElement('style');
        style.textContent = SURFACE_CSS;
        shadow.append(style);
      }
    }
    setRoot(shadow);
  }, []);

  return (
    <div ref={onHostRef} className='markdown-shadow w-full min-w-0'>
      {root && ReactDOM.createPortal(children, root)}
    </div>
  );
}

interface IMarkdownSurfaceProps {
  children: React.ReactNode;
}
