# 品牌配置

根目录的 `brand.config.json` 用于配置产品名称、Logo、打包模式和默认交互内容。修改后需要重启开发进程；正式包需要重新构建。

## 运行时品牌

Renderer 统一从 `src/renderer/stores/useTenantStore.ts` 读取租户数据。品牌展示和租户行为策略使用同一份扁平状态，并持久化为一个完整租户快照。启动时优先恢复缓存；没有合法缓存时才读取 `brand.config.json`，最后回退到内置 Sudowork 默认值。

登录后租户配置请求成功时，按字段使用“远端租户配置 > `brand.config.json` > 内置默认值”重新计算完整状态，并同时更新 Zustand 内存和缓存。远端请求失败时保持当前状态不变。普通退出登录保留品牌缓存但重置策略确认状态；显式返回模式选择时清除租户缓存。

## 一级字段

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `displayName` | `string` | 产品名称。用于页面标题、应用名称、可执行文件名、托盘提示和默认助手名称。修改后可能改变 Electron 的用户数据目录。 |
| `logo` | `string` | 默认及浅色主题 Logo，同时用于生成应用、Dock、托盘和安装器图标。支持 `data:` URL 或 HTTPS URL；设为空字符串时使用仓库内置图标。 |
| `logoDark` | `string` | 深色主题 Logo。未配置时回退到 `logo`；不影响应用、托盘和安装器的原生图标。 |
| `BUILD_OFFLINE` | `boolean` | 是否构建离线版。只有严格设置为 `true` 时，才会打包本地运行时并启用离线逻辑。 |
| `disabledFeatures` | `string[]` | 按品牌隐藏功能入口。当前支持 `shareone`，会隐藏对话分享、工作区分享、运行环境和凭据配置入口。 |
| `defaultAgentId` | `string` | Guide 页默认并锁定的内置助手技术 ID。删除该字段后恢复自由选择助手。 |
| `defaultAgentSkills` | `string[]` | 将指定 Skill 按配置顺序置顶。仅影响排序，不会安装或自动启用 Skill；未配置 `defaultAgentId` 时不生效。 |
| `defaultPromptScenarios` | `object[]` | Guide 页的品牌快捷提示词。非空时替换默认分类提示词；删除或设为空数组时使用系统默认提示词。 |
| `companyName` | `string` | 公司名称。显示在“关于”页面，并用于安装包版权和 Windows 商标信息。 |
| `tagline` | `string` | 默认登录页副标题，可被运行时租户配置覆盖。 |
| `websiteUrl` | `string` | “关于”页面中官网按钮打开的地址，建议使用完整 HTTPS URL。 |
| `privacyPolicyUrl` | `string` | “关于”页面中隐私声明按钮打开的地址，建议使用完整 HTTPS URL。 |
| `guestScode` | `object` | 可选的游客 Scode 模型配置。配置后，游客进入应用时会恢复其中的模型、Provider 和默认模型；删除后游客需自行配置模型。 |

## `defaultPromptScenarios` 子项

```json
{
  "label": "场景名称",
  "content": "点击后填入输入框的提示词",
  "icon": "📄"
}
```

- `label`：按钮名称，必填。
- `content`：写入输入框的内容，必填，不会自动发送。
- `icon`：按钮图标，可选，通常使用 Emoji。

这些内容是直接展示的文案，不使用 i18n key。

## `guestScode` 注意事项

`guestScode` 支持 Scode 的 `auth_modes`、`models`、`default_model`、`web_search` 等配置。

其中的 API Key 会进入 Renderer 安装包和本地配置，能够被提取。该字段只适合受控部署，应使用限权、限流且可轮换的凭据，不能当作安全的密钥存储。

当前 `brand.config.json` 已删除 `guestScode`，但代码仍兼容该字段。

## Logo 限制

`logo` 支持：

- Base64 等形式的 `data:` URL。
- HTTPS 图片 URL。
- 空字符串，表示使用内置图标。

原生图标生成会拒绝 HTTP、空内容、无法解析的图片、超过 10 MiB 的图片，以及超过 10 秒的下载。

## 验证

```bash
# 检查 JSON 语法
node -e "JSON.parse(require('fs').readFileSync('brand.config.json', 'utf8'))"

# 生成原生品牌资源
node scripts/generate-installer-images.js

# 运行相关测试
bunx vitest run tests/unit/branding.test.ts tests/unit/useTenantStore.dom.test.ts tests/unit/useTenantLogo.dom.test.ts tests/unit/nativeBrandAssets.test.ts

# 检查类型
bunx tsc --noEmit
```
