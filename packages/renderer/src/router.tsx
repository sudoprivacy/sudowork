/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLoader from './components/AppLoader';
import { useAuth } from './context/AuthContext';
import { useAppMode, isModeResolved } from './hooks/useAppMode';
import { useCronAccess } from './hooks/useCronAccess';
import { isDesktopOnlyRoute, isElectronDesktop } from './utils/platform';
import { useParkQuery } from './hooks/usePark';
import { resolveParkRoute, type ParkRole } from './park/parkRouteGuard';
import UpdateModal from './layouts/components/UpdateModal';

const Conversation = React.lazy(() => import('./pages/conversation'));
const Guid = React.lazy(() => import('./pages/guid'));
const MossSessionPage = React.lazy(() => import('./pages/moss-session/MossSessionPage'));
const About = React.lazy(() => import('./pages/settings/about'));
const AgentSettings = React.lazy(() => import('./pages/agents'));
const MyAgents = React.lazy(() => import('./pages/my-agents'));
const DisplaySettings = React.lazy(() => import('./pages/settings/display'));
const GeminiSettings = React.lazy(() => import('./pages/settings/gemini'));
const SudocodeModelSettings = React.lazy(() => import('./pages/settings/models'));
const Skills = React.lazy(() => import('./pages/skills'));
const LocalKnowledgeBase = React.lazy(() => import('./pages/local-knowledge-base'));
const OntologyPage = React.lazy(() => import('./pages/ontology'));
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
const UserProfile = React.lazy(() => import('./pages/settings/profile'));
const RechargeCenter = React.lazy(() => import('./pages/settings/recharge'));
const MemberManagement = React.lazy(() => import('./pages/settings/members'));
const EnterpriseSettings = React.lazy(() => import('./pages/settings/enterprise'));
const EnterpriseMcpSettings = React.lazy(() => import('./pages/settings/enterprise_mcps'));

// Park domain pages (园区 AI 招商 P0) — WebUI only (hidden on desktop), role-gated by server-derived park context.
const EnterpriseHomePage = React.lazy(() => import('./pages/enterprise/home'));
const EnterpriseAssistantPage = React.lazy(() => import('./pages/enterprise/assistant'));
const EnterprisePoliciesPage = React.lazy(() => import('./pages/enterprise/policies'));
const EnterpriseServicesPage = React.lazy(() => import('./pages/enterprise/services'));
const EnterpriseInquiriesPage = React.lazy(() => import('./pages/enterprise/inquiries'));
const ParkOverviewPage = React.lazy(() => import('./pages/park/overview'));
const ParkLeadsPage = React.lazy(() => import('./pages/park/leads'));
const ParkLeadDetailPage = React.lazy(() => import('./pages/park/leads/detail'));
const ParkConsultationsPage = React.lazy(() => import('./pages/park/consultations'));
const ParkEnterprisesPage = React.lazy(() => import('./pages/park/enterprises'));
const ParkEnterpriseDetailPage = React.lazy(() => import('./pages/park/enterprises/detail'));
const ParkAdminPage = React.lazy(() => import('./pages/park/admin'));
const ParkAdminOrganizationsPage = React.lazy(() => import('./pages/park/admin/organizations'));
const ParkAdminUsersPage = React.lazy(() => import('./pages/park/admin/users'));
const ParkAdminAssistantPage = React.lazy(() => import('./pages/park/admin/assistant'));
const ParkAdminPoliciesPage = React.lazy(() => import('./pages/park/admin/policies'));
const ParkAdminAuditPage = React.lazy(() => import('./pages/park/admin/audit'));

// Accepts lazy AND plain components (park guards return plain FCs wrapping lazy pages).
const withRouteFallback = (Component: React.ComponentType) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

// Enterprise-allowed settings paths
// Enterprise mode narrows the settings area to these paths. Kept in step with
// ENTERPRISE_BUILTIN_TAB_IDS in SettingsSider: the menu decides what is
// offered and this decides what is reachable, so a path missing from either
// one is unreachable — `/settings/recharge` was missing from both, which is
// why a control plane could serve credits that no one could open.
const ENTERPRISE_ALLOWED_PATHS = ['/settings/profile', '/settings/enterprise', '/settings/recharge', '/settings/mcp', '/settings/display', '/settings/channels', '/settings/system', '/settings/about'];

// Mode-aware default settings route
const SettingsDefaultRoute: React.FC = () => {
  const { isEnterprise } = useAppMode();
  const { isGuest } = useAuth();
  return <Navigate to={isGuest ? '/settings/model' : isEnterprise ? '/settings/enterprise' : '/settings/profile'} replace />;
};

/** Park 域路由守卫（园区 AI 招商 P0）：
 *  桌面端隐藏（isElectronDesktop()，utils/platform.ts 导出；AuthContext 内另有
 *  未导出的同义标识符 isDesktopRuntime）；WebUI 下按服务端推导的 org 类型放行，
 *  其余重定向首页。前端守卫只裁剪导航，权威鉴权在 moss park 域（ParkAuthorization）。 */
export function withParkGuard(expected: 'park' | 'enterprise', Page: React.ComponentType, allowedRoles?: ParkRole[]) {
  function ParkGuardedPage() {
    const { data, loading } = useParkQuery<{ org_type: 'park' | 'enterprise' | null; park_role: ParkRole | null }>('getContext');
    const decision = resolveParkRoute(expected, data, { loading, isDesktop: isElectronDesktop(), allowedRoles });
    if (decision === 'redirect') return <Navigate to='/guid' replace />;
    if (decision === 'wait') return null;
    return <Page />;
  }
  return ParkGuardedPage;
}

const PROTECTED_ROUTE_CONFIGS = [
  // ---- Park domain routes（园区 AI 招商 P0）----
  // 守卫：桌面端隐藏（isDesktopRuntime）；服务端推导的 org 类型/角色决定导航
  // （guard 组件仅做前端导航裁剪，权威鉴权在 moss park 域）。
  { path: '/enterprise/home', component: withParkGuard('enterprise', EnterpriseHomePage) },
  { path: '/enterprise/assistant', component: withParkGuard('enterprise', EnterpriseAssistantPage) },
  { path: '/enterprise/policies', component: withParkGuard('enterprise', EnterprisePoliciesPage) },
  { path: '/enterprise/services', component: withParkGuard('enterprise', EnterpriseServicesPage) },
  { path: '/enterprise/inquiries', component: withParkGuard('enterprise', EnterpriseInquiriesPage) },
  { path: '/park/overview', component: withParkGuard('park', ParkOverviewPage, ['park_leader']) },
  { path: '/park/leads', component: withParkGuard('park', ParkLeadsPage, ['park_leader', 'park_ops']) },
  { path: '/park/leads/:leadId', component: withParkGuard('park', ParkLeadDetailPage, ['park_leader', 'park_ops']) },
  { path: '/park/consultations', component: withParkGuard('park', ParkConsultationsPage) },
  { path: '/park/enterprises', component: withParkGuard('park', ParkEnterprisesPage) },
  { path: '/park/enterprises/:enterpriseOrgId', component: withParkGuard('park', ParkEnterpriseDetailPage) },
  // 系统运营五个独立管理页（计划 3.5）；/park/admin 仅为收藏链接兼容的重定向入口。
  { path: '/park/admin', component: withParkGuard('park', ParkAdminPage, ['park_system_operator']) },
  { path: '/park/admin/organizations', component: withParkGuard('park', ParkAdminOrganizationsPage, ['park_system_operator']) },
  { path: '/park/admin/users', component: withParkGuard('park', ParkAdminUsersPage, ['park_system_operator']) },
  { path: '/park/admin/assistant', component: withParkGuard('park', ParkAdminAssistantPage, ['park_system_operator']) },
  { path: '/park/admin/policies', component: withParkGuard('park', ParkAdminPoliciesPage, ['park_system_operator']) },
  { path: '/park/admin/audit', component: withParkGuard('park', ParkAdminAuditPage, ['park_system_operator']) },
  { path: '/guid', component: Guid },
  { path: '/conversation/:id', component: Conversation },
  { path: '/moss-session/:sessionId', component: MossSessionPage },
  { path: '/settings/gemini', component: GeminiSettings },
  { path: '/settings/model', component: SudocodeModelSettings },
  { path: '/app/agent', component: AgentSettings },
  { path: '/app/agents/mine', component: MyAgents },
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
  { path: '/app/ontology', component: OntologyPage },
  { path: '/app/ontology/:ontologyId/:view?', component: OntologyPage },
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

export const REGISTERED_ROUTE_PATHS = ['/login', '/', ...PROTECTED_ROUTE_CONFIGS.map((route) => route.path), '/settings'] as const;

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();
  const { isEnterprise, mode } = useAppMode();
  const { isCronVisible } = useCronAccess();
  const location = useLocation();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated' && status !== 'guest') {
    return <Navigate to='/login' replace />;
  }

  if (!isElectronDesktop() && isDesktopOnlyRoute(location.pathname)) {
    return <Navigate to='/guid' replace />;
  }

  // 游客态隐藏「用户中心」「充值中心」（需求 4）：直达这两个 URL 重定向到 /settings/model
  if (status === 'guest' && (location.pathname === '/settings/profile' || location.pathname === '/settings/recharge')) {
    return <Navigate to='/settings/model' replace />;
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
  const canEnterApp = status === 'authenticated' || status === 'guest';

  return (
    <HashRouter>
      {isElectronDesktop() && <UpdateModal />}
      <Routes>
        <Route path='/login' element={canEnterApp ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)} />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          {PROTECTED_ROUTE_CONFIGS.map(({ path, component }) => (
            <Route key={path} path={path} element={withRouteFallback(component)} />
          ))}
          <Route path='/settings' element={<SettingsDefaultRoute />} />
        </Route>
        <Route path='*' element={<Navigate to={canEnterApp ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
