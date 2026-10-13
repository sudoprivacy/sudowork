import { useParams } from 'react-router-dom';
import BrowserSessionPanel from '@renderer/components/browser/BrowserSessionPanel';

export default function BrowserViewerPage() {
  const { conversationId = '' } = useParams<{ conversationId: string }>();
  return <BrowserSessionPanel conversationId={conversationId} isViewer />;
}
