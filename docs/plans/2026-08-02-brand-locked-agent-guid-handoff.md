# 交接文档：品牌锁定 Agent（Gewu）+ Guid 页助手选择 — 需求、现状与未解决问题

- 分支：`feature/gewu`
- 状态：**未完成，核心 bug 未解决**，请下一位接手者先复现问题再改，不要直接信任已有的“修复”注释
- 相关文件（改动最集中的几个）：
  - `brand.config.json`
  - `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`
  - `src/renderer/pages/guid/index.tsx`
  - `src/renderer/pages/guid/components/PromptTemplates.tsx` / `PresetAgentTag.tsx` / `GuidActionRow.tsx`
  - `src/agent/acp/AcpDetector.ts`
  - `src/common/presets/assistantPresets.ts`
  - `src/process/initStorage.ts`

## 1. 业务需求（原始诉求）

产品方向：Sudowork 要支持“垂直行业 Agent”白牌化。当前先落地一个叫 **格物（Gewu）** 的内置助手（服务国企采购方的招投标风控助手），未来还会加其他行业的 Agent。

具体要求：

1. **`brand.config.json` 新增 `defaultAgentId` 字段**（可选）：
   - 有值（如 `"gewu"`）→ Guid 页**锁定**到这个内置助手，用户无感知，不需要走"创建助手"流程，进 Guid 页默认就是这个 Agent，发消息直接以这个 Agent 的身份对话。
   - 无值 → 回退到"原来的样子"：Guid 页允许用户自己挑选 Agent（AgentPillBar + 助手选择格子都要能用）。
2. **`brand.config.json` 新增 `defaultPromptScenarios` 字段**（可选，纯字符串数组，不走 i18n）：
   - 有值 → Guid 页的"常用场景"用这里配的内容（当前格物配了4个采购场景：寻源问价/发标前体检/定标前核查/控制价测算）。
   - 无值 → 用现有的 `DEFAULT_PROMPT_CATEGORIES`（编程/写作/翻译/分析/创意/学习6大类，历史遗留功能，**不能删**）。
3. **锁定模式下的 UI 细节**：
   - 不显示 AgentPillBar（顶部backend选择条）。
   - 输入框下方的 `PresetAgentTag`（当前助手标签）**整个不展示**（不只是隐藏关闭按钮，而是整个标签都不出现），因为锁定模式下没有"退出助手"的概念。
   - 助手自己的 `assistantPrompts`（`promptsI18n`，即针对该助手的示例提示词）**不展示**——这个和 `defaultPromptScenarios`（"常用场景"）是两套不同的东西，别搞混。
   - 底部的 `AssistantSelectionArea`（助手选择格子）**不展示**。
4. **自由选择模式下**（无 `defaultAgentId`）：
   - AgentPillBar 正常显示且默认选中 Sudo Code（`scode`）。
   - 底部 `AssistantSelectionArea` 正常显示（只有当有可用 assistants 时才显示，组件内部已经有 `if (!customAgents || customAgents.length === 0) return null` 的判断，这条已确认没问题）。
5. **从 `/settings/agent` 页面点"使用"某个 hub 助手，跳转到 `/guid?assistant=xxx` 时，Guid 页应该正确显示成"已选中该助手"的状态**（助手 header、输入框预填 `defaultInitPrompt`、发消息时用这个助手的身份）。这一条**目前没有修好**，见第3节。

## 2. 已完成、且我认为验证过没问题的部分

以下这些点我用 UI 自动化工具（`observe_ui`/`act_ui`）在真实跑起来的 Electron 应用里肉眼确认过，是可信的：

- `assistant/gewu/gewu.md` 规则文件 + `ASSISTANT_PRESETS` 里注册了 `id: 'gewu'` 的 preset，`presetAgentType: 'scode'`。
- `AcpDetector.ts` 兼容旧的扁平 preset 存储格式，正确把 `builtin-gewu` 暴露到 `availableAgents` 里（这个之前有 bug，已经用单测 `tests/unit/acpDetectorCustomAgents.test.ts` 覆盖，四个 case 都过）。
- `brand.config.json` 里 `defaultAgentId: "gewu"` 时，新会话页默认展示"格物"人格，`scode` backend 生效（问"你是谁"答"我是格物…"），这个我实机验证过。
- `brand.config.json` 没有 `defaultAgentId` 时，新会话页展示 AgentPillBar（Sudo Code + Claude Code 两个 pill），这个也实机验证过。
- "常用提示词"文案改成"常用场景"，6个语言包都改了。
- 锁定模式下 `assistantPrompts`（该助手示例提示词）不展示 —— 加了 `!isLockedBrandAgent` 判断，tsc/eslint 过了，**但没有单独用 UI 工具复测这一条**，建议接手后先肉眼确认一遍。
- `PresetAgentTag` 整体隐藏（不只是关闭按钮）—— 通过 `isPresetAgent={agentSelection.isPresetAgent && !isLockedBrandAgent}` 传给 `GuidActionRow` 实现，逻辑上应该没问题，但**同样没有单独用 UI 工具复测**。
- 自由选择模式下重新解开了 `AssistantSelectionArea`（之前被注释掉的代码），`handleSelectAssistant` 回调也恢复了。

## 3. 核心未解决问题：从 `/settings/agent` 跳转过来的助手选择状态不生效

### 3.1 现象

用户在 `/settings/agent` 页面点某个 hub 已安装助手的"使用"按钮，代码会：

```ts
// src/renderer/pages/agents/index.tsx 附近
const assistantName = hubDetailAssistant.display_name || hubDetailAssistant.name;
await refreshAgentDetection();
void navigate(`/guid?assistant=${encodeURIComponent(assistantName)}`);
```

跳到 `/guid?assistant=xxx` 后，**预期**：Guid 页应该识别出这个 `assistant` 参数，把 `selectedAgentKey` 设成对应的 `custom:<hub-id>`，展示成"已选中该助手"的 header 状态（`isAssistantLandingMode = true`），并且 `assistantPrompts` 正常展示（这条助手不是格物，不受锁定模式规则约束）。

**实际现象**（用户多次反馈，最后一次是）：
- 输入框会被正确填充（说明 URL 里的助手名一度被找到并触发了 `defaultInitPrompt` 预填逻辑）；
- 但页面最终"闪烁回未指定 assistant 的状态"——AgentPillBar 显示出来了，但 Sudo Code 没有被选中（不是高亮态）；
- 也就是说：Assistant Mode 曾经短暂生效，然后又被重置回了某种"未选中"状态。

### 3.2 我已经排查/尝试过的方向（按时间顺序，供参考，不要重复走）

1. **根因分析1（已验证成立但只是部分原因）**：`useGuidAgentSelection.ts` 里有一个 effect（"Lock to brand agent or restore saved preference"），依赖 `availableAgents` 变化时会无条件把 `selectedAgentKey` 强制覆写回 `LOCKED_AGENT_KEY`（品牌锁定的 Agent，比如 `custom:builtin-gewu`）。这个 effect 内部原来有 `if (assistantFromUrl) return;` 的保护，但是这个 `return` **写在了 `LOCKED_AGENT_KEY` 分支的后面**，导致锁定分支永远先 `return` 掉，保护逻辑根本执行不到。
   - **已修**：把 `if (assistantFromUrl) return;` 挪到了这个 effect **最开头**（在 `LOCKED_AGENT_KEY` 判断之前）。
2. **根因分析2**：怀疑 `isEnterprise` 切换 effect 也会在特定情况下强制回写 `LOCKED_AGENT_KEY`。
   - **已加保护**：引入了一个 `urlPreselectedRef` ref，在 URL 预选 effect 成功匹配到助手时设为 `true`；在 `isEnterprise` 切换 effect 和主 lock effect 里都加了 `if (urlPreselectedRef.current) return;` 保护；在 `resetSelection()`（"新会话"按钮触发）里清空这个 ref。
3. **以上两处修复合并后，我自己复述了一遍完整的 effect 执行时序（见下面3.3），逻辑上应该能work，但我从未在真实跑起来的应用里用 `/settings/agent → 点使用 → 跳转` 这条真实路径复测过。** 最后一轮用户反馈"还是没解决"是在我做完根因分析2的修复之后，**但我没有再去实机验证，直接开始写这份交接文档**——这是我这轮工作最大的疏漏，请接手人第一步就做这件事。

### 3.3 我梳理出的理论执行时序（未经实机验证，可能有遗漏）

假设品牌锁定模式（`defaultAgentId = "gewu"`），从 `/settings/agent` 跳转过来：

```
T1  组件挂载，selectedAgentKey 初始值 = LOCKED_AGENT_KEY ('custom:builtin-gewu')
    assistantFromUrl = 'xxx'（URL 里的助手名）
T2  首轮 effect 跑：
    - lock effect：availableAgents 还是 undefined，直接 return
    - preselect effect：customAgents 还是空数组，直接 return
T3  availableAgents 从 SWR 加载完成
    - lock effect 重跑：if (assistantFromUrl || urlPreselectedRef.current) return  → 命中 return，不覆写 ✓
T4  customAgents 加载完成（从 fetchVisibleAssistantsAsConfigs）
    - preselect effect 重跑：按 name/id 匹配到助手 → setSelectedAgentKey('custom:<hub-id>')
                              → urlPreselectedRef.current = true
    - 重渲染：isLockedBrandAgent=false, isAssistantLandingMode=true → 应该显示 Assistant Mode ✓
T5  prefilledAssistantRef effect 跑：填充 defaultInitPrompt 到输入框 ✓（这个确实观察到了）
T6  refreshCustomAgents() 在 mount 时也会跑一次（另一个 useEffect），内部会 mutate('acp.agents.available')
    - lock effect 因 availableAgents 变化重跑：if (urlPreselectedRef.current) return → 应该跳过 ✓
    - customAgents 因此次刷新重新 setCustomAgents → preselect effect 重跑，理论上应该再次匹配到同一个助手
```

**这条链路我目前找不到还会在哪里被打断**，但用户反馈的现象说明**一定还有我没找到的第三条重置路径**，可能的方向：

- 也许 `assistantFromUrl` 在某个时机变成了 `null`（URL 被什么地方 `navigate('/guid', {replace:true})` 清掉了参数）？我检查过 `skillParam` 相关的 effect，只有 `skillParam` 存在时才会 replace URL，理论上不该影响 `assistant` 参数，但**没有实际打断点/加日志验证过**。
- 也许 `customAgents` 第二次刷新（`availableCustomAgentIds` 变化触发的那个大 `useEffect`，在 `useGuidAgentSelection.ts` 里，fetch `fetchVisibleAssistantsAsConfigs`）返回的列表里，这个 hub 助手因为可见性/ACL 判断被过滤掉了，导致 preselect effect 第二次跑的时候**找不到**这个助手（`matchedAgent` 为 `undefined`），从而没有再次调用 `setSelectedAgentKey`——但这不能解释"重置"，只能解释"没有再次设置"，如果第一次已经设置成功，key 应该还停留在 hub agent 上，除非有其他地方主动把它改回去。
- 也许 URL 参数 `assistantFromUrl`（Hub API 返回的 `display_name`）和本地 `customAgents` 里 `agent.name`（来自 `meta.nameI18n['zh-CN'] || meta.nameI18n['en-US'] || meta.display_name || ...`）**在某次刷新后不再匹配**（比如第一次用缓存数据匹配上了，`refreshAgentDetection()` 触发的重新拉取用了不同的名字来源，导致第二次匹配失败）。这个我怀疑度最高，但没有验证。

### 3.4 建议的下一步排查方法（不要再靠读代码空想，直接加断点/日志）

1. 在 `useGuidAgentSelection.ts` 的以下几处加 `console.log`（临时的，验证完记得删）：
   - preselect effect 每次执行时打印 `assistantFromUrl`、`customAgents.length`、`matchedAgent?.id`。
   - 主 lock effect 每次执行时打印 `assistantFromUrl`、`urlPreselectedRef.current`、`LOCKED_AGENT_KEY`、决定要不要 return。
   - `isEnterprise` 切换 effect 同理。
   - `setSelectedAgentKey`/`_setSelectedAgentKeyWithRef` 每次被调用时打印调用方 + 新值（可以用 `console.trace()` 定位调用栈）。
2. 用本项目已有的 UI 自动化工具（`find_roots` / `observe_ui` / `act_ui`，参考本次会话里用过的方式）跑一遍真实路径：`/settings/agent` → 点某个已安装助手 → "使用" → 观察 DevTools console 输出的完整时序，对照3.3节的理论时序找出第一个偏离点。
3. 特别注意：**必须用真实存在本地已安装的 hub 助手**测试（不是格物，格物是 builtin 不是 hub）。如果测试环境里没有装任何 hub 助手，这个路径根本走不到，会误以为"修好了"。

### 3.5 一个值得考虑的替代方案（如果继续修修不动，可以考虑换思路）

当前的实现分散在好几个 effect 里维护"谁应该覆盖谁"的优先级（URL 参数 > 品牌锁定 > 已保存偏好 > 默认值），非常容易出现"新加一个 effect 忘记加保护"的问题（这次的 bug 本质就是这个）。

更稳的做法可能是：把"决定 selectedAgentKey 应该是什么"收敛成**一个纯函数** `resolveSelectedAgentKey(candidates)`，输入是当前所有已知信号（URL 参数、品牌锁定配置、ConfigStorage 里的历史偏好、可用 agent 列表），输出唯一确定的 key，然后只用**一个** `useEffect` 去 diff 并 apply，而不是像现在这样有4-5个平行的 effect 各自维护部分优先级逻辑。这是架构级的改动，工作量不小，如果时间紧张不建议这轮就做，但如果这个 bug 反复出现或者后续还要加更多"谁优先"的规则（比如企业模式、多品牌），建议提出来讨论要不要重构。

## 4. 遗留的次要问题/待确认项（优先级低于第3节）

1. `defaultPromptScenarios`（品牌场景）目前是在 `guid/index.tsx` 里通过 `!agentSelection.isPresetAgent || isLockedBrandAgent` 控制展示；这个条件组合没有专门写单测，建议后续补一个纯函数级别的单测覆盖"锁定/自由/有无 preset agent"四种组合下 `PromptTemplates` 该不该显示、显示哪套内容。
2. `AssistantSelectionArea` 内部对 builtin 助手有硬编码隐藏（`allowedBuiltinPresets: AcpBackendConfig[] = []`），这是历史遗留代码，不属于这次改动范围，但如果未来要在自由选择模式下把格物也放进助手选择格子里，需要去掉这行硬编码。
3. `useGuidAgentSelection.ts` 现有的 `findAgentByKey` 触发的 `react-hooks/exhaustive-deps` warning（eslint）是历史遗留，不是这次改动引入的，不需要处理，但如果顺手可以清一下。
4. `src/renderer/messages/MessageLoadingIndicator.tsx` 有4条 `tsc` 报错（`React` UMD global 报错），这是分支上**别人**的未完成改动，跟这次任务无关，不要碰，也不要以为是自己改坏的。

## 5. 已知验证方式/工具备注

- 本机品牌配置文件路径：`brand.config.json`（项目根目录），改了这个文件**必须重启 Electron 主进程**才能生效（不是 HMR 能覆盖的，因为 `@brand` 是编译期静态 import，见 `electron.vite.config.ts` 里的 alias 配置）。
- 用户配置持久化在 `~/.nexus/config/sudowork-config.txt`，是 base64(urlencode(JSON)) 编码，`guid.lastSelectedAgent` 字段可以用来判断当前保存的是什么。调试时可以用如下 Python 片段读取（**只读，别手动改这个文件**）：
  ```python
  import base64, urllib.parse, json
  p = '~/.nexus/config/sudowork-config.txt'
  d = json.loads(urllib.parse.unquote(base64.b64decode(open(p).read()).decode()))
  print(d.get('guid.lastSelectedAgent'))
  ```
- UI 自动化调试：本项目内可用 `find_roots`/`observe_ui`/`search_ui`/`act_ui` 这套工具直接操作运行中的 Electron 应用做端到端验证，比读代码猜测靠谱得多，**强烈建议接手后先用这套工具复现一次问题**，而不是继续纯读代码分析。

## 6. 本轮改动的完整 diff 范围（供 review 参照）

```
brand.config.json                                          |  新增 defaultAgentId / defaultPromptScenarios
src/agent/acp/AcpDetector.ts                                |  兼容旧扁平 preset 存储格式的 agent 暴露逻辑
src/common/presets/assistantPresets.ts                      |  新增 gewu preset 定义
src/process/initStorage.ts                                  |  enabledByDefault 列表加入 gewu
src/renderer/i18n/locales/*/common.json                     |  bid 页文案改为采购方视角（招标书生成）
src/renderer/i18n/locales/*/guid.json                       |  "常用提示词" → "常用场景"
src/renderer/pages/bid/index.tsx                            |  文案/图标调整
src/renderer/pages/guid/components/GuidActionRow.tsx        |  onClosePresetTag 改为可选
src/renderer/pages/guid/components/PresetAgentTag.tsx       |  onClose 改为可选，未传时不渲染关闭按钮
src/renderer/pages/guid/components/PromptTemplates.tsx      |  支持 brand scenarios 覆盖，保留原6分类 fallback
src/renderer/pages/guid/hooks/useGuidAgentSelection.ts      |  LOCKED_AGENT_KEY 派生逻辑 + urlPreselectedRef 保护（核心，问题仍未解决）
src/renderer/pages/guid/index.tsx                           |  isLockedBrandAgent 判断 + 各 UI 区块条件展示
src/renderer/pages/guid/types/index.ts                      |  恢复 PromptCategory 类型
src/renderer/pages/guid/utils/constants.ts                  |  恢复 DEFAULT_PROMPT_CATEGORIES + 新增 BrandPromptScenario 类型
tests/unit/acpDetectorCustomAgents.test.ts                  |  新增，覆盖 AcpDetector 的 preset 暴露/去重逻辑（通过）
```

**verification 状态**：`bunx tsc --noEmit` 干净（除了分支上已有的、跟本次无关的 `MessageLoadingIndicator.tsx` 4条错误）；`bunx eslint --fix` 对本次改动的文件无 error；`bunx vitest run` 相关测试全部通过。**但这些只能保证代码能编译、类型正确，不能证明第3节描述的核心 bug 已修复** —— 这一点请接手人务必注意，不要仅凭 tsc/eslint/单测通过就认为任务完成。
