# 插件安装选择界面实现计划

## Context
用户希望在应用首次启动时显示一个插件选择列表界面，让用户选择要安装的插件。类似于 Windows 安装程序的体验：
- 检测哪些插件没有安装
- 显示列表，未安装的默认全选
- 用户点击安装后执行安装流程

**插件列表包含**：Claude CLI、Gemini CLI、Sudoclaw (OpenClaw)、Nexus、LibreOffice

## Exploration Results

### 现有 IPC 接口
每个插件都有独立的 IPC 接口（在 `src/common/ipcBridge.ts`）：
- `claudeCli`: checkInstalled, install, installProgress, installResult
- `geminiCli`: checkInstalled, install, installProgress, installResult
- `libreOffice`: checkInstalled, install, installProgress, installResult
- `nexus`: checkInstalled, install, installProgress
- `sudoclaw`: getStatus (已安装状态)

### 现有初始化流程
- `src/process/index.ts`: `installRuntimes()` 自动安装 Node.js、Sudoclaw、Claude CLI、Gemini CLI
- `src/renderer/main.tsx`: 使用 `useInit()` 检查初始化状态
- `src/renderer/components/InitLoading.tsx`: 显示初始化进度条

### UI 组件模式
- 使用 Arco Design 组件库（Modal, Form, Switch, Button, Checkbox）
- 设置页面使用 `SettingsModal/contents/` 下的组件

## Implementation Plan

### 1. 创建插件安装管理服务 (主进程)
**文件**: `src/process/services/PluginSetupService.ts`

```typescript
interface PluginInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  required: boolean; // Node.js 等核心组件不可取消
}

// IPC 接口:
// - pluginSetup.getAvailablePlugins: 获取所有插件及状态
// - pluginSetup.installPlugins: 批量安装选中的插件
// - pluginSetup.installProgress: 安装进度事件
// - pluginSetup.shouldShowSetup: 是否需要显示安装界面（首次运行或有未安装插件）
```

### 2. 添加 IPC Bridge 定义
**文件**: `src/common/ipcBridge.ts`

添加 `pluginSetup` 相关接口定义。

### 3. 创建插件选择界面组件 (渲染端)
**文件**: `src/renderer/components/PluginSetupModal.tsx`

功能：
- 显示插件列表，每个有复选框
- 未安装的默认选中
- 显示安装进度（每个插件单独进度条）
- 安装完成后自动关闭

### 4. 修改启动流程
**文件**: `src/renderer/main.tsx`

```typescript
const Main = () => {
  const { isReady: initReady } = useInit();
  const [showPluginSetup, setShowPluginSetup] = useState(false);

  // 初始化完成后检查是否需要显示插件选择
  useEffect(() => {
    if (initReady) {
      ipcBridge.pluginSetup.shouldShowSetup.invoke().then((need) => {
        if (need.data) setShowPluginSetup(true);
      });
    }
  }, [initReady]);

  if (!initReady) return <InitLoading />;
  if (showPluginSetup) return <PluginSetupModal onComplete={() => setShowPluginSetup(false)} />;
  return <Router ... />;
};
```

### 5. 修改主进程初始化逻辑
**文件**: `src/process/index.ts`

修改 `installRuntimes()`:
- Node.js 仍然自动安装（核心依赖）
- Sudoclaw、Claude CLI、Gemini CLI 不再自动安装
- 添加新的状态 `waitingForUserChoice` 表示等待用户选择

### 6. 添加首次运行标记
**文件**: `src/common/storage.ts` 或 ProcessConfig

添加 `pluginSetupCompleted` 标记，记录用户是否已完成首次插件选择。

## Critical Files

| File | Purpose |
|------|---------|
| `src/process/services/PluginSetupService.ts` | 新建 - 插件安装管理服务 |
| `src/common/ipcBridge.ts` | 修改 - 添加 pluginSetup 接口 |
| `src/renderer/components/PluginSetupModal.tsx` | 新建 - 插件选择界面 |
| `src/renderer/main.tsx` | 修改 - 添加插件选择流程 |
| `src/process/index.ts` | 修改 - 调整初始化逻辑 |
| `src/process/initStatus.ts` | 修改 - 添加 waitingForUserChoice 状态 |

## Verification
1. 首次启动应用，应显示插件选择界面
2. 未安装的插件默认全选
3. 用户可以取消选择某些插件
4. 点击安装后，显示安装进度
5. 安装完成后进入主界面
6. 再次启动应用，不应再显示插件选择界面
7. 如果有未安装的插件（用户之前取消），设置中应提供重新安装的入口