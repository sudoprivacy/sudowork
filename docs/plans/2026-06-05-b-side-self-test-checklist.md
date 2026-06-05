# Sudowork B 端自测清单

**日期**: 2026-06-05
**版本**: dev (commit 5da7e353)
**用途**: B 端(企业模式)发版前功能自测,5 人分工各自认领模块完成
**单元总数**: 52

---

## 使用方法

1. 每人在"派工分配"中确认自己负责的模块
2. 完成每个测试单元后在 checkbox 打勾
3. 发现 bug 在对应单元下记录(格式: `BUG: 描述 + 复现步骤`)
4. 全部完成后在文档末尾统计区签名

---

## 派工分配

| 人 | 负责 | 单元数 | 备注 |
|---|---|---|---|
| **李松宇** | 企业认证 + 模式切换(F + I + J2/J4) | 12 | B 端核心,模式切换是新做的,**必须专人** |
| **梁燕芝** | 主对话 + Cron(A + E) | 9 | 最高频路径,A7 Preview 工作量大 |
| **吕洋洋** | 三方频道全套(C 整组) | 6 | 钉钉/飞书/企微/微信/Telegram,凭据隔离重点验 |
| **张冬冬** | Skill / MCP / Agent 配置(D 整组) | 6 | D4 企业 MCP 是 B 端独有大头 |
| **尹斌臣** | Workspace + 设置 + 系统 + 兜底(B + G + H + J1/J3) | 18 | 多为小颗粒,总量平衡 |

**最容易翻车的 3 个模块**: D4 企业 MCP / F3 OAuth2 / A7 Preview 面板,负责人多留时间。

---

## A. 主对话能力(梁燕芝 负责)

### A1 新建会话 / 首页发送 [C+B] - 小

- 入口: 侧栏「+新会话」→ GuidPage
- 文件: `src/renderer/pages/guid/GuidPage.tsx`、`src/renderer/pages/guid/hooks/useGuidSend.ts`、`src/renderer/components/sendbox.tsx`
- [ ] 正常发送文本
- [ ] 发送空消息(应被拦截)
- [ ] 超长文本自动切多行模式
- [ ] 发送后跳转到会话页

### A2 @ mention Agent 选择 [C+B] - 小

- 入口: GuidPage 输入框输入 `@`
- 文件: `MentionDropdown.tsx`、`useGuidMention.ts`
- [ ] `@` 展开 Agent 列表
- [ ] 选择 Agent 后 badge 显示
- [ ] 移除 badge
- [ ] B 端只显示远程 Agent

### A3 会话对话页(发送/接收/中断) [C+B] - 中

- 入口: 点击历史会话
- 文件: `AcpChat.tsx`、`AcpSendBox.tsx`
- [ ] 正常对话往返
- [ ] 点中断按钮停止流式
- [ ] 长对话滚动正常
- [ ] Markdown 渲染(代码块/表格/链接)

### A4 会话历史 / 批量管理 [C+B] - 小

- 入口: 侧栏对话列表 / ListCheckbox 按钮
- 文件: `WorkspaceGroupedHistory.tsx`、`grouped-history/index.tsx`
- [ ] 查看历史分组(按时间)
- [ ] 批量删除
- [ ] 拖拽排序
- [ ] 时间线 / 定时任务 Tab 切换

### A5 Remote Agent 模式 [B 端独有] - 中

- 入口: GuidPage AgentPillBar → 切到远程模式
- 文件: `useGuidAgentSelection.ts`、`AgentPillBar.tsx`
- [ ] B 端默认选远程 Agent
- [ ] 切 local/remote 切换
- [ ] 远程 Agent 列表来自 Moss Server
- [ ] local 模式不可用时灰显

### A6 命令面板 [C+B] - 小

- 入口: 快捷键(全局)
- 文件: `CommandPalette.tsx`、`useCommandPalette.ts`
- [ ] 唤起命令面板
- [ ] 搜索命令
- [ ] 执行跳转
- [ ] Tab 切换侧栏 timeline/scheduled

### A7 Preview 面板 [C+B] - **大**

- 入口: 对话页右侧展开
- 文件: `PreviewPanel.tsx`
- [ ] 代码预览
- [ ] HTML 预览
- [ ] Markdown 预览
- [ ] PDF 预览
- [ ] Excel 预览
- [ ] PPT 预览
- [ ] 图片预览
- [ ] 音视频预览
- [ ] 编辑保存
- [ ] 分屏
- [ ] 版本历史
- [ ] 下载

---

## B. Workspace & 文件(尹斌臣 负责)

### B1 Workspace 文件树 [C+B] - 中

- 入口: 会话页侧边栏 WorkspaceCollapse
- 文件: `workspace/index.tsx`、`useWorkspaceFileOps.ts`
- [ ] 展开文件树
- [ ] 新建/重命名/删除文件
- [ ] 拖拽导入
- [ ] 粘贴上传

### B2 百度网盘集成(bdpan) [C+B] - 中

- 入口: GuidPage 附件按钮 → bdpan / Workspace 右键 → 上传到网盘
- 文件: `BdpanDirPicker/index.tsx`、`GuidActionRow.tsx`
- [ ] 授权登录网盘
- [ ] 选目录
- [ ] 上传 / 下载文件
- [ ] whoami 检查已登录状态

---

## C. Channels 三方频道(吕洋洋 负责)

### C1 钉钉 Channel [C+B] - 中

- 入口: 设置 → Channels → 钉钉
- 文件: `DingTalkPlugin.ts`、`DingTalkConfigForm.tsx`
- [ ] 填写凭据保存
- [ ] 启停服务
- [ ] 群消息接收并响应
- [ ] **B 端凭据存 Moss Server(不存本地 nexus)**

### C2 飞书 Channel [C+B] - 中

- 入口: 设置 → Channels → 飞书
- 文件: `LarkPlugin.ts`、`LarkConfigForm.tsx`
- [ ] 凭据保存
- [ ] 启停
- [ ] Lark 卡片消息
- [ ] B 端凭据路径正确

### C3 企业微信 Channel [C+B] - 中

- 入口: 设置 → Channels → 企业微信
- 文件: `WeComPlugin.ts`、`WeComConfigForm.tsx`
- [ ] 凭据保存
- [ ] 加解密
- [ ] 文件上传(WeComUploader)
- [ ] B 端凭据路径正确

### C4 微信 Channel [C+B] - 中

- 入口: 设置 → Channels → 微信
- 文件: `WeChatPlugin.ts`、`WeChatConfigForm.tsx`
- [ ] 填写凭据
- [ ] 消息加解密
- [ ] context token 持久化
- [ ] B 端凭据路径正确

### C5 Telegram Channel [C+B] - 中---skip

- 入口: 设置 → Channels → Telegram
- 文件: `TelegramPlugin.ts`、`TelegramConfigForm.tsx`
- [ ] Bot token 配置
- [ ] 启动
- [ ] 收发消息
- [ ] inline keyboard

### C6 禅道 Channel - 小

- 入口: 设置 → 安全 → 秘钥 → 禅道
- 文件: `ZentaoPlugin.ts`、`ZentaoConfigForm.tsx`
- [ ] B 端确认看不到此项
- [ ] B 端直接访问路由被屏蔽

---

## D. Skill / MCP / Agent 配置(张冬冬 负责)

### D1 Skill 商店(个人) [C+B] - 中

- 入口: 侧栏 → Skill 图标 / 设置 → Skill
- 文件: `SkillModalContent.tsx`
- [ ] 搜索安装 Skill
- [ ] 启用/禁用
- [ ] 卸载
- [ ] B 端跳过 SkillHub API

### D2 Skill 企业专属发布(审核) [B 端独有] - 中

- 入口: 设置 → Skill → 企业专属 Tab
- 文件: `SkillModalContent.tsx:577+`
- [ ] 上传 Skill
- [ ] 待审核状态
- [ ] 已发布状态流转
- [ ] 租户 Skill 列表同步

### D3 MCP 服务管理(个人) [C+B] - 中

- 入口: 设置 → MCP(C 端)/ 侧栏安全
- 文件: `McpManagement/index.tsx`
- [ ] 添加 MCP Server
- [ ] 启动/停止
- [ ] 查看 Tools 列表

### D4 企业 MCP 管理 [B 端独有] - **大**

- 入口: 设置 → MCP 服务
- 文件: `EnterpriseMcpSettings/index.tsx`、`EnterpriseMcpTab.tsx`、`PolicyTab.tsx`
- [ ] 企业 MCP 列表加载
- [ ] 从模板安装
- [ ] 编辑配置
- [ ] MCP 策略(allow_enterprise_*)
- [ ] 管理员重定向 Banner
- [ ] SSE 事件实时刷新

### D5 自定义 ACP Agent [C+B] - 中

- 入口: 设置 → Agent → 自定义
- 文件: `CustomAcpAgent/index.tsx`、`CustomAcpAgentModal.tsx`
- [ ] 创建自定义 Agent
- [ ] 编辑自定义 Agent
- [ ] B 端"发布审核"按钮显示

### D6 Agent 设置页 [C+B] - 中

- 入口: 设置 → Agent
- 文件: `AgentModalContent.tsx`
- [ ] C 端: store/installed/custom tabs
- [ ] **B 端额外: exclusive tab**
- [ ] 上传/复制
- [ ] B 端 Hub 调用屏蔽

---

## E. Cron 定时任务(梁燕芝 负责)

### E1 Cron 任务列表 / 管理 [C+B] - 中

- 入口: 侧栏 → 定时任务 Tab / 侧栏 → Cron 图标 → Cron 设置
- 文件: `CronJobManager.tsx`、`useCronJobs.ts`
- [ ] 新建 Cron
- [ ] 编辑 Cron
- [ ] 删除 Cron
- [ ] 立即执行
- [ ] 查看执行历史
- [ ] B 端远程 session 触发刷新

### E2 会话消息 Cron 徽标 [C+B] - 小

- 入口: 对话页消息气泡
- 文件: `MessageCronBadge.tsx`
- [ ] 定时触发的消息有 Cron 来源标记

---

## F. 企业登录与认证(李松宇 负责)—— B 端独有

### F1 企业 Server 配置与验证 [B] - 小

- 入口: 首次启动 ModeSetup → 企业模式
- 文件: `ModeSetup.tsx`、`eeclawMode.ts`
- [ ] 输入有效 server URL → 验证连接 → 保存 tenantName
- [ ] URL 格式非法提示
- [ ] 无法连接提示

### F2 密码登录 [B] - 小

- 入口: 登录页 Tab: 密码
- 文件: `login/index.tsx`、`pwdLoginBridge.ts`
- [ ] 正常登录
- [ ] 密码错误提示
- [ ] 网络断开提示
- [ ] 登录成功跳 GuidPage

### F3 OAuth2 / OIDC 登录 [B] - **中,易翻车**

- 入口: 登录页 Tab: OAuth2
- 文件: `login/index.tsx`、`authBridge.ts`
- [ ] 管理员未启用时灰显
- [ ] 点击跳浏览器
- [ ] 回调 deep link 解析
- [ ] state 校验
- [ ] 等待中 loading 状态

### F4 Token 静默刷新 [B] - 中

- 入口: 后台自动(AuthContext)
- 文件: `AuthContext.tsx`、`eeclawBridge.ts`
- [ ] Access token 快过期时自动刷新
- [ ] refresh token 失效后跳回登录
- [ ] 主进程广播 tokenRefreshed

### F5 白标 / TenantConfig 拉取 [B] - 小

- 入口: 启动时 / 登录后
- 文件: `TenantConfigContext.tsx`
- [ ] 企业 logo/名称/login_desp 正确显示
- [ ] 切换 server URL 后刷新
- [ ] 本地缓存版本兜底

### F6 退出登录(企业) [B] - 小

- 入口: 侧栏用户 avatar 下拉 → 退出登录
- 文件: `sider.tsx`、`AuthContext.tsx`
- [ ] 退出清除 token
- [ ] 跳回企业登录页
- [ ] 清理 sudocode.json 和 sessionMode

### F7 企业凭据管理(Secrets) [B] - 中

- 入口: 设置 → 安全 → 企业凭据 Section
- 文件: `EnterpriseSecretSection.tsx`、`useTenantConfigItems.ts`
- [ ] 加载 TenantConfig 定义的凭据项
- [ ] 填写保存到 Moss Server
- [ ] 启用/禁用
- [ ] token 过期重试

---

## G. 设置 / 白标 / 主题 / 用户面板(尹斌臣 负责)

### G1 个人资料页 [C+B] - 小

- 入口: 设置 → 个人资料
- 文件: `UserProfile.tsx`
- [ ] B 端显示用户名/角色/token 用量/会话数
- [ ] C 端显示手机号/积分

### G2 企业设置(Server URL 变更) [B] - 小

- 入口: 设置 → 企业设置
- 文件: `EnterpriseSettings.tsx`
- [ ] 编辑 Server URL → 验证 → 保存
- [ ] 连接状态 checking/connected/disconnected
- [ ] 改完触发重新登录

### G3 显示设置(主题/语言) [C+B] - 小

- 入口: 设置 → 显示
- 文件: `DisplaySettings.tsx`
- [ ] 切深色/浅色/系统主题
- [ ] 切语言(zh/en)
- [ ] CSS 自定义主题

### G4 模型配置(C 端独有,B 端验) [C 端] - 小

- 入口: 设置 → 模型(C 端)
- [ ] B 端设置侧栏**不含**此项
- [ ] B 端访问 `/settings/model` **被拦截**

### G5 工具设置(C 端独有) [C 端] - 小

- [ ] B 端不在菜单中
- [ ] B 端访问对应路由被拦截

### G6 系统设置 [C+B] - 小

- 入口: 设置 → 系统
- 文件: `SystemModalContent.tsx`
- [ ] B 端**隐藏**产品体验改进开关
- [ ] 两端均有: 关闭到托盘、提示超时、空闲超时配置

### G7 Runtime 设置(Node/Python,C 端独有) [C 端] - 小

- [ ] B 端不在菜单中
- [ ] B 端访问被拦截

### G8 WebUI 设置(C 端独有) [C 端] - 小

- [ ] B 端侧栏不展示 WebUI 入口
- [ ] B 端访问被屏蔽

### G9 关于页 / 版本展示 [C+B] - 小

- 入口: 设置 → 关于
- 文件: `About.tsx`
- [ ] 版本号正确显示
- [ ] 检查更新按钮可用

### G10 充值中心 / 积分(C 端独有) [C 端] - 小

- [ ] B 端菜单中无此项
- [ ] B 端路由访问被重定向

---

## H. 系统级与生命周期(尹斌臣 负责)

### H1 系统托盘 [C+B] - 小

- 入口: 关闭窗口后托盘常驻
- 文件: `src/index.ts` (createOrUpdateTray)
- [ ] 关闭窗口 → 托盘存在
- [ ] 右键菜单显示
- [ ] 点击唤起窗口
- [ ] 退出彻底关闭

### H2 自动更新 [C+B] - 中

- 入口: 后台自动 / 关于页 → 检查更新
- 文件: `autoUpdaterService.ts`、`updateBridge.ts`
- [ ] 启动时检测更新
- [ ] 有新版本弹提示
- [ ] 下载进度
- [ ] 重启安装

### H3 Agent 运行时启停(ACP Gateway) [C+B] - 中

- 入口: 设置 → Runtime / 会话页 AgentStatusBanner
- 文件: `AgentStatusBanner.tsx`、`InitLoading.tsx`
- [ ] 启动时 InitLoading 各步骤(git/node/claude/scode/nexus/bdpan)
- [ ] gateway 断开 Banner 提示
- [ ] 重连

### H4 渲染进程 Crash Handler [C+B] - 中

- 入口: 任何 JS 异常
- 文件: `crashHandler.ts`、`ErrorBoundary.tsx`
- [ ] 故意抛异常触发 ErrorBoundary
- [ ] crashReportException IPC 上报
- [ ] 面包屑记录

---

## I. 切换模式 C↔B(李松宇 负责)—— **新功能,0 容忍**

> 必须在**全新装机的干净环境**测,不能用已有配置复测。

### I1 首次启动 ModeSetup 引导 [C+B] - 中

- 入口: 全新安装 / appMode 为 null
- 文件: `ModeSetup.tsx`、`useAppMode.ts`
- [ ] 选消费者 → C 端服务启动 → 正常进入
- [ ] 选企业 → 输入 URL → 验证 → B 端进入
- [ ] 选企业但 URL 无效报错
- [ ] **老用户升级不再弹**(auto-set 'c')

### I2 B 端"返回模式选择" [B] - 小

- 入口: B 端登录页左上角返回按钮
- 文件: `login/index.tsx` (handleBackToModeSelect)
- [ ] 点击 → 清除所有企业 Storage → reload → 重新显示 ModeSetup
- [ ] 确认 C 端 auth 也被清除
- [ ] 已登录态无法直接访问

### I3 企业 Server URL 变更后重新登录 [B] - 小

- 入口: 设置 → 企业设置 → 修改 URL
- 文件: `EnterpriseSettings.tsx`
- [ ] 验证新 URL
- [ ] 保存成功 → 触发 logout → 跳企业登录页
- [ ] 连接失败不保存

---

## J. 兜底与异常

### J1 网络断开场景(尹斌臣 负责) [C+B] - 中

- 入口: 断网后操作
- 文件: `AuthContext.tsx` (network_error 分支)、`AgentStatusBanner.tsx`
- [ ] 断网登录提示"连接企业服务器失败"
- [ ] 会话页 gateway 断开 Banner
- [ ] 重连后恢复

### J2 Token 过期 / 强制重登(李松宇 负责) [B] - 中

- 入口: access + refresh token 均失效
- 文件: `AuthContext.tsx` (refreshTokens 失败路径)
- [ ] 模拟 refresh 失败 → 跳回登录页
- [ ] 登录页 Tab 默认正确
- [ ] 不出现空白/无限 loading

### J3 子进程崩溃 / Gateway 无响应(尹斌臣 负责) [C+B] - 中

- 入口: ACP 子进程异常退出
- 文件: `AgentStatusBanner.tsx`、`healthMonitorBridge.ts`
- [ ] Gateway crash → Banner 变红/断开
- [ ] 重启 Gateway 恢复连接
- [ ] 不影响历史会话查看

### J4 版本升级数据迁移(李松宇 负责) [C+B] - 小

- 入口: 老版本 → 新版本首次启动
- 文件: `migrationUtils.ts`、`useAppMode.ts` (upgrade path)
- [ ] 有 sudowork_auth_v2 但无 appMode → 自动 set 'c'
- [ ] 不弹 ModeSetup
- [ ] 原会话历史保留

---

## 测试环境要求

| 环境 | 用途 | 必须 |
|---|---|---|
| 全新装机 macOS | I 模式切换、F1 首次配置 | ✓ |
| 全新装机 Windows | 跨平台兼容性 | ✓ |
| 已有 0.2.4 用户升级 | J4 / I1 老用户路径 | ✓ |
| 断网环境 | J1 网络异常 | ✓ |
| 企业 Server(test 实例) | F1-F7 全链路 | ✓ |
| 各 channel 测试群/账号 | C1-C5 | ✓ |

---

## 完成统计

| 负责人 | 单元数 | 已完成 | 发现 bug 数 | 备注 |
|---|---|---|---|---|
| 李松宇 | 12 | 0 | 0 | |
| 梁燕芝 | 9 | 0 | 0 | |
| 吕洋洋 | 6 | 0 | 0 | |
| 张冬冬 | 6 | 0 | 0 | |
| 尹斌臣 | 19 | 0 | 0 | |
| **总计** | **52** | **0** | **0** | |

---

## Bug 汇总区

> 各负责人在完成测试时,把发现的 bug 集中记在这里,格式: `[单元号] 描述 / 复现步骤 / 严重程度(P0-吕洋洋)`

(待填)
