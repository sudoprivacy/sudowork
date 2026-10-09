# Sudowork v0.2.7 macOS arm64 包体积分析

样本：`Sudowork-0.2.7-mac-arm64.dmg`（GitHub Release v0.2.7，2026-06-06 发布）。

| 指标 | 大小 |
|---|---|
| DMG（压缩） | **453.5 MB** |
| Sudowork.app（解压后） | **1.0 GB** |

DMG 用 UDZO（zlib）压缩，膨胀率约 2.2x。下面所有“大小”均按 .app 内解压后的占用统计。

---

## 一、总大小按类别拆解（.app = 1.0 GB）

| 类别 | 大小 | 占比 | 说明 |
|---|---:|---:|---|
| **app.asar**（renderer + node_modules 业务代码） | 490 MB | 47% | Vite 产物 + 全部生产依赖原始源码 |
| **Electron Framework**（Chromium + V8 + libffmpeg + ICU + locale） | 258 MB | 25% | Electron 自带，基本不可压缩 |
| **claude-code.tgz**（@anthropic-ai/claude-code 独立分发包） | 123 MB | 12% | 内含 2 份 210MB 的 arm64 SEA 二进制 |
| **app.asar.unpacked**（带原生 .node 的模块） | 66 MB | 6% | better-sqlite3、@napi-rs/canvas、@img、web-tree-sitter 等 |
| **node-darwin-arm64.tar.gz**（嵌入 Node 22.22.2 运行时） | 48 MB | 5% | 给 claude-code / mcporter / scode 用 |
| **bdpan-installer-darwin-arm64**（百度网盘安装器二进制） | 14 MB | 1% | extraResource |
| **mcporter.tgz**（MCP 工具包 + 依赖） | 12 MB | 1% | extraResource |
| **scode-macos-arm64.tar.gz**（sudoclaw 的 scode CLI） | 8.5 MB | <1% | extraResource |
| 其他（hook、icon、签名、helper apps 等） | ~3 MB | <1% | |

---

## 二、Top 10 最大文件 / 目录

| 排名 | 路径（相对 .app） | 大小 | 性质 |
|---:|---|---:|---|
| 1 | `Resources/claude-code.tgz` 内 `claude-code/bin/claude.exe` | 210 MB | **darwin-arm64 二进制，被命名为 .exe**（npm 跨平台 binstub 惯例） |
| 2 | `Resources/claude-code.tgz` 内 `claude-code-darwin-arm64/claude` | 210 MB | 与上一行**同样的 arm64 二进制**，重复一份 |
| 3 | `Frameworks/Electron Framework.framework/.../Electron Framework` | 169 MB | Chromium + V8 主体，几乎不可裁剪 |
| 4 | `Resources/app.asar` 内 `node_modules/@codemirror/*` | 47 MB | renderer-only 代码编辑库，Vite 已打入 `vendor-editor-*.js` |
| 5 | `Resources/app.asar` 内 `node_modules/googleapis/build/src/apis` | 27 MB | 292 个 Google API 自动生成的 client，整套打包 |
| 6 | `Resources/app.asar` 内 `node_modules/pptx-preview` | 27 MB | 含**嵌套** 22MB `echarts` 副本 |
| 7 | `Resources/app.asar.unpacked` 内 `@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node` | 25 MB | Skia 原生 binary，canvas 渲染必需 |
| 8 | `Resources/app.asar` 内 `node_modules/echarts` | 24 MB | renderer-only 图表库，Vite 已打入 chunks（mermaid.core/treemap 等） |
| 9 | `Resources/app.asar` 内 `node_modules/streamdown` | 24 MB | 含**嵌套** node_modules |
| 10 | `Resources/app.asar` 内 `node_modules/tiktoken/encoders` | 16 MB | cl100k/o200k 等编码表 |

补充值得点名的：
- `@arco-design/web-react` **22 MB 原始源码**，Vite 打包后只剩 740 KB（`vendor-arco-*.js`）→ **30× 重复**
- `@icon-park 22 MB`、`@office-ai 22 MB`、`pdfjs-dist 18 MB`、`@img 16 MB`、`mermaid 23 MB`、`@opentelemetry 14 MB`、`@shikijs 12 MB`、`better-sqlite3 12 MB`、`diff2html 11 MB`、`lucide-react 9.9 MB`
- Electron 框架内 ~30 MB 是 30+ 个 `*.lproj/locale.pak`（每个 1–2 MB），含繁简中、印地语、泰米尔语等全部语言；本应用只支持中英文

---

## 三、为什么这么大：必要 vs 可优化

### 不可避免（约 280 MB）
- **Electron 框架 169 MB**（V8/Blink 主体）+ ICU 10 MB + ANGLE 6.6 MB + libffmpeg 2.1 MB + Swiftshader 16 MB ≈ 220 MB。这是 Electron 应用的“地板价”
- **better-sqlite3（12 MB）、@napi-rs/canvas（25 MB）、node-pty（3 MB）、web-tree-sitter（3.8 MB）** 是真正在主进程跑、必须随包发的原生模块
- 嵌入的 **Node 22 运行时（48 MB）**：claude-code / mcporter 的 SDK 需要外置 Node 来跑（应用主进程跑 Electron 而非纯 Node）

### 可优化（≥ 350 MB）
1. **app.asar 里大量 renderer-only 包是被「打包+源码」双发**（≥ 200 MB）
   - electron-builder 默认会把 `package.json` 的 `dependencies` **整包**拷进 asar，而 electron-vite 已经把 renderer 代码（含这些库）打成 `out/renderer/assets/*.js`（合计仅 34 MB）
   - 这些库主进程根本不用：`@arco-design/web-react`、`@codemirror/*`、`echarts`、`mermaid`、`@icon-park/react`、`@shikijs/*`、`lucide-react`、`react-syntax-highlighter`、`@uiw/*`、`cytoscape`、`pdfjs-dist`、`streamdown`、`diff2html`、`react-virtuoso`、`react-markdown`、`pptx-preview`、`@monaco-editor/react`、`echarts-for-react`、`qrcode.react`、`@dnd-kit/*`、`@floating-ui/react`、`@arco-design/web-react/icon` 等
2. ~~**claude-code.tgz 内 210 MB 二进制重复一份**（~80 MB dmg 节省）~~
   - **更正（2026-06-07 复核）**：经实测，`@anthropic-ai/claude-code` 的 `install.cjs` 使用 `linkSync()` 做**硬链接**而不是 copy，平台包二进制与 `bin/claude.exe` 共享同一个 inode。`tar -czf` 默认保留 hardlink（archive 里第二份是 `h` 类型 ref，size=0），解压后 inode 仍然共享。`du -sh @anthropic-ai/claude-code 224M + claude-code-darwin-arm64 12K` 才是真实占用，**不是 420M**
   - 原报告 Top 10 第 1、2 名「两份 210 MB」是 `du -ah` 输出按文件枚举导致的视觉假象——实际整段只占 210 MB 一份
   - **没有可节省的 dmg 体积**，此条作废
3. **echarts 在 app.asar 内重复**（约 22 MB raw / ~10 MB dmg）
   - 顶层 24 MB + `pptx-preview/node_modules/echarts` 22 MB；pnpm overrides 强制统一版本即可
4. **`@img/sharp-libvips-darwin-arm64` 漏出 15 MB**（约 5 MB dmg）
   - `electron-builder.yml:88` 已写 `'!**/node_modules/@img/sharp-*/**'`，但 `sharp-libvips-*` 这个名字也匹配该模式，照理应该被排除；实际仍出现在 `app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-arm64`，说明 sharp 的 postinstall 把 libvips 复制到了另一条路径，或 `'!**'` 前缀在 `asarUnpack` 阶段被覆盖。需复核 glob 顺序
5. **30+ Electron locale.pak**（实测 ~44 MB raw / ~15-25 MB dmg；PR-A 已落地）
   - 应用只面向中英文用户，没必要带印地语/泰米尔语/越南语等
   - **实测**：v0.2.7 `Electron Framework Resources` = 63MB（含 30+ 个 `*.lproj`），加上 `_FEMININE`/`_MASCULINE`/`_NEUTER` 变体合计 220 个目录。裁剪到 `en` / `zh_CN` / `zh_TW` 三种后 Resources = 19MB
   - **配置要点**：`electronLanguages` 比对的是 `.lproj` 目录名（去后缀），必须用**下划线**形式（`zh_CN`、`zh_TW`），不是 BCP-47 dash（`zh-CN`、`zh-TW`）。后者会导致全部 locale 被删（包括中文），表现为 UI 文案 fallback 英文
6. **可拆为按需下载的 CLI 资产**（最大 ~180 MB dmg 节省，需权衡首启体验）
   - `claude-code.tgz (123 MB)` + `node-darwin-arm64.tar.gz (48 MB)` + `bdpan-installer (14 MB)` + `mcporter.tgz (12 MB)` + `scode (8.5 MB)` ≈ 205 MB
   - 这些本来就是 build 时通过 `scripts/download-*.js` 从公网拉取的现成产物，迁移到“首启动时下载到 `~/.sudowork/bin/`”是非破坏性改造

---

## 四、可落地的瘦身建议（按预期 dmg 节省排序）

> 估算以 v0.2.7 mac arm64 dmg（453 MB）为基线。Electron 部分采用 zlib 压缩比约 2x；二进制/媒体压缩比约 1.5x。

| # | 改动 | 预计 dmg 节省 | 风险 | 工作量 |
|---:|---|---:|---|---|
| **1** | **把 renderer-only 库从 `dependencies` 移到 `devDependencies`**（或在 `electron-builder.yml` 的 `files` 中显式 `'!node_modules/<pkg>/**'`）。Vite 在 `npm run package` 时已经把这些库整段编进 `out/renderer/assets/*.js`，运行期不会再 `require` 原始包 | **~120 MB** | 中：需要逐个验证主进程没有 `import 'echarts'` 之类用法（脚本：`grep -RE "from '(arco-design\|codemirror\|echarts\|mermaid\|pdfjs-dist)" src/main src/preload`） | 1–2 天 |
| **2** | **claude-code.tgz 去重**：改 `scripts/download-claude-code.js`，安装完后删掉 `@anthropic-ai/claude-code/bin/claude.exe`（保留 `cli-wrapper.cjs` + 平台包的 `claude`），或反过来删平台包二进制保留 wrapper bin | **~80 MB** | 低：需保留 npm bin 链接，把 `cli-wrapper.cjs` 指向唯一一份 | 0.5 天 |
| **3** | **改为首启动下载 CLI 资产**：`claude-code.tgz` / `mcporter.tgz` / `scode` / `bdpan-installer` / `node-darwin-arm64` 从 extraResources 挪出，启动时下载到 `~/.sudowork/bin/`，已有的 `download-*.js` 脚本可复用 | **~180 MB**（与 #2 部分重叠，实际叠加 ~100 MB） | 中：首启依赖网络；需要 checksum + 重试 + 离线回退安装包 | 3–5 天 |
| **4** | **裁剪 Electron locale.pak**：在 `electron-builder.yml` 加 `electronLanguages: [en-US, zh-CN, zh-TW]` | **~10 MB** | 极低 | 5 分钟 |
| **5** | **修复 `@img` exclude**：把 `'!**/node_modules/@img/sharp-*/**'` 改成 `'!**/node_modules/@img/**'`（或同时排除 `sharp-libvips-*`）；并用 pnpm overrides 把 `pptx-preview` 内嵌的 `echarts` 提升到顶层 | **~10 MB**（@img）+ **~10 MB**（echarts 去重） | 低 | 0.5 天 |

**累计可达**：按全部落地，dmg 从 453 MB 降到 **~150 MB** 是合理目标（Electron 地板 ~110 MB + 业务代码 ~30 MB + 必需原生模块 ~10 MB）。

---

## 五、复盘清单（顺手可做的小验证）

- [ ] `grep -RE "require\\(['\"](\\.\\./)*node_modules/" out/main out/preload` 看主进程是否真的有从原始 node_modules 路径直接 require 的依赖 → 没有的话证明 #1 安全
- [ ] 在 packaged 应用中 `console.log(require.resolve('echarts'))` 看运行期解析到 asar 内还是 renderer chunk → 确认 renderer 端用的是 Vite chunk
- [ ] 对比一个 nightly 与 v0.2.7 的 `app.asar` 大小走势，定位是哪次依赖升级 / 新增带来的体积跳变（怀疑 `@office-ai/aioncli-core 22 MB`、`tiktoken 23 MB`、`googleapis 28 MB` 是近期加入的）

---

*生成时间：2026-06-07（PR-A 落地后更新）。分析工具：`gh release view`、`hdiutil attach`、`npx @electron/asar extract`、`du -sh`、`file`。*

---

## 六、PR-A 实测结果（2026-06-07 重测）

> 在 macOS 本机（Apple Silicon）跑 `bun run build:mac:arm64` 实出 dmg，对比 v0.2.7 GitHub release。

| 指标 | v0.2.7 | PR-A 本地构建 | 净差 |
|---|---:|---:|---:|
| dmg | 453.5 MB | 383 MB | **−70.5 MB** |
| .app（解压） | 1.0 GB | 1.0 GB | ~持平 |
| app.asar | 490 MB（513,907,400 B） | 490 MB（513,907,400 B） | 0 |
| Electron Framework / Resources | 63 MB | 19 MB | **−44 MB** |
| `*.lproj` 目录数（framework） | 220 | 3（en, zh_CN, zh_TW） | −217 |
| claude-code.tgz | 123 MB | 62 MB | −61 MB（**非本 PR**） |

**−70.5 MB 的归因**（重要）：

- **#4 electronLanguages**：贡献约 **15–25 MB dmg**（Resources 砍 44MB raw，dmg 用 UDZO 压缩比约 2x）
- **claude-code.tgz 减半**：贡献约 **45–50 MB dmg**——但这**与本 PR 无关**：v0.2.7 在 GitHub Actions Linux runner 上构建时 `tar -czf` 没保留 `install.cjs` 创建的硬链接（同一 inode 的二进制在 archive 里被存两份），本机 macOS bsdtar 保留了。修复点不在本 PR，建议在 CI workflow 里强制 `GZIP=-n tar --format=ustar --hard-dereference=false` 或类似，让 Linux 构建产出和 macOS 一致的 62MB tgz
- 其他 ~0-5 MB 是 dev 自 v0.2.7 起的依赖小幅波动

**PR-A 实际声明节省（保守）：~15 MB dmg**（只算 #4，不蹭 build 环境红利）。
