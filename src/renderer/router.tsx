import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLoader from './components/AppLoader';
import InitGateModal from './components/InitGateModal';
import { useAuth } from './context/AuthContext';
import { useInit } from './context/InitContext';

const Conversation = React.lazy(() => import('./pages/conversation'));
const Guid = React.lazy(() => import('./pages/guid'));
const About = React.lazy(() => import('./pages/settings/About'));
const AgentSettings = React.lazy(() => import('./pages/settings/AgentSettings'));
const DisplaySettings = React.lazy(() => import('./pages/settings/DisplaySettings'));
const GeminiSettings = React.lazy(() => import('./pages/settings/GeminiSettings'));
const ModeSettings = React.lazy(() => import('./pages/settings/ModeSettings'));
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
const MemberManagement = React.lazy(() => import('./pages/settings/MemberManagement'));
const ComponentsShowcase = React.lazy(() => import('./pages/test/ComponentsShowcase'));

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();
  const { isReady: initReady } = useInit();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return (
    <>
      {!initReady && <InitGateModal />}
      {React.cloneElement(layout)}
    </>
  );
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
          <Route path='/settings/gemini' element={withRouteFallback(GeminiSettings)} />
          <Route path='/settings/model' element={withRouteFallback(ModeSettings)} />
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
          <Route path='/settings/members' element={withRouteFallback(MemberManagement)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings' element={<Navigate to='/settings/agent' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
        </Route>
        <Route path='*' element={<Navigate to={isSignedIn ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
