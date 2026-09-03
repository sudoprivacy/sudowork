import path from 'path';
import { defineConfig } from 'vitest/config';

// Modules that stay in apps/desktop/src/common (main-only or transitively so);
// everything else under @common / @/common now lives in @sudowork/common.
const DESKTOP_ONLY_COMMON = [
  'ClientFactory',
  'adapters/index',
  'chatLib',
  'eeclawMode',
  'enterpriseDebugConfig',
  'i18n',
  'imageGenerationModelConfig',
  'imagePricingSource',
  'index',
  'ipcBridge',
  'navigation/NavigationInterceptor',
  'navigation/index',
  'nexus/generated/nexus/secrets/v1/secrets_pb',
  'nexus/index',
  'nexus/moss-secret-client-factory',
  'nexus/nexus-secret-client',
  'nexus/nexus-secret-resilient',
  'nexus/nexus-vfs-client',
  'nexus/nexusVfsGrpcClient',
  'nexus/secret-cache',
  'nexus/secret-migration',
  'presets/assistantPresets',
  'presets/presetResolver',
  'scodeConfig',
  'storage',
  'sudoclawModelConfig',
  'sudoworkAuthLogin',
  'sudoworkServer',
  'systemConfig',
  'thirdPartyAuthConfig',
  'utils/workspaceSkillSync',
];
const DESKTOP_ONLY_COMMON_DIRS = ['nexus', 'navigation', 'adapters'];

function commonAliasEntries() {
  const pkg = path.resolve(__dirname, '../../packages/common/src').replace(/\\/g, '/');
  const deskCommon = path.resolve(__dirname, './src/common').replace(/\\/g, '/');
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entries: { find: RegExp; replacement: string }[] = [];
  entries.push({ find: /^@\/?common$/, replacement: deskCommon });
  for (const m of [...DESKTOP_ONLY_COMMON, ...DESKTOP_ONLY_COMMON_DIRS]) {
    entries.push({ find: new RegExp('^@\\/?common\\/' + esc(m) + '(?:\\.js)?$'), replacement: `${deskCommon}/${m}` });
  }
  entries.push({ find: /^@\/?common\/(.*)$/, replacement: `${pkg}/$1` });
  entries.push({ find: /^@sudowork\/common\/(.*)$/, replacement: `${pkg}/$1` });
  return entries;
}

const aliases = [
  ...commonAliasEntries(),
  { find: /^@process\//, replacement: path.resolve(__dirname, './src/process') + '/' },
  { find: /^@renderer\//, replacement: path.resolve(__dirname, './src/renderer') + '/' },
  { find: /^@worker\//, replacement: path.resolve(__dirname, './src/worker') + '/' },
  { find: /^@mcp\/models\//, replacement: path.resolve(__dirname, './src/common/models') + '/' },
  { find: /^@mcp\/types\//, replacement: path.resolve(__dirname, './src/common') + '/' },
  { find: /^@mcp\//, replacement: path.resolve(__dirname, './src/common') + '/' },
  // Resolve shared workspace packages to source so tests never depend on a
  // prior `dist` build (uniform local/CI; exercises the actual source).
  { find: '@sudowork/moss-client', replacement: path.resolve(__dirname, '../../packages/moss-client/src/index.ts') },
  { find: '@sudowork/contracts/auth', replacement: path.resolve(__dirname, '../../packages/contracts/src/auth.ts') },
  { find: '@sudowork/contracts/conversations', replacement: path.resolve(__dirname, '../../packages/contracts/src/conversations.ts') },
  { find: /^@\//, replacement: path.resolve(__dirname, './src') + '/' },
];

export default defineConfig({
  resolve: {
    alias: aliases,
  },
  test: {
    globals: true,
    testTimeout: 10000,
    server: {
      deps: {
        // zod 3.25+ uses ESM-only exports; force Vite to inline/transform it in SSR mode
        inline: ['zod'],
      },
    },
    // Use projects to run different environments (Vitest 4+)
    projects: [
      // Node environment tests (existing tests)
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/test_*.ts', 'tests/integration/**/*.test.ts'],
          exclude: ['tests/unit/**/*.dom.test.ts', 'tests/unit/**/*.dom.test.tsx'],
          setupFiles: ['./tests/vitest.setup.ts'],
        },
      },
      // jsdom environment tests (React component/hook tests)
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/unit/**/*.dom.test.ts', 'tests/unit/**/*.dom.test.tsx'],
          setupFiles: ['./tests/vitest.dom.setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: './coverage',
      // 手动指定需要覆盖的源文件，确保只检测新增/修改的逻辑
      // 新增功能时，将对应的源文件路径添加到此数组
      // 例如: 'src/process/services/newService.ts'
      include: [
        // Process / bridge
        'src/process/database/corruptionError.ts',
        'src/process/database/workspaceQueries.ts',
        'src/process/startupNotice.ts',
        'src/process/utils/proxyAgent.ts',
        'src/process/services/autoUpdaterService.ts',
        'src/process/services/conversationReaper.ts',
        'src/process/services/orphanWorkspaceSweeper.ts',
        'src/process/services/conversionService.ts',
        'src/process/services/scode/scodeProxyModels.ts',
        'src/process/services/sudoclaw/sudoclawRuntimeSync.ts',
        'src/process/services/pwdLogin/errors.ts',
        'src/process/services/pwdLogin/memorySafety.ts',
        'src/process/services/pwdLogin/pwdAdapters.ts',
        'src/process/services/pwdLogin/pwdLoginService.ts',
        'src/process/services/fuset/FuseTSupervisor.ts',
        'src/process/services/knowledge/KnowledgeRetrievalService.ts',
        'src/process/services/local-kb/documentParser.ts',
        'src/process/services/local-kb/query.ts',
        'src/process/services/local-kb/vectorIndex.ts',
        'src/process/services/local-kb/buildExecutor.ts',
        'src/process/services/local-kb/embeddingModelService.ts',
        'src/process/services/local-kb/LocalKnowledgeBaseSkillServer.ts',
        'src/process/services/local-kb/LocalKnowledgeBaseService.ts',
        'src/process/services/poppler/PopplerRuntimeService.ts',
        'src/process/services/ffmpeg/FfmpegRuntimeService.ts',
        'src/process/services/ffmpeg/ffmpegSkillGate.ts',
        'src/process/services/nexus-vfs/FusePluginClient.ts',
        'src/process/telemetry/SudoLogTelemetryReporter.ts',
        'src/process/bridge/updateBridge.ts',
        'src/process/bridge/applicationBridge.ts',
        'src/process/bridge/acpModelSwitch.ts',
        'src/process/bridge/documentBridge.ts',
        'src/process/bridge/pwdLoginBridge.ts',
        'src/process/utils/enabledSkillFilter.ts',
        // Team collaboration
        'src/process/bridge/teamBridge.ts',
        'src/process/services/team/TeamService.ts',
        'src/process/services/team/TeamStore.ts',
        'src/process/services/team/WakeSource.ts',
        'src/process/services/team/SlotWakeGate.ts',
        'src/process/services/team/TeamRun.ts',
        'src/process/services/team/RecoveryDrain.ts',
        'src/process/services/team/CrashRecovery.ts',
        'src/process/services/team/TeamStartupCleaner.ts',
        'src/process/services/team/TaskBoard.ts',
        'src/process/services/team/assistantMerger.ts',
        'src/process/services/team/EventLoop.ts',
        'src/process/services/team/MessageProjection.ts',
        'src/process/services/team/GovernancePrompt.ts',
        'src/renderer/pages/team/hooks/useTeamWarmup.ts',
        'src/renderer/pages/team/components/TeamWarmupOverlay.tsx',
        'src/renderer/pages/settings/recharge/components/CreditApplicationPanel.tsx',
        'src/utils/configureChromium.ts',
        // ACP
        'src/agent/acp/AcpAdapter.ts',
        'src/agent/acp/AcpConnection.ts',
        'src/agent/acp/modelInfo.ts',
        'src/agent/acp/ndjson.ts',
        'src/agent/acp/transport.ts',
        'src/process/task/acpWorkspaceTracking.ts',
        'src/process/task/CronCommandDetector.ts',
        'src/process/task/turnInputCoordinator.ts',
        // Common
        'src/common/chatLib.ts',
        'src/common/nexus/hubErrors.ts',
        'src/common/nexus/nexusVfsGrpcClient.ts',
        'src/common/runtime-errors.ts',
        'src/common/nexusFiles.ts',
        'src/common/scodeConfig.ts',
        'src/common/slash/sudoworkCommands.ts',
        'src/common/sudoworkAuthLogin.ts',
        'src/common/thirdPartyAuthConfig.ts',
        'src/common/tokenUsage.ts',
        'src/common/update/models/VersionInfo.ts',
        'src/common/types/conversion.ts',
        // Renderer utils
        'src/renderer/components/HubEmptyState.tsx',
        'src/renderer/hooks/useAvailableModels.ts',
        'src/renderer/hooks/useHasAvailableModel.ts',
        'src/renderer/components/sendboxKeyGuards.ts',
        'src/renderer/messages/RuntimeErrorBanner.tsx',
        'src/renderer/messages/useAutoScroll.ts',
        'src/renderer/utils/emitter.ts',
        'src/renderer/pages/guid/utils/modelBackendKey.ts',
        // Preview components
        'src/renderer/pages/conversation/preview/components/viewers/WordViewer.tsx',
        'src/renderer/pages/conversation/preview/components/viewers/PPTViewer.tsx',
        // Extension system (only files with existing tests)
        'src/extensions/ExtensionLoader.ts',
        'src/extensions/{dependencyResolver,pathSafety,statePersistence,entryPointResolver,envResolver,fileResolver}.ts',
      ],
      thresholds: {
        statements: 30,
        branches: 10,
        functions: 35,
        lines: 30,
      },
    },
  },
});
