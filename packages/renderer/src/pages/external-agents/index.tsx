import { Navigate, useSearchParams } from 'react-router-dom';
import { externalConversationPath } from './navigation';

export default function ExternalAgents() {
  const [search] = useSearchParams();
  const sessionId = search.get('session');
  return <Navigate replace to={sessionId ? externalConversationPath(sessionId) : '/app/agent'} />;
}
