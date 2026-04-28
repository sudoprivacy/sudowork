# Channel Info Skill 设计文档

> 创建日期: 2026-04-13
> 状态: 已批准

---

## 1. 背景

用户通过对话框（远程 IM 或本地桌面）询问渠道配置情况时，大模型无法返回数据库中存储的渠道配置信息。需要提供一种机制让 Agent 获取渠道状态信息。

## 2. 需求

- **场景**: 本地桌面用户和远程 IM 用户都需要支持
- **内容**: 用户询问哪个渠道就返回那个渠道的配置信息和状态
- **安全**: 排除敏感信息（token、secret 等凭据）

## 3. 方案选型

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| MCP Tool | 按需调用、实时准确 | 需要额外层 | 未采用 |
| Function Calling | 与 Agent 集成 | 后端差异 | 未采用 |
| 上下文注入 | 简单 | 信息过时、token消耗 | 未采用 |
| **Skill** | 符合项目架构、统一管理 | 需创建新skill | **已采用** |

## 4. 设计细节

### 4.1 Skill 元数据

```json
{
  "id": "channel-info-skill",
  "name": "channel-info",
  "display_name": "渠道信息",
  "description": "获取 Channel 渠道配置信息 - 查询 Telegram、飞书、钉钉、微信等渠道的启用状态和运行状态",
  "emoji": "📡",
  "categories": ["系统管理"],
  "is_builtin": true
}
```

### 4.2 返回信息格式

**返回字段**（排除敏感凭据）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 渠道类型 (telegram/lark/dingtalk/wechat) |
| `name` | string | 渠道名称 |
| `enabled` | boolean | 是否已启用 |
| `connected` | boolean | 是否已连接 |
| `status` | string | 运行状态 (running/stopped/error) |
| `lastConnected` | string \| null | 最后连接时间 (ISO格式) |
| `hasToken` | boolean | 是否已配置凭据 |

**排除字段**:
- `token` (Telegram Bot Token)
- `appSecret` (飞书/钉钉应用密钥)
- `clientId/clientSecret` (钉钉凭据)
- 任何凭据相关的具体值

### 4.3 函数定义

```typescript
interface ChannelInfo {
  type: string;
  name: string;
  enabled: boolean;
  connected: boolean;
  status: string;
  lastConnected: string | null;
  hasToken: boolean;
}

interface ChannelInfoResult {
  success: boolean;
  channels?: ChannelInfo[];
  error?: string;
}

/**
 * 获取渠道配置信息
 * @param channelType 可选的渠道类型，不传则返回所有渠道
 * @returns 渠道配置信息（排除敏感凭据）
 */
function getChannelInfo(channelType?: string): Promise<ChannelInfoResult>;
```

### 4.4 使用示例

**用户询问 WeChat 渠道**:

```
用户: 当前 WeChat 渠道的配置情况怎么样？

Agent: [调用 getChannelInfo("wechat")]

Agent 回答:
📡 WeChat 渠道状态:
- 名称: WeChat
- 启用状态: ✅ 已启用
- 连接状态: ✅ 正常连接
- 运行状态: running
- 凭据配置: ✅ 已配置
- 最后连接: 2026-04-13T10:30:00Z
```

**用户询问所有渠道**:

```
用户: 目前有哪些渠道已经配置好了？

Agent: [调用 getChannelInfo()]

Agent 回答:
📡 当前已配置的渠道列表:

1. Telegram
   - 启用状态: ✅ 已启用
   - 连接状态: ✅ 正常连接
   
2. Lark (飞书)
   - 启用状态: ✅ 已启用
   - 连接状态: ❌ 未连接
   
3. WeChat
   - 启用状态: ❌ 未启用
   - 凭据配置: ⚠️ 未配置凭据
```

## 5. 文件结构

```
skills/channel-info/
├── _sudowork_meta.json    # Skill 元数据
├── scripts/
│   └── index.ts           # 主逻辑实现
├── icon.svg               # Skill 图标
└── skill.md               # Skill 说明文档
```

## 6. 实现要点

1. **IPC 调用**: 通过现有的 `ipcBridge.channel.getPluginStatus` 获取插件状态
2. **信息过滤**: 在 Skill 层面过滤敏感凭据，确保安全性
3. **格式化输出**: 返回结构化数据，由 Agent 格式化为用户友好的回复
4. **错误处理**: 处理 IPC 调用失败的情况

## 7. 扩展考虑

- 未来可扩展支持更多渠道管理操作（启用/禁用渠道）
- 可添加配置验证功能
- 可添加活跃用户数统计

---

## 审批记录

- **日期**: 2026-04-13
- **审批人**: 用户
- **状态**: 已批准