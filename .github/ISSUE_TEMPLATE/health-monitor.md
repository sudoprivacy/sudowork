---
name: 自动组件健康检查功能
about: 实现运行时组件自动健康监控和自愈功能
title: 'feat: 自动组件健康检查功能'
labels: enhancement
assignees: ''
---

# 自动组件健康检查功能 - 实现计划

## 背景与目标

### 问题
Sudowork 首次安装时，部分运行时组件（Node.js、Sudoclaw、Nexus、Git）可能安装失败或启动失败。目前用户必须手动打开「设置 → 运行环境」检查状态并点击安装/启动按钮。

### 目标
实现自动健康监控，要求：
- 每隔 3-5 秒自动检测所有运行时组件
- 如果组件未安装 → 自动触发安装
- 如果组件已安装但服务停止 → 自动启动服务
- 如果组件正常运行 → 不做任何处理
- 无需用户干预，自动处理首次安装后的组件异常问题

---

## 涉及的组件

| 组件 | 检测方式 | 未安装处理 | 已安装但未运行处理 |
|------|---------|-----------|------------------|
| **Git** | `spawnSync('git', ['--version'])` | `ensureGitInstalled()` 在线安装 | N/A（无服务） |
| **Node.js** | `isNodeInstalled()` 检查 `~/.nexus/node` | `ensureNodeInstalled()` 解压内嵌 tar.gz | N/A（无服务） |
| **Sudoclaw** | 检查二进制 + HTTP 健康检查端口 17863 | `ensureSudoclawInstalled()` 解压 `openclaw.tgz` | `ServiceManager.startOpenClaw()` |
| **Nexus** | 检查二进制 + HTTP 健康检查端口 12012 | `dynamicNexusService.install()` 解压 `nexus.tar.gz` | `ServiceManager.startNexus()` |

---

## 架构设计

### 复用现有基础设施

1. **RuntimeInstaller.ts**（`src/process/services/serviceManager/RuntimeInstaller.ts`）
   - `ensureAll()` 已实现完整的组件检查和安装逻辑
   - 快速同步预检查 + 异步完整检查
   - 通过 `initStatusManager` 追踪进度

2. **ServiceManager.ts**（`src/process/services/serviceManager/ServiceManager.ts`）
   - `startNexus()` / `stopNexus()` - Nexus 生命周期
   - `startOpenClaw()` / `stopOpenClaw()` - Sudoclaw 网关生命周期

3. **initStatus.ts**（`src/process/services/initStatus.ts`）
   - `InitStatusManager` 提供订阅/通知模式

### 新增服务：ComponentHealthMonitor

**创建文件**: `src/process/services/serviceManager/ComponentHealthMonitor.ts`

核心逻辑:
- 每 4 秒轮询一次
- 跟踪每个组件的连续失败次数，超过阈值后降级检查频率
- 每次检查周期只执行一个安装/启动动作，避免并发冲突

---

## 实现步骤

### 步骤 1: 创建健康监控服务

创建 `src/process/services/serviceManager/ComponentHealthMonitor.ts`，包含：
- `ComponentHealthMonitor` 类
- 组件健康检查方法（Git、Node、Sudoclaw、Nexus）
- 自愈逻辑（安装/启动）
- 连续失败追踪和降级机制

### 步骤 2: 修改 ServiceManager 集成健康监控

在 `ServiceManager.startup()` 方法末尾添加：
```typescript
const { componentHealthMonitor } = await import('./ComponentHealthMonitor');
void componentHealthMonitor.start();
```

### 步骤 3: 创建 IPC 桥接

创建 `src/process/bridge/healthMonitorBridge.ts`，提供：
- `getStatus` - 获取监控状态
- `enable` - 启用监控
- `disable` - 禁用监控

### 步骤 4: 更新 IPC 类型定义

在 `src/common/ipcBridge.ts` 添加 `healthMonitor` 导出。

### 步骤 5: 在 initBridge 中注册

在 `src/process/initBridge.ts` 导入并调用 `initHealthMonitorBridge()`。

---

## 安全机制

1. **连续失败追踪**: 同一组件连续失败 3 次后，检查间隔延长至 30 秒
2. **单次只执行一个动作**: 避免并发安装/启动冲突
3. **用户意图尊重**: 后续可扩展为记录用户显式卸载操作，不自动重装

---

## 验证步骤

1. 运行应用
2. 观察主进程日志，确认健康监控启动
3. 手动停止某服务（如 `pkill -f nexusd`）
4. 等待 ≤5 秒，验证服务自动重启
5. 检查日志中的自愈成功消息

---

## 关键文件清单

| 操作 | 文件路径 |
|------|---------|
| 创建 | `src/process/services/serviceManager/ComponentHealthMonitor.ts` |
| 创建 | `src/process/bridge/healthMonitorBridge.ts` |
| 修改 | `src/common/ipcBridge.ts` |
| 修改 | `src/process/services/serviceManager/ServiceManager.ts` |
| 修改 | `src/process/initBridge.ts` |
