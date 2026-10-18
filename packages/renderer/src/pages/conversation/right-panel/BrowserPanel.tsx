import BrowserSessionPanel from '@renderer/components/browser/BrowserSessionPanel';
import { isElectronDesktop } from '@renderer/utils/platform';

/** The host adapts the connection; Desktop and WebUI share all browser controls. */
export default function BrowserPanel({ active = false, conversationId, isCloud = false }: IBrowserPanelProps) {
  return <BrowserSessionPanel conversationId={conversationId || ''} isActive={active} initialTransport={isCloud || !isElectronDesktop() ? 'extension' : 'cdp'} />;
}

interface IBrowserPanelProps {
  active?: boolean;
  conversationId?: string;
  isCloud?: boolean;
}
