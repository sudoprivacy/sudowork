# 外部智能体版本与验证

管理员在 Moss 的「智能体管理 → 专属智能体 → 外部托管」接入并授权用户，审核后通过「版本与频道」发布版本、切换 stable/canary、回滚或撤销。SudoWork 桌面与 WebUI 均使用「智能体库 → 专属智能体 → 外部托管」进入统一对话，不把组织发布的智能体归到个人智能体。

新建会话时选择频道或指定版本，版本列表失败时不能提交，可点击重试。已有会话保持第一条被接受任务选定的版本；频道切换不会改变已有会话，需要新版本时新建会话。发送请求保持原幂等键直到确认接收。每条任务可按需打开「版本依据」，分别查看接收时的版本选择和远端实际执行证据。

Moss 定义语义，Stack 固定并生成，Work 消费 packages/contracts 中 exact-pinned 的 Task、Federation 和 External Provider 产物。运行下列检查可核对来源：

```sh
node scripts/check-external-contract.mjs --stack /path/to/sudostack
node scripts/check-task-contract.mjs --stack /path/to/sudostack
node --test scripts/check-external-contract.test.mjs scripts/check-task-contract.test.mjs
```

桌面 production 构建必须从源码引入三个契约，避免依赖开发机残留 dist。tests/integration/externalProviderBuild.test.ts 会主动拒绝该依赖路径并校验实际打包模块。两个端的版本查询、证据查询均通过既有鉴权 transport；用户不能传组织或任务归属。

当前仍限合成文本。独立 HTTP Provider 支持远端 revision 固定和同一 run 的查询恢复；Dify 与旧 HTTP profile 不支持这种保证。来源身份仍 unverified，版本标签也不等于完整 Nexus 身份认证。工具、附件、running cancel/callback、客户数据和生产准入不在本轮支持范围。具体迁移和部署说明由 Moss 的 docs/agent-federation-durable-provider.md 与 deploy/http-agent-provider/README.md 维护。
