import { useLocation, useParams } from 'react-router-dom';
import BrowserSessionPanel from '@renderer/components/browser/BrowserSessionPanel';

export default function BrowserViewerPage() {
  const { conversationId = '' } = useParams<{ conversationId: string }>();
  const location = useLocation();
  return <BrowserSessionPanel conversationId={conversationId} isViewer isControlsOnly={location.pathname.startsWith('/browser-controls/')} />;
}
