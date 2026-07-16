import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLoader from './components/AppLoader';
import { useAuth } from './context/AuthContext';
import { useAppMode, isModeResolved } from './hooks/useAppMode';
import { useCronAccess } from './hooks/useCronAccess';

const Conversation = React.lazy(() => import('./pages/conversation'));
const Guid = React.lazy(() => import('./pages/guid'));
const MossSessionPage = React.lazy(() => import('./pages/moss-session/MossSessionPage'));
const About = React.lazy(() => import('./pages/settings/about'));
const AgentSettings = React.lazy(() => import('./pages/agents'));
const DisplaySettings = React.lazy(() => import('./pages/settings/display'));
const GeminiSettings = React.lazy(() => import('./pages/settings/gemini'));
const SudocodeModelSettings = React.lazy(() => import('./pages/settings/models'));
const Skills = React.lazy(() => import('./pages/skills'));
const LocalKnowledgeBase = React.lazy(() => import('./pages/local-knowledge-base'));
const CopilotSettings = React.lazy(() => import('./pages/settings/copilot'));
const RuntimeSettings = React.lazy(() => import('./pages/settings/runtime'));
const SystemSettings = React.lazy(() => import('./pages/settings/system'));
const ToolsSettings = React.lazy(() => import('./pages/settings/tools'));
const ChannelsPage = React.lazy(() => import('./pages/settings/channels'));
const SecurityPage = React.lazy(() => import('./pages/security'));
const CronPage = React.lazy(() => import('./pages/cron'));
const CronJobDetailPage = React.lazy(() => import('./pages/cron/detail'));
const TeamDetailPage = React.lazy(() => import('./pages/team/detail'));
const ExtensionSettingsPage = React.lazy(() => import('./pages/settings/extensions'));
const LoginPage = React.lazy(() => import('./pages/login'));
const RegisterPage = React.lazy(() => import('./pages/register'));
const UserProfile = React.lazy(() => import('./pages/settings/profile'));
const RechargeCenter = React.lazy(() => import('./pages/settings/recharge'));
const MemberManagement = React.lazy(() => import('./pages/settings/members'));
const EnterpriseSettings = React.lazy(() => import('./pages/settings/enterprise'));
const EnterpriseMcpSettings = React.lazy(() => import('./pages/settings/enterprise_mcps'));

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

// Enterprise-allowed settings paths
const ENTERPRISE_ALLOWED_PATHS = ['/settings/profile', '/settings/enterprise', '/settings/mcp', '/settings/display', '/settings/channels', '/settings/system', '/settings/about'];

// Mode-aware default settings route
const SettingsDefaultRoute: React.FC = () => {
  const { isEnterprise } = useAppMode();
  return <Navigate to={isEnterprise ? '/settings/enterprise' : '/settings/profile'} replace />;
};

const PROTECTED_ROUTE_CONFIGS = [
  { path: '/guid', component: Guid },
  { path: '/conversation/:id', component: Conversation },
  { path: '/moss-session/:sessionId', component: MossSessionPage },
  { path: '/settings/gemini', component: GeminiSettings },
  { path: '/settings/model', component: SudocodeModelSettings },
  { path: '/app/agent', component: AgentSettings },
  { path: '/settings/agent', component: AgentSettings },
  { path: '/settings/display', component: DisplaySettings },
  { path: '/settings/channels', component: ChannelsPage },
  { path: '/settings/copilot', component: CopilotSettings },
  { path: '/settings/runtime', component: RuntimeSettings },
  { path: '/settings/system', component: SystemSettings },
  { path: '/settings/about', component: About },
  { path: '/settings/tools', component: ToolsSettings },
  { path: '/app/skills', component: Skills },
  { path: '/app/local-kb', component: LocalKnowledgeBase },
  { path: '/settings/skill', component: Skills },
  { path: '/app/security', component: SecurityPage },
  { path: '/app/channels', component: ChannelsPage },
  { path: '/settings/security', component: SecurityPage },
  { path: '/app/cron', component: CronPage },
  { path: '/app/cron/:jobId', component: CronJobDetailPage },
  { path: '/app/team/:teamId', component: TeamDetailPage },
  { path: '/settings/profile', component: UserProfile },
  { path: '/settings/recharge', component: RechargeCenter },
  { path: '/settings/members', component: MemberManagement },
  { path: '/settings/enterprise', component: EnterpriseSettings },
  { path: '/settings/mcp', component: EnterpriseMcpSettings },
  { path: '/settings/ext/:tabId', component: ExtensionSettingsPage },
] as const;

export const REGISTERED_ROUTE_PATHS = ['/login', '/register', '/', ...PROTECTED_ROUTE_CONFIGS.map((route) => route.path), '/settings'] as const;

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();
  const { isEnterprise, mode } = useAppMode();
  const { isCronVisible } = useCronAccess();
  const location = useLocation();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  // Wait for useAppMode async initialization to prevent route guard bypass on page refresh
  if (!isModeResolved()) {
    return <AppLoader />;
  }

  // Enterprise mode route guard: restrict access to allowed settings paths
  if (isEnterprise && location.pathname.startsWith('/settings/') && !ENTERPRISE_ALLOWED_PATHS.includes(location.pathname)) {
    return <Navigate to='/settings/enterprise' replace />;
  }

  // Cron UI hidden (org disabled it and the user is neither an admin nor an
  // owner/co-owner of any job): the cron pages are not reachable.
  if (!isCronVisible && location.pathname.startsWith('/app/cron')) {
    return <Navigate to='/settings/agent' replace />;
  }

  // Team collaboration is consumer-only (附录 II.1).
  if (mode !== 'c' && location.pathname.startsWith('/app/team')) {
    return <Navigate to='/guid' replace />;
  }

  return React.cloneElement(layout);
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();
  const isSignedIn = status === 'authenticated';

  return (
    <HashRouter>
      <Routes>
        <Route path='/login' element={isSignedIn ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)} />
        <Route path='/register' element={isSignedIn ? <Navigate to='/guid' replace /> : withRouteFallback(RegisterPage)} />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          {PROTECTED_ROUTE_CONFIGS.map(({ path, component }) => (
            <Route key={path} path={path} element={withRouteFallback(component)} />
          ))}
          <Route path='/settings' element={<SettingsDefaultRoute />} />
        </Route>
        <Route path='*' element={<Navigate to={isSignedIn ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
