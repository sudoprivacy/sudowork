# Sudowork 内网离线版设计方案

- 状态：已确认，待实施
- 日期：2026-08-02
- 配置入口：`brand.config.json`
- 适用范围：Electron 桌面端

## 1. 背景

Sudowork 当前在 App 启动阶段会检查并准备 Node.js、Sudocode、Nexus、Git、Claude Code CLI 和 bdpan。其中 Sudocode、Nexus 和 Git 在本地资源缺失时存在公网安装路径；Nexus 还会安装并加载 Vault 插件。

目标环境不能访问外部网络，但构建机可以访问公网。因此离线版采用“构建时下载、运行时只使用安装包内资源”的方式，而不是在目标机器上等待公网请求失败后降级。

同时，离线版不再依赖 Nexus Vault 插件。原本由 Vault 提供的凭据存储能力改为 Electron `safeStorage` 加密的本机文件实现，但产品层仍统一称为“Nexus 密钥库”。

## 2. 已确认决策

1. 在 `brand.config.json` 中使用布尔字段 `BUILD_OFFLINE` 标识离线版。
2. 构建机可以联网，允许在打包前下载目标平台资源。
3. 离线安装包必须自带 Node.js、Sudocode 和 Nexus Cluster。
4. Sudocode 和 Nexus Cluster 在离线版运行时禁止公网回退。
5. 离线版不考虑 bdpan：不下载、不打包、不检测、不安装、不展示。
6. Git 在离线版只检测，不自动在线安装，也不阻塞核心初始化。
7. Claude Code CLI 在离线版只检测，不自动安装，也不阻塞核心初始化。
8. 离线版禁用 Nexus Vault：不检查、不下载、不安装、不加载、不等待 Vault 服务。
9. 离线版保留凭据功能，改用 `safeStorage` 加密的本机文件作为 Secret Store。
10. 对外文案保持：**“凭据安全存储在本地 Nexus 密钥库中”**。
11. 本阶段暂不处理自动更新、systemConfig、telemetry、日志上报和 Channel 等其他隐式公网请求。

## 3. 目标与非目标

### 3.1 目标

- 干净机器无法访问 GitHub、COS、Homebrew 和系统软件源时，核心初始化仍可完成。
- 核心初始化期间 Node.js、Sudocode、Nexus Cluster 均只使用安装包内资源。
- 缺少核心资源时快速失败，并明确提示“安装包不完整”，不等待网络超时。
- 在线版保持现有运行时下载和 Vault 行为。
- 离线版继续支持 API Key、Channel 凭据、Auth Proxy 和网站自动登录等 Secret Store 使用场景。
- 不新增第三方加密依赖。

### 3.2 非目标

- 本阶段不保证整个 App 完全不产生公网请求。
- 不建设内网制品下载中心。
- 不为离线版打包或预置 Nexus Vault。
- 不支持 bdpan。
- 不实现 Secret 历史版本浏览等当前业务没有使用的 Vault 高级能力。
- 不将业务凭据写入 `brand.config.json` 或安装包。

## 4. 构建模式

在 `brand.config.json` 中增加：

```json
{
  "BUILD_OFFLINE": true
}
```

规则：

| 配置值 | 行为 |
| --- | --- |
| `true` | 构建并运行离线版 |
| `false` 或缺失 | 保持在线版行为 |

新增共享常量，例如：

```ts
// src/common/buildMode.ts
import brand from '@brand';

export const IS_OFFLINE_BUILD = brand.BUILD_OFFLINE === true;
```

主进程和 Renderer 必须复用该常量。Node 构建脚本直接读取 `brand.config.json`，不再维护第二个离线开关。

`BUILD_OFFLINE` 是编译期品牌配置，修改后必须重新构建或重启 Electron 主进程，不能依赖 Renderer HMR。

## 5. 总体架构

```text
                         brand.config.json
                         BUILD_OFFLINE
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
         在线版构建                           离线版构建
              │                                   │
     现有资源与公网回退                构建时准备并校验本地资源
              │                                   │
     Nexus Vault Secret Store          LocalEncryptedSecretStore
              │                                   │
              └────────── 统一 Secret Store API ──┘
```

离线版启动主链路：

```text
App 启动
  ├─ Node.js：已安装，或从安装包解压
  ├─ Sudocode：已安装且版本一致，或从安装包解压
  ├─ Nexus Cluster：已安装且版本一致，或从安装包解压并启动
  ├─ Git：仅检测
  ├─ Claude Code CLI：仅检测
  ├─ bdpan：完全跳过
  ├─ Nexus Vault：完全跳过
  └─ LocalEncryptedSecretStore：safeStorage 解密本地密钥库
```

只有 Node.js、Sudocode 和 Nexus Cluster 是离线版核心初始化门槛。

## 6. 离线资源准备与打包

### 6.1 必需资源

离线安装包必须包含当前目标平台和目标架构对应的：

```text
node-{platform}-{arch}.{zip|tar.gz}
v{scodeVersion}-scode-{os}-{arch}.{zip|tar.gz}
v{nexusVersion}-nexusd-cluster-{os}-{arch}.{zip|tar.gz}
```

版本来源：

```text
src/shared/runtime-versions.json
```

平台文件名来源：

```text
src/shared/scode-platforms.json
```

### 6.2 构建步骤

```text
读取 brand.config.json
  ↓
BUILD_OFFLINE=true
  ↓
按目标平台和目标架构下载 Node、Sudocode、Nexus Cluster
  ↓
执行离线资源硬校验
  ↓
校验通过后执行 electron-builder
```

下载必须按目标架构执行，不能只使用构建机的 `process.arch`。例如，在 Apple Silicon 构建机上打 macOS x64 包时，必须准备 x64 资源。

### 6.3 资源硬校验

新增：

```text
scripts/verify-offline-resources.js
```

脚本读取：

- `brand.config.json`
- `src/shared/runtime-versions.json`
- `src/shared/runtime-sha256.json`
- `src/shared/scode-platforms.json`
- 本次构建的目标平台与架构

校验内容：

1. Node.js、Sudocode、Nexus Cluster 文件存在；
2. 文件不是零字节占位文件；
3. 文件大小达到合理最低值；
4. 文件名版本与 `runtime-versions.json` 一致；
5. 已配置 SHA256 的资源必须匹配；
6. 不要求 bdpan 和 Nexus Vault。

任一必需资源不满足时直接终止构建，例如：

```text
Offline build aborted: Sudocode v0.1.15 for macos-arm64 is missing
```

不得生成一个运行时依赖公网补全的“离线安装包”。

### 6.4 electron-builder 配置

把平台运行时资源选择集中到 `electron-builder.brand.js`：

- 在线版注入现有 Node、bdpan、Sudocode、Nexus Cluster、Vault 资源规则；
- 离线版只注入 Node、Sudocode、Nexus Cluster；
- 避免在 `electron-builder.yml` 和 JS 配置中分别维护两套平台矩阵。

离线包不应包含：

```text
bdpan-installer-*
v*-nexus-vault-*
```

## 7. RuntimeInstaller 行为

### 7.1 离线版任务表

| 组件 | 检测 | 安装来源 | 是否阻塞 ready |
| --- | --- | --- | --- |
| Node.js | 是 | 仅安装包 | 是 |
| Sudocode | 是 | 仅安装包 | 是 |
| Nexus Cluster | 是 | 仅安装包 | 是 |
| Git | 是 | 不自动安装 | 否 |
| Claude Code CLI | 是 | 不自动安装 | 否 |
| bdpan | 否 | 无 | 否 |
| Nexus Vault | 否 | 无 | 否 |

离线版不得把 Git、Claude 或 bdpan 放进决定核心初始化成功与否的必需任务集合。

### 7.2 InitLoading

离线版不展示 bdpan 步骤。

`startup` 视图继续只突出 Sudocode 和 Nexus。完整视图可展示 Node、Git、Claude 的检测结果，但 Git 和 Claude 缺失只能是提示状态，不能令初始化失败。

## 8. Sudocode 离线策略

修改：

```text
src/process/services/scode/ScodeInstallService.ts
```

在线版保持现有行为：

```text
已安装且版本一致 → 使用
否则 → 随包资源优先 → GitHub 兜底
```

离线版行为：

```text
已安装且 marker 版本一致
  → 使用现有安装

未安装或 marker 版本不一致
  → 查找安装包内当前版本资源
      ├─ 找到：本地解压安装
      └─ 找不到：立即失败
```

`BUILD_OFFLINE=true` 时不得调用 `downloadScode()`。

建议错误信息：

```text
内网安装包缺少 Sudocode v{version}，请重新安装完整版本
```

版本判断继续使用当前 marker：

```text
~/.nexus/sudowork/sudocode/.scode-bin-ready
```

旧版本升级时直接使用安装包内当前版本覆盖，不访问 GitHub。

## 9. Nexus Cluster 与 Vault 策略

修改：

```text
src/process/services/nexus-vfs/DynamicNexusVfsService.ts
src/process/services/serviceManager/ServiceManager.ts
```

### 9.1 Nexus Cluster

在线版保持：

```text
随包资源 → Runtime COS → Legacy COS
```

离线版：

```text
已安装且 marker 版本一致
  → 直接启动

未安装或版本不一致
  → 查找安装包内 Nexus Cluster
      ├─ 找到：本地安装并启动
      └─ 找不到：立即失败
```

`BUILD_OFFLINE=true` 时不得调用 Nexus 下载 URL 或 `downloadFile()`。

建议错误信息：

```text
内网安装包缺少 Nexus Cluster v{version}，请重新安装完整版本
```

### 9.2 禁用 Nexus Vault

离线版必须同时关闭以下行为：

1. `checkInstalledSync()` 不把 Vault 作为 Nexus 已安装条件；
2. Nexus 安装完成后不调用 `vaultPluginInstaller.install()`；
3. Nexus 启动参数不添加 Vault `--plugin-dir`；
4. 不调用 `waitForVaultServiceReady()`；
5. 不执行 `password-vault` 启动探测；
6. 打包阶段不包含 Vault 归档。

离线版的 Nexus 就绪条件为：

```text
Nexus Cluster 二进制存在
+ marker 版本一致
+ 本地 gRPC 服务成功启动
```

在线版的 Vault 行为保持不变。

## 10. 本地 Nexus 密钥库

### 10.1 产品命名

离线版底层不使用 Nexus Vault 插件，但产品层仍称为“Nexus 密钥库”。对外文案保持：

> 凭据安全存储在本地 Nexus 密钥库中

不向用户暴露 `safeStorage`、加密文件或底层后端差异。

### 10.2 后端选择

```text
BUILD_OFFLINE=false
  → NexusVaultSecretStore

BUILD_OFFLINE=true
  → LocalEncryptedSecretStore
```

新增统一接口，业务调用方不直接判断构建模式：

```ts
interface ISecretStore {
  initialize(): Promise<void>;
  putSecret(namespace: string, key: string, value: string, description?: string): SecretMetadata;
  getSecret(namespace: string, key: string): string;
  deleteSecret(namespace: string, key: string): boolean;
  restoreSecret(namespace: string, key: string): boolean;
  listSecrets(namespace?: string, includeDeleted?: boolean): SecretMetadata[];
  batchPut(secrets: SecretInput[]): SecretMetadata[];
  batchGet(queries: SecretQuery[]): Record<string, string>;
}
```

只实现当前调用链实际需要的能力。Vault 的历史版本列表、删除指定版本等未使用能力不进入离线版 v1。

建议入口：

```ts
getSecretStore(): ISecretStore
```

现有业务调用从 `getNexusSecretClient()` 迁移到该入口；在线实现内部继续复用 `NexusSecretClient`。

### 10.3 本地文件

建议路径：

```text
app.getPath('userData')/nexus-secrets.enc
```

磁盘上的外层结构只保存格式版本和密文：

```json
{
  "version": 1,
  "payload": "<safeStorage encrypted bytes encoded as base64>"
}
```

解密后的内存结构按 `namespace + key` 保存 Secret 值和必要元数据。磁盘文件不得暴露明文 Secret、namespace、服务名或凭据数量。

### 10.4 加密与持久化

使用 Electron 原生能力：

```ts
safeStorage.encryptString(JSON.stringify(data))
safeStorage.decryptString(buffer)
```

要求：

1. 初始化时检查 `safeStorage.isEncryptionAvailable()`；
2. Linux 若后端为 `basic_text`，必须拒绝保存敏感信息，不能静默降级为明文；
3. 写文件使用临时文件加原子替换，避免断电损坏主文件；
4. Unix 文件权限设置为 `0600`；
5. 启动时解密一次进入内存 `Map`；
6. 读取从内存完成，写入更新内存后立即持久化；
7. 日志不得打印 Secret 值或完整密文；
8. 不把密钥或固定密码硬编码在代码中。

本方案不新增 `keytar` 或自定义 AES 密钥管理代码。

### 10.5 Secret Cache、IPC 与 Auth Proxy

离线版仍初始化 Secret Store，因此以下功能可以保留：

- Secret Cache 同步读取；
- `secret.*` IPC；
- Auth Proxy Secret 注入；
- Channel 凭据；
- Sudorouter 用户密钥同步；
- 网站自动登录。

调整原则：

- `secret-cache.ts` 依赖统一 `ISecretStore`，不直接依赖 `NexusSecretClient`；
- `secretBridge.ts`、`secretsApi.ts`、`userKeySync.ts` 和 `pwdLoginService.ts` 使用 `getSecretStore()`；
- 在线版保留现有 Vault 兼容回退；
- 离线版直接调用本地实现，不执行 `password-vault.*` gRPC。

### 10.6 迁移策略

离线版 v1 面向干净部署，不自动从已有 Nexus Vault 导出 Secret。

原因：自动迁移需要临时加载 Vault，与“离线版不依赖、不加载 Vault”的启动契约冲突，也会显著扩大首版范围。

规则：

- 新安装：在目标机器通过 UI 或受控管理流程写入本地 Nexus 密钥库；
- 从在线版切换到离线版：原 Vault 数据不自动迁移，用户或管理员重新录入；
- 如果未来存在批量升级需求，单独提供迁移工具，在切换版本前从在线版导出并在目标机器导入；迁移文件必须加密且不可复用构建机密文。

`safeStorage` 密文通常绑定机器或系统用户，因此不能在构建机加密后随安装包分发。

## 11. UI 策略

采用本地 Secret Store 后，离线版不需要隐藏凭据相关功能：

- 保留“秘钥管理”；
- 保留网站自动登录；
- 保留 API Key 配置；
- 保留 Channel 凭据配置；
- 保留 Auth Proxy 相关能力；
- 保留 `/login <title>` 和审批弹窗。

对外文案不变：

> 凭据安全存储在本地 Nexus 密钥库中

UI 不显示“Nexus Vault 已禁用”，因为这是实现细节。

## 12. bdpan、Git 与 Claude

### 12.1 bdpan

离线版：

- 构建脚本不下载；
- electron-builder 不打包；
- RuntimeInstaller 不导入服务；
- 不执行检测或安装；
- InitLoading 不显示该步骤。

在线版保持现状。

### 12.2 Git

离线版只执行本地检测：

```text
git --version
```

缺失时：

- 不从 COS 下载；
- 不执行 Homebrew；
- 不执行 Linux 包管理器；
- 不阻塞核心初始化；
- UI 可提示联系管理员安装。

### 12.3 Claude Code CLI

离线版只检查受管路径或系统 PATH，不自动安装，不阻塞核心初始化。

## 13. 失败策略

离线版禁止“缺资源后尝试公网”。核心资源失败必须可诊断：

| 场景 | 结果 |
| --- | --- |
| Node 资源缺失 | InitLoading error：安装包缺少 Node.js |
| Sudocode 资源缺失 | InitLoading error：安装包缺少对应版本 Sudocode |
| Nexus Cluster 资源缺失 | InitLoading error：安装包缺少对应版本 Nexus Cluster |
| Nexus 本地服务启动失败 | InitLoading error：展示本地启动失败原因 |
| Git 缺失 | 非阻塞提示 |
| Claude 缺失 | 非阻塞提示 |
| safeStorage 不可用 | 凭据功能明确不可用；不得写明文 |
| 本地密钥库损坏或无法解密 | 不覆盖原文件，提示用户处理或恢复 |

本地密钥库解密失败时，不得把空数据写回原文件，否则会造成不可恢复的数据丢失。

## 14. 测试计划

### 14.1 品牌配置

验证：

- `BUILD_OFFLINE` 为布尔值；
- `IS_OFFLINE_BUILD` 与品牌配置一致；
- 在线、离线两个构建分支均能通过类型检查。

### 14.2 离线资源校验

验证：

- 三个核心资源完整时通过；
- 缺文件、零字节、版本不匹配、SHA256 不匹配时构建失败；
- bdpan 和 Vault 缺失不影响离线构建；
- 目标架构与构建机架构不同仍检查正确资源。

### 14.3 Sudocode

验证：

- 已安装且版本一致时跳过；
- 离线版从随包归档安装；
- 旧版本从随包归档升级；
- 随包归档缺失时立即失败；
- 离线版不创建 HTTP/HTTPS 请求；
- 在线版仍保留 GitHub 回退。

### 14.4 Nexus

验证：

- 离线版安装判断不要求 Vault；
- 不调用 `vaultPluginInstaller.install()`；
- 启动参数不含 Vault plugin dir；
- 不探测 `password-vault`；
- Nexus Cluster 缺失时立即失败；
- 在线版 Vault 行为不变。

### 14.5 LocalEncryptedSecretStore

验证：

- 首次初始化创建加密文件；
- 文件中不包含明文 Secret、namespace 或 key；
- put/get/list/delete/restore/batch 行为正确；
- 重启后可以解密并恢复数据；
- 临时文件写入失败时原文件保持可读；
- 错误用户或无法解密时不覆盖原文件；
- Linux `basic_text` 后端拒绝保存；
- 文件权限符合要求；
- 日志不包含 Secret。

### 14.6 RuntimeInstaller

验证：

- 离线版只把 Node、Sudocode、Nexus 作为必需项；
- Git 和 Claude 缺失不阻塞 ready；
- 不导入、不检测、不安装 bdpan；
- 不调用 Git 在线安装逻辑。

### 14.7 回归测试

验证在线版：

- Sudocode 仍可 GitHub 回退；
- Nexus 仍可 COS 回退；
- Vault 仍正常安装、加载和探测；
- Nexus Secret Store 行为不变；
- bdpan 在线版行为不变。

## 15. 安装包验收

在干净目标机器上：

```text
删除 ~/.nexus/sudowork/sudocode
删除 ~/.nexus-vfs
阻断 github.com
阻断 *.myqcloud.com
阻断 Homebrew 和系统软件源
启动 App
```

预期：

1. Node.js 从安装包解压；
2. Sudocode 从安装包解压；
3. Nexus Cluster 从安装包解压并启动；
4. 不检测、不安装 bdpan；
5. 不下载、不安装、不加载 Nexus Vault；
6. Git 和 Claude 缺失不阻塞启动；
7. InitLoading 正常进入 ready；
8. 可以保存并重新读取本地凭据；
9. 本地密钥库磁盘文件不包含明文；
10. 第二次启动不重复安装核心运行时；
11. 删除任一核心归档后，快速提示安装包不完整，不等待网络超时。

抓包验收范围：

> 核心运行时初始化不访问 GitHub、COS、Homebrew 或系统软件源。

由于本阶段不处理自动更新、systemConfig、telemetry 和 Channel 等路径，不能据此宣称整个 App 启动过程完全没有公网连接。

## 16. 实施顺序

1. 增加 `BUILD_OFFLINE` 和统一构建模式常量；
2. 重构 electron-builder 运行时资源选择；
3. 增加离线资源下载参数和构建前硬校验；
4. 修改 Sudocode 离线安装路径；
5. 修改 Nexus Cluster 离线安装路径并禁用 Vault；
6. 增加统一 `ISecretStore` 和 `LocalEncryptedSecretStore`；
7. 将 Secret Cache、IPC、Auth Proxy、Channel、pwd-login 切到统一接口；
8. 从离线 RuntimeInstaller 和 UI 移除 bdpan；
9. 调整 Git、Claude 为非阻塞检测；
10. 补齐单元、集成和安装包断网验收。

## 17. 预计主要修改文件

```text
brand.config.json
src/common/buildMode.ts

package.json
electron-builder.brand.js
electron-builder.yml
scripts/verify-offline-resources.js
scripts/download-node.js
scripts/download-scode.js
scripts/download-nexus-vfs.js

src/process/services/serviceManager/RuntimeInstaller.ts
src/process/services/serviceManager/ServiceManager.ts
src/process/services/scode/ScodeInstallService.ts
src/process/services/nexus-vfs/DynamicNexusVfsService.ts

src/common/nexus/secret-store.ts
src/common/nexus/nexus-secret-client.ts
src/common/nexus/secret-cache.ts
src/common/nexus/secret-migration.ts
src/process/services/secretStore/LocalEncryptedSecretStore.ts
src/process/bridge/secretBridge.ts
src/process/services/authProxy/secretsApi.ts
src/process/services/authProxy/userKeySync.ts
src/process/services/pwdLogin/pwdLoginService.ts

src/renderer/components/InitLoading.tsx

tests/unit/branding.test.ts
tests/unit/ScodeInstallService.test.ts
tests/unit/DynamicNexusVfsService.test.ts
tests/unit/LocalEncryptedSecretStore.test.ts
tests/integration/offline-startup.integration.test.ts
```

最终文件范围以实现时实际调用链为准，不为未使用能力增加抽象或兼容层。

## 18. 完成标准

同时满足以下条件才算完成：

- 离线包构建缺核心资源时必然失败；
- 目标机器断公网后可完成首次核心初始化；
- 核心初始化没有 Sudocode、Nexus、Git 的公网请求；
- 离线版没有 bdpan 和 Nexus Vault 安装路径；
- 凭据通过 `safeStorage` 加密后持久化，本机重启可恢复；
- 对外文案仍为“凭据安全存储在本地 Nexus 密钥库中”；
- 在线版现有功能通过回归测试；
- `bunx tsc --noEmit`、目标文件 ESLint、相关 Vitest 和断网安装验收全部通过。
