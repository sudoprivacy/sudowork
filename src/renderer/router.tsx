import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLoader from './components/AppLoader';
import { useAuth } from './context/AuthContext';
import { useAppMode, isModeResolved } from './hooks/useAppMode';
import { useCronEnabled } from './hooks/useCronEnabled';

const Conversation = React.lazy(() => import('./pages/conversation'));
const Guid = React.lazy(() => import('./pages/guid'));
const MossSessionPage = React.lazy(() => import('./pages/moss-session/MossSessionPage'));
const About = React.lazy(() => import('./pages/settings/About'));
const AgentSettings = React.lazy(() => import('./pages/settings/AgentSettings'));
const DisplaySettings = React.lazy(() => import('./pages/settings/DisplaySettings'));
const GeminiSettings = React.lazy(() => import('./pages/settings/GeminiSettings'));
const SudocodeModelSettings = React.lazy(() => import('./pages/settings/SudocodeModelSettings'));
const SkillSettings = React.lazy(() => import('./pages/settings/SkillSettings'));
const CopilotSettings = React.lazy(() => import('./pages/settings/CopilotSettings'));
const RuntimeSettings = React.lazy(() => import('./pages/settings/RuntimeSettings'));
const SystemSettings = React.lazy(() => import('./pages/settings/SystemSettings'));
const ToolsSettings = React.lazy(() => import('./pages/settings/ToolsSettings'));
const WebuiSettings = React.lazy(() => import('./pages/settings/WebuiSettings'));
const SecuritySettings = React.lazy(() => import('./pages/settings/SecuritySettings'));
const CronSettings = React.lazy(() => import('./pages/settings/CronSettings'));
const ExtensionSettingsPage = React.lazy(() => import('./pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('./pages/login'));
const RegisterPage = React.lazy(() => import('./pages/register'));
const UserProfile = React.lazy(() => import('./pages/settings/UserProfile'));
const RechargeCenter = React.lazy(() => import('./pages/settings/RechargeCenter'));
const MemberManagement = React.lazy(() => import('./pages/settings/MemberManagement'));
const EnterpriseSettings = React.lazy(() => import('./pages/settings/EnterpriseSettings'));
const EnterpriseMcpSettings = React.lazy(() => import('./pages/settings/EnterpriseMcpSettings'));
const ComponentsShowcase = React.lazy(() => import('./pages/test/ComponentsShowcase'));

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
  if (!cronEnabled && location.pathname === '/settings/cron') {
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
          <Route path='/guid' element={withRouteFallback(Guid)} />
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          <Route path='/moss-session/:sessionId' element={withRouteFallback(MossSessionPage)} />
          <Route path='/settings/gemini' element={withRouteFallback(GeminiSettings)} />
          <Route path='/settings/model' element={withRouteFallback(SudocodeModelSettings)} />
          <Route path='/settings/agent' element={withRouteFallback(AgentSettings)} />
          <Route path='/settings/display' element={withRouteFallback(DisplaySettings)} />
          <Route path='/settings/webui' element={withRouteFallback(WebuiSettings)} />
          <Route path='/settings/copilot' element={withRouteFallback(CopilotSettings)} />
          <Route path='/settings/runtime' element={withRouteFallback(RuntimeSettings)} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={withRouteFallback(About)} />
          <Route path='/settings/tools' element={withRouteFallback(ToolsSettings)} />
          <Route path='/settings/skill' element={withRouteFallback(SkillSettings)} />
          <Route path='/settings/security' element={withRouteFallback(SecuritySettings)} />
          <Route path='/settings/cron' element={withRouteFallback(CronSettings)} />
          <Route path='/settings/profile' element={withRouteFallback(UserProfile)} />
          <Route path='/settings/recharge' element={withRouteFallback(RechargeCenter)} />
          <Route path='/settings/members' element={withRouteFallback(MemberManagement)} />
          <Route path='/settings/enterprise' element={withRouteFallback(EnterpriseSettings)} />
          <Route path='/settings/mcp' element={withRouteFallback(EnterpriseMcpSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings' element={<SettingsDefaultRoute />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
        </Route>
        <Route path='*' element={<Navigate to={isSignedIn ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
