# sudowork 技能与数字助手发现机制文档

> 本文档详细说明了 sudowork 项目中技能(Skill)和数字助手(Assistant)的发现、安装和使用机制。

## 目录

1. [技能发现机制](#一技能发现机制)
2. [数字助手发现机制](#二数字助手发现机制)
3. [技能商店集成](#三技能商店集成)
4. [运行时使用](#四运行时使用)
5. [关键文件总结](#五关键文件总结)
6. [数据流图](#六数据流图)

---

## 一、技能发现机制

### 1.1 目录结构

技能存储在 `skills/` 目录下，按来源分为三个子目录：

```
skills/
├── _system/           # 内置技能
│   └── _builtin/      # 系统内置技能（不可卸载）
├── _hub/              # 从技能商店安装的技能
└── _my-custom-skill/  # 用户自定义/上传的技能
```

| 目录 | 说明 | 可卸载 |
|------|------|--------|
| `_system/` | 内置技能，随应用发布 | ❌ |
| `_hub/` | 从技能商店下载安装 | ✅ |
| `_my-custom-skill/` | 用户上传或自定义 | ✅ |

### 1.2 发现流程

#### 前端发现

文件：`src/renderer/components/SettingsModal/contents/SkillModalContent.tsx`

```typescript
// 通过 IPC 调用后端获取已安装技能列表
const res = await skillHub.getInstalledSkills.invoke();
if (res.success && res.data) {
  setInstalledList(res.data);
}
```

#### 后端发现

文件：`src/process/SkillManager.ts`

```typescript
async getInstalledSkills(): Promise<ISkillInfo[]> {
  const skills: ISkillInfo[] = [];

  // 1. 扫描所有启用的技能目录
  const enabledDirs = await this.scanAllSkillDirs();
  for (const skillDir of enabledDirs) {
    const category = this.getCategoryFromPath(skillDir);
    const isSystem = category === 'system';
    const skill = await this.readSkillInfo(skillDir, category, isSystem);
    if (skill) {
      skill.status = 'enabled';
      skills.push(skill);
    }
  }

  // 2. 扫描所有禁用的技能目录 (_disable 子目录)
  const disabledResults = await this.scanDisabledSkillDirs();
  for (const { skillDirs } of disabledResults) {
    for (const skillDir of skillDirs) {
      const category = this.getCategoryFromPath(skillDir);
      const skill = await this.readSkillInfo(skillDir, category, isSystem);
      if (skill) {
        skill.status = 'disabled';
        skill.enabled = false;
        skills.push(skill);
      }
    }
  }

  return skills;
}
```

#### 扫描逻辑

```typescript
// 递归搜索所有技能目录（包括嵌套目录如 _system/_builtin）
private async scanAllSkillDirs(): Promise<string[]> {
  const dirs: string[] = [];

  // 扫描主目录
  for (const dir of [this.customDir, this.hubDir, this.systemDir]) {
    const subDirs = await this.scanSkillDirs(dir);
    dirs.push(...subDirs);
  }

  // 额外扫描 _system/_builtin 目录
  const builtinDir = path.join(this.systemDir, '_builtin');
  if (existsSync(builtinDir)) {
    const builtinSubDirs = await this.scanSkillDirs(builtinDir);
    dirs.push(...builtinSubDirs);
  }

  return dirs;
}

// 扫描目录（排除 _ 开头的目录）
private async scanSkillDirs(baseDir: string): Promise<string[]> {
  const dirs: string[] = [];
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // 排除 _ 开头的目录
    if (entry.name.startsWith('_')) continue;
    dirs.push(path.join(baseDir, entry.name));
  }
  return dirs;
}
```

### 1.3 元数据结构

每个技能目录包含 `_sudowork_meta.json` 文件作为唯一数据源（SSOT）。

文件：`src/common/ipcBridge.ts`

```typescript
export interface ISkillHubMeta {
  id: string;                      // 技能唯一标识
  name: string;                    // 技能名称
  display_name: string;            // 显示名称
  description: string;             // 描述
  icon: string;                    // 图标URL
  emoji: string | null;            // emoji图标
  category: string;                // 分类
  categories: string[];            // 分类列表
  applicable_scenarios: string | null;  // 适用场景
  core_features: string | null;    // 核心功能
  homepage: string | null;         // 主页链接
  author_id: string;               // 作者ID
  source_type?: 'hub' | 'upload' | 'custom';  // 来源类型
  is_builtin?: boolean;            // 是否内置
  enabled?: boolean;               // 是否启用
  installed_version: string;       // 安装版本
  installed_at: string;            // 安装时间
}
```

### 1.4 技能信息接口

```typescript
export interface IInstalledSkillInfo {
  name: string;                    // 目录名（技能标识）
  version: string;                 // 版本号
  isHubInstalled: boolean;         // 是否从Hub安装
  isBuiltin: boolean;              // 是否内置技能
  isAutoInjectedBuiltin?: boolean; // 是否自动注入的内置技能
  enabled: boolean;                // 是否启用
  meta?: ISkillHubMeta;            // 元数据
}
```

---

## 二、数字助手发现机制

### 2.1 目录结构

助手存储在 `assistants/` 目录下，按来源分为三个子目录：

```
assistants/
├── _system/                  # 内置助手
├── _hub/                     # 从助手商店安装的助手
└── _my-custom-assistant/     # 用户自定义助手
```

### 2.2 发现流程

#### 前端发现

文件：`src/renderer/components/SettingsModal/contents/AgentModalContent.tsx`

```typescript
// 通过 IPC 调用后端获取已安装助手列表
const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
if (result?.data) {
  const localAgents = (result?.data ?? []).map((info) => ({
    ...toBackendConfig(info),
    _category: info.category,
    _isHubInstalled: info.isHubInstalled,
  }));
  setAssistants(localAgents);
}
```

#### 后端发现

文件：`src/process/AssistantManager.ts`

```typescript
async getInstalledAssistants(): Promise<IAssistantInfo[]> {
  const assistants: IAssistantInfo[] = [];

  for (const baseDir of [this.systemDir, this.hubDir, this.customDir]) {
    const dirs = await this.scanAssistantDirs(baseDir);
    for (const assistantDir of dirs) {
      const category = this.getCategoryFromPath(assistantDir);
      const info = await this.readAssistantInfo(assistantDir, category);
      if (info) assistants.push(info);
    }
  }

  return assistants;
}
```

### 2.3 元数据结构

文件：`src/process/constants/assistantStorage.ts`

```typescript
export interface IAssistantMeta {
  id: string;                      // 助手唯一标识
  name?: string;                   // 助手名称
  nameI18n?: Record<string, string>;  // 国际化名称
  descriptionI18n?: Record<string, string>; // 国际化描述
  avatar?: string;                 // 头像URL
  emoji?: string | null;           // emoji头像
  presetAgentType?: string;        // 预设代理类型
  source_type?: 'hub' | 'custom' | 'builtin';  // 来源类型
  tag?: 'hub' | 'custom' | 'system';  // 标签
  skills?: string[];               // 关联技能ID列表
  enabledSkills?: string[];        // 启用的技能ID列表
  category_id?: string;            // 分类ID
  categories?: string[];           // 分类列表
  author_id?: string;              // 作者ID
  homepage?: string | null;        // 主页链接
  applicable_scenarios?: string | null;  // 适用场景
  core_features?: string | null;   // 核心功能
  is_builtin?: boolean;            // 是否内置
  enabled?: boolean;               // 是否启用
  defaultInitPrompt?: string | null;  // 默认初始提示
  installed_version?: string;      // 安装版本
  installed_at?: string;           // 安装时间
  ruleFile?: string;               // 规则文件名
}
```

### 2.4 助手信息接口

```typescript
export interface IAssistantInfo {
  name: string;                    // 目录名（查找键）
  isBuiltin: boolean;              // 是否内置
  isHubInstalled: boolean;         // 是否从Hub安装
  enabled: boolean;                // 是否启用
  category: AssistantCategory;     // 分类
  meta: IAssistantMeta;            // 元数据
}
```

---

## 三、技能商店集成

### 3.1 Hub API 端点

```
技能商店 API: https://sudoworkhub.sudoprivacy.com/api/skills
助手商店 API: https://sudoworkhub.sudoprivacy.com/api/assistants
分类 API: https://sudoworkhub.sudoprivacy.com/api/categories
```

### 3.2 技能商店桥接

文件：`src/process/bridge/skillHubBridge.ts`

#### 获取技能列表（分页）

```typescript
ipcBridge.skillHub.fetchSkills.provider(async ({ cursor, limit = 20, query = '', category = '', tenantId }) => {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  if (query) params.set('query', query);
  if (category) params.set('categories', category);
  if (tenantId) params.set('tenant_id', tenantId);

  const response = await fetch(`${SKILL_HUB_CURSOR_URL}?${params}`, {
    headers: { Authorization: AUTHORIZATION },
  });
  const result = await response.json();
  return { success: true, data: result.data };
});
```

#### 下载并安装技能

```typescript
ipcBridge.skillHub.downloadAndInstallSkill.provider(async ({ skillName, displayName, sourceUrl, version, checksum, skillMeta }) => {
  // 1. 下载zip文件
  const zipBuffer = await downloadFile(sourceUrl);

  // 2. 校验checksum（可选）
  if (checksum) {
    const isValid = await verifyChecksum(zipBuffer, checksum);
  }

  // 3. 解压到目标目录
  const hubSkillsDir = getHubSkillsDir();
  const skillDir = path.join(hubSkillsDir, skillName);
  await extractSkillZipToDirectory(zipBuffer, skillDir);

  // 4. 写入元数据
  const meta = {
    id: skillMeta?.id ?? '',
    name: skillName,
    display_name: skillMeta?.display_name ?? displayName,
    source_type: 'hub',
    enabled: true,
    installed_version: version,
    installed_at: new Date().toISOString(),
    // ... 其他字段
  };
  await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

  // 5. 热重载运行时
  await reloadSkillRuntime();

  return { success: true, data: { skillName, installedVersion: version } };
});
```

#### 导入本地技能

```typescript
ipcBridge.skillHub.importLocalSkill.provider(async ({ sourcePath }) => {
  // 1. 判断是目录还是zip文件
  const sourceStat = await fs.stat(sourcePath);

  // 2. 解压/复制到临时目录
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-skill-import-'));
  let importedFiles: string[] = [];

  if (sourceStat.isDirectory()) {
    const { copiedFiles } = await copySkillDirectoryToDirectory(sourcePath, tempDir);
    importedFiles = copiedFiles;
  } else {
    const zipBuffer = await fs.readFile(sourcePath);
    const { extractedFiles } = await extractSkillZipToDirectory(zipBuffer, tempDir);
    importedFiles = extractedFiles;
  }

  // 3. 安装到自定义技能目录
  return await installImportedSkillFromPreparedDirectory(tempDir, importedFiles, missingSkillMessage);
});
```

### 3.3 助手商店桥接

文件：`src/process/bridge/assistantHubBridge.ts`

#### 获取助手列表

```typescript
ipcBridge.assistantHub.fetchAssistants.provider(async ({ cursor, limit, query, category, tenantId }) => {
  const response = await fetch(`${ASSISTANT_HUB_CURSOR_URL}?${params}`, {
    headers: { Authorization: AUTHORIZATION },
  });
  const result = await response.json();

  // 映射API响应到前端类型
  const mappedAssistants = rawAssistants.map((a) => ({
    id: a.id,
    name: a.name,
    display_name: a.profession || a.name,
    skills: a.skills || [],
    _sourceUrl: a.sourceUrl,  // 存储下载URL
    // ...
  }));

  return { success: true, data: mappedData };
});
```

#### 下载并安装助手（含关联技能）

```typescript
ipcBridge.assistantHub.downloadAndInstallAssistant.provider(async ({ assistantName, displayName, sourceUrl, version, checksum, assistantMeta, selectedSkillIds }) => {
  // 1. 下载助手zip
  const zipBuffer = await downloadFile(sourceUrl);

  // 2. 解压到目标目录
  const targetDir = assistantMeta.tag === 'system' ? getSystemAssistantsDir() : getHubAssistantsDir();
  const assistantDir = path.join(targetDir, assistantName);
  await extractAssistantZipToDirectory(zipBuffer, assistantDir);

  // 3. 安装选中的关联技能
  const installedSkillNames: string[] = [];
  const failedSkillIds: string[] = [];

  if (selectedSkillIds && selectedSkillIds.length > 0) {
    for (const skillId of selectedSkillIds) {
      // 检查是否已安装
      const localSkillInfo = installedSkillByIdMap.get(skillId);
      if (localSkillInfo && installedSkillNamesSet.has(localSkillInfo.name)) {
        continue;  // 已安装，跳过
      }

      // 从Hub获取技能详情并下载安装
      const skillDetailResponse = await fetch(`https://sudoworkhub.sudoprivacy.com/api/skills/${skillId}`);
      // ... 下载安装技能
      installedSkillNames.push(skillName);
    }
  }

  // 4. 写入助手元数据
  const meta = {
    id: assistantMeta.id,
    name: assistantMeta.name,
    source_type: assistantMeta.tag === 'system' ? 'builtin' : 'hub',
    enabledSkills: allAssociatedSkillIds,  // 关联的技能ID列表
    // ...
  };
  await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

  return {
    success: true,
    data: {
      assistantName,
      installedVersion: version,
      installedSkills: installedSkillNames,
      failedSkills: failedSkillIds,
    },
  };
});
```

---

## 四、运行时使用

### 4.1 技能激活

创建会话时，通过 `enabledSkills` 字段激活技能：

文件：`src/common/ipcBridge.ts`

```typescript
export interface ICreateConversationParams {
  // ...
  extra: {
    // 启用的技能列表（技能ID或名称）
    enabledSkills?: string[];
    // 预设助手ID
    presetAssistantId?: string;
    // 预设上下文/规则
    presetContext?: string;
  };
}
```

### 4.2 助手关联

助手通过 `presetAssistantId` 关联到会话：

```typescript
// 创建会话时指定助手
const params: ICreateConversationParams = {
  type: 'acp',
  extra: {
    presetAssistantId: 'builtin-copilot',  // 助手ID
    presetContext: assistantMeta.context,  // 助手的规则/提示词
    enabledSkills: assistantMeta.enabledSkills,  // 助手关联的技能
  },
};
```

### 4.3 热重载机制

安装/卸载技能后，通知运行时重新加载：

文件：`src/process/bridge/skillHubBridge.ts`

```typescript
async function reloadSkillRuntime(): Promise<void> {
  // 清除缓存
  clearSkillsCache();
  AcpSkillManager.resetInstance();

  const gateway = serviceManager.getGateway();
  if (!gateway) {
    mainLog('SkillHub', 'Gateway not running, skipping reload');
    return;
  }

  // Unix: 使用 SIGUSR1 热重载（保持会话活跃）
  const canHotReload = process.platform !== 'win32' && !gateway.isInProcess();
  if (canHotReload) {
    serviceManager.sendReloadSignal();
    mainLog('SkillHub', 'Sent SIGUSR1 to gateway for hot-reload');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return;
  }

  // Windows/In-process: 需要完整重启
  mainLog('SkillHub', 'Hot-reload not supported, restarting gateway...');
  await serviceManager.restartOpenClaw();
}
```

---

## 五、关键文件总结

| 组件 | 文件路径 | 职责 |
|------|----------|------|
| 前端技能UI | `src/renderer/components/SettingsModal/contents/SkillModalContent.tsx` | 技能商店和已安装技能管理界面 |
| 前端助手UI | `src/renderer/components/SettingsModal/contents/AgentModalContent.tsx` | 助手商店和已安装助手管理界面 |
| IPC桥接定义 | `src/common/ipcBridge.ts` | 定义所有IPC接口类型 |
| 技能Hub桥接 | `src/process/bridge/skillHubBridge.ts` | 技能商店API调用和安装逻辑 |
| 助手Hub桥接 | `src/process/bridge/assistantHubBridge.ts` | 助手商店API调用和安装逻辑 |
| 技能管理器 | `src/process/SkillManager.ts` | 本地技能的CRUD操作 |
| 助手管理器 | `src/process/AssistantManager.ts` | 本地助手的CRUD操作 |
| 存储初始化 | `src/process/initStorage.ts` | 初始化技能/助手目录结构 |
| 助手存储常量 | `src/process/constants/assistantStorage.ts` | 助手元数据类型定义 |

---

## 六、数据流图

### 6.1 技能/助手发现流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户操作 (前端)                           │
│  SkillModalContent.tsx / AgentModalContent.tsx                 │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      IPC 调用 (Electron)                         │
│  skillHub.getInstalledSkills.invoke()                           │
│  assistantHub.getInstalledAssistants.invoke()                   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Bridge 层 (主进程)                           │
│  skillHubBridge.ts / assistantHubBridge.ts                      │
│  - 处理 Hub API 调用                                             │
│  - 处理安装/卸载逻辑                                              │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Manager 层 (主进程)                          │
│  SkillManager.ts / AssistantManager.ts                          │
│  - 扫描目录                                                      │
│  - 读取元数据                                                    │
│  - CRUD 操作                                                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      文件系统                                     │
│  skills/                                                         │
│  ├── _system/_builtin/     (内置技能)                            │
│  ├── _hub/                  (Hub安装技能)                        │
│  └── _my-custom-skill/      (自定义技能)                         │
│                                                                   │
│  assistants/                                                     │
│  ├── _system/              (内置助手)                             │
│  ├── _hub/                  (Hub安装助手)                        │
│  └── _my-custom-assistant/ (自定义助手)                          │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      元数据文件                                   │
│  _sudowork_meta.json (每个技能/助手目录)                          │
│  - id, name, display_name                                        │
│  - source_type, enabled                                          │
│  - installed_version, installed_at                               │
│  - enabledSkills (助手关联的技能)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 技能安装流程

```
用户点击"安装技能"
        │
        ▼
前端调用 skillHub.downloadAndInstallSkill.invoke()
        │
        ▼
后端下载 zip 文件
        │
        ▼
校验 checksum (可选)
        │
        ▼
解压到 skills/_hub/{skillName}/
        │
        ▼
写入 _sudowork_meta.json
        │
        ▼
热重载运行时 (SIGUSR1 或重启)
        │
        ▼
返回安装结果给前端
        │
        ▼
前端刷新技能列表
```

### 6.3 助手安装流程（含关联技能）

```
用户点击"安装助手"
        │
        ▼
前端显示关联技能列表供选择
        │
        ▼
用户选择要安装的关联技能
        │
        ▼
前端调用 assistantHub.downloadAndInstallAssistant.invoke()
        │
        ▼
后端下载助手 zip 文件
        │
        ▼
解压到 assistants/_hub/{assistantName}/
        │
        ├─────────────────────────────────────┐
        │                                     │
        ▼                                     ▼
写入助手 _sudowork_meta.json         安装选中的关联技能
        │                                     │
        │                                     ▼
        │                           下载技能 zip 文件
        │                                     │
        │                                     ▼
        │                           解压到 skills/_hub/{skillName}/
        │                                     │
        │                                     ▼
        │                           写入技能 _sudowork_meta.json
        │                                     │
        ├─────────────────────────────────────┤
        │                                     │
        ▼                                     ▼
热重载运行时                         热重载运行时
        │                                     │
        └──────────────────┬──────────────────┘
                           │
                           ▼
返回安装结果（助手 + 技能）给前端
                           │
                           ▼
前端刷新助手列表
```

---

## 七、扩展机制

### 7.1 Extension 贡献的技能和助手

除了本地文件系统，sudowork 还支持通过 Extension 机制贡献技能和助手：

文件：`src/common/ipcBridge.ts`

```typescript
export const extensions = {
  // 获取 Extension 贡献的技能
  getSkills: bridge.buildProvider<Array<{ name: string; description: string; location: string }>, void>('extensions.get-skills'),
  
  // 获取 Extension 贡献的助手
  getAssistants: bridge.buildProvider<Record<string, unknown>[], void>('extensions.get-assistants'),
};
```

### 7.2 企业专属技能/助手

通过 `tenantId` 参数可以获取企业专属的技能和助手：

```typescript
// 获取企业专属技能
await skillHub.fetchSkills.invoke({ tenantId: enterpriseCode });

// 获取企业专属助手
await assistantHub.fetchAssistants.invoke({ tenantId: enterpriseCode });
```

---

## 八、安全审计

### 8.1 技能安全扫描

安装技能后，系统会自动进行安全审计：

文件：`src/process/services/safety/SkillAuditScanner.ts`

```typescript
// 扫描技能目录
const report = await scanSkillDirectory(skillDir, skillName);

// 审计报告包含
interface SkillAuditReport {
  skillName: string;
  scannedAt: string;
  riskLevel: 'safe' | 'warning' | 'dangerous';
  findings: SecurityFinding[];
}
```

### 8.2 审计触发时机

1. 导入本地技能后自动扫描
2. 用户手动触发重新扫描
3. 查看已安装技能的审计报告

---

## 九、总结

sudowork 的技能和助手发现机制具有以下特点：

1. **统一目录结构**：按来源分类存储（`_system/`, `_hub/`, `_my-custom-*/`）
2. **元数据驱动**：`_sudowork_meta.json` 作为唯一数据源
3. **分层架构**：前端 UI → IPC → Bridge → Manager → 文件系统
4. **热重载支持**：Unix 系统支持 SIGUSR1 热重载，无需重启
5. **关联安装**：安装助手时可自动安装关联技能
6. **安全审计**：导入技能后自动进行安全扫描
7. **企业支持**：支持企业专属技能和助手

---

*文档生成时间：2026-05-09*
