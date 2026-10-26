/** Open either view of the same authenticated conversation/browser binding. */
export function openBrowserSessionWindow(conversationId: string, isControlsOnly = false): void {
  const route = isControlsOnly ? 'browser-controls' : 'browser-viewer';
  window.open(`${location.pathname}${location.search}#/${route}/${encodeURIComponent(conversationId)}`, '_blank', isControlsOnly ? 'noopener,popup,width=460,height=250' : 'noopener');
}
