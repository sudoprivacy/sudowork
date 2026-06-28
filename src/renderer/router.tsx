import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLoader from './components/AppLoader';
import { useAuth } from './context/AuthContext';
import { useAppMode, isModeResolved } from './hooks/useAppMode';
import { useCronEnabled } from './hooks/useCronEnabled';

const Conversation = React.lazy(() => import('./pages/conversation'));
const Guid = React.lazy(() => import('./pages/guid'));
const MossSessionPage = React.lazy(() => import('./pages/moss-session/MossSessionPage'));
const About = React.lazy(() => import('./pages/settings/about'));
const AgentSettings = React.lazy(() => import('./pages/settings/AgentSettings'));
const DisplaySettings = React.lazy(() => import('./pages/settings/display'));
const GeminiSettings = React.lazy(() => import('./pages/settings/GeminiSettings'));
const SudocodeModelSettings = React.lazy(() => import('./pages/settings/models'));
const SkillSettings = React.lazy(() => import('./pages/settings/SkillSettings'));
const CopilotSettings = React.lazy(() => import('./pages/settings/copilot'));
const RuntimeSettings = React.lazy(() => import('./pages/settings/runtime'));
const SystemSettings = React.lazy(() => import('./pages/settings/system'));
const ToolsSettings = React.lazy(() => import('./pages/settings/tools'));
const WebuiSettings = React.lazy(() => import('./pages/settings/WebuiSettings'));
const SecurityPage = React.lazy(() => import('./pages/security'));
const CronPage = React.lazy(() => import('./pages/cron'));
const CronJobDetailPage = React.lazy(() => import('./pages/cron/detail'));
const ExtensionSettingsPage = React.lazy(() => import('./pages/settings/ExtensionSettingsPage'));
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
const ENTERPRISE_ALLOWED_PATHS = ['/settings/profile', '/settings/enterprise', '/settings/mcp', '/settings/display', '/settings/webui', '/settings/system', '/settings/about'];

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
  { path: '/settings/agent', component: AgentSettings },
  { path: '/settings/display', component: DisplaySettings },
  { path: '/settings/webui', component: WebuiSettings },
  { path: '/settings/copilot', component: CopilotSettings },
  { path: '/settings/runtime', component: RuntimeSettings },
  { path: '/settings/system', component: SystemSettings },
  { path: '/settings/about', component: About },
  { path: '/settings/tools', component: ToolsSettings },
  { path: '/settings/skill', component: SkillSettings },
  { path: '/app/security', component: SecurityPage },
  { path: '/settings/security', component: SecurityPage },
  { path: '/app/cron', component: CronPage },
  { path: '/app/cron/:jobId', component: CronJobDetailPage },
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
  const { isEnterprise } = useAppMode();
  const cronEnabled = useCronEnabled();
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

  // Client cron disabled: the cron settings page is not reachable.
  if (!cronEnabled && location.pathname.startsWith('/app/cron')) {
    return <Navigate to='/settings/agent' replace />;
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
