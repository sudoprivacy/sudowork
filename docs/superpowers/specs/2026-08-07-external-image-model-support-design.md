# 外部图像生成模型支持设计方案

**日期**: 2026-08-07  
**审阅更新**: 2026-08-10  
**状态**: 可实施  
**范围**: 模型设置能力标注、Tools 图像模型下拉、运行期凭证解析、scode skill 生图链路

---

## 背景与目标

### 现状

- 「Tools 设置 → 图像模型」下拉的选项来源仅限 sudorouter 的 `/api/specific_image_pricing` 接口。
- 图像生成运行期默认把用户选择的模型路由到 sudorouter，`resolveImageConfig()` 不会解析用户在 `sudocode.json` 里配置的 `auth_modes.api-key.<providerId>`。
- 用户在「模型设置」里添加的外部图片模型（如 OpenAI-compatible FLUX、DALL-E、Imagen 代理等）无法出现在图像模型下拉里，也无法用自己的 `baseUrl/apiKey` 调用。
- AddModelDialog 高级配置只有「工具调用 / 图片输入 / 推理模式」三个勾选框，没有「图片生成」能力标注。
- 运行期还有两个容易覆盖用户选择的同步入口：`resolveImageModelForMainSync()` 和 `ServiceManager.syncImageModelToSudoclaw()`。

### 目标

用户在「模型设置」添加外部图片模型后，可在「Tools → 图像模型」下拉里选到它，并且以下路径都真正走该模型自己的 `baseUrl/apiKey`：

- 对话内工具触发的图像生成。
- scode agent 调用 `image-generation` skill 触发的图像生成。
- 用户头像生成等复用图像生成配置的入口。

### 明确支持范围

- 支持外部 provider 暴露的 OpenAI-compatible `/images/generations` 与 `/images/edits`。
- 支持 Gemini 图片模型的 `generateContent` 分支，识别逻辑继续基于模型名。
- 不承诺支持每个厂商的原生非兼容图片 API。若某 provider 不是 OpenAI-compatible 或 Gemini-compatible，需要后续单独增加协议适配。

---

## 核心修正

原方案主线可行，但必须修正四个假设：

1. **不能用 `split('/', 2)` 解析外部模型。**  
   当前自定义模型 alias 已经是 `providerId/modelId`，而真实模型 ID 也可能包含 `/`，例如 `custom/black-forest-labs/FLUX.1-schnell`。解析时必须只切第一个 `/`，把后续完整保留为模型 ID。

2. **不能只改 Tools 页。**  
   `resolveImageModelForMainSync()` 会在启动和 sudoclaw 同步时用 sudorouter pricing 校验并修复失效模型。外部模型若不参与校验，会被误修成 sudorouter 默认模型。

3. **`resolveImageConfig()` 不是唯一入口。**  
   主生图路径和 scode env 注入走 `resolveImageConfig()`，但 `generateUserAvatar()` 目前直接读 sudorouter 凭证，需要改成复用 `resolveImageConfig()`。

4. **scode skill 不能继续只依赖 `.sh`。**  
   Windows/PowerShell 环境下 `generate_image.sh` 不可用。项目已新增 `skills/image-generation/scripts/generate_image.py`，方案应以 Python 入口为默认，`.sh` 作为 Unix fallback。

---

## 数据模型

### ScodeModelEntry 新增字段

文件: `src/common/ipcBridge.ts`

```typescript
export type ScodeModelEntry = {
  alias?: string;
  name?: string;
  input?: string[];
  supports_tools?: boolean;
  supports_reasoning?: boolean;
  supports_image_generation?: boolean;
  // ...
};
```

字段语义：

- `supports_image_generation: true` 表示用户明确标注该模型可用于图片生成。
- 该字段与 `supports_tools`、`supports_reasoning` 并列，写入 `sudocode.json` 的 `models.<alias>` 条目。
- 该字段也要保存在 `ScodeCustomModelProvider.models[]` 中，因为自定义模型会被序列化到 SQLite 的 `scode_custom_model_providers.models` JSON 字段。

### 图像模型选择值

`tools.imageGenerationModel` 的结构不变，继续使用：

```typescript
{ switch: boolean; useModel: string }
```

`useModel` 的值域扩展：

| 类型 | 示例 | 凭证来源 |
|---|---|---|
| sudorouter 图片模型 | `gemini-3.1-flash-image` | `auth_modes.proxy.sudorouter` |
| 外部图片模型 | `custom-openai/flux-1` | `auth_modes.api-key.custom-openai` |
| 外部 namespaced 图片模型 | `custom/black-forest-labs/FLUX.1-schnell` | `auth_modes.api-key.custom` |

外部值格式固定为：

```text
<providerId>/<providerModelId>
```

解析规则：

```typescript
export function parseCustomImageModelRef(value: string): { providerId: string; modelId: string } | null {
  const index = value.indexOf('/');
  if (index <= 0 || index === value.length - 1) return null;
  return {
    providerId: value.slice(0, index),
    modelId: value.slice(index + 1),
  };
}
```

不要使用 `split('/', 2)`，因为它会截断模型名中的后续 `/`。

---

## 公共能力函数

建议新增或放入 `src/common/scodeConfig.ts`：

```typescript
export const IMAGE_GENERATION_MODEL_PATTERN = /flux|diffusion|dall|imagen|cogview|janus|midjourney|mj-|stabilityai|sd-/i;

export type ScodeImageModelOption = {
  label: string;
  value: string;
  providerId: string;
  modelId: string;
};

export function buildCustomImageModelValue(providerId: string, modelId: string): string {
  return `${providerId.trim()}/${modelId.trim()}`;
}

export function parseCustomImageModelRef(value: string): { providerId: string; modelId: string } | null {
  const index = value.indexOf('/');
  if (index <= 0 || index === value.length - 1) return null;
  return { providerId: value.slice(0, index), modelId: value.slice(index + 1) };
}

export function extractImageModelsFromScodeConfig(config: ScodeConfig | null | undefined): ScodeImageModelOption[] {
  const result: ScodeImageModelOption[] = [];
  const apiKeyProviders = config?.auth_modes?.['api-key'] || {};

  for (const [alias, entry] of Object.entries(config?.models || {})) {
    const apiKeyProvider = entry.providers?.['api-key'];
    const providerId = apiKeyProvider?.provider?.trim();
    if (!providerId || !apiKeyProviders[providerId]) continue;

    const modelId = (apiKeyProvider?.model || entry.alias || alias).trim();
    if (!modelId) continue;

    const isImageModel =
      entry.supports_image_generation === true ||
      IMAGE_GENERATION_MODEL_PATTERN.test(modelId);

    if (!isImageModel) continue;

    result.push({
      label: `${providerId} / ${modelId}`,
      value: buildCustomImageModelValue(providerId, modelId),
      providerId,
      modelId,
    });
  }

  return result.sort((a, b) => a.label.localeCompare(b.label));
}
```

Renderer 和 Main 都复用这组函数，避免 UI 校验和启动同步用两套规则。

---

## 改动点

### 1. 模型添加/编辑页增加「图片生成」能力

文件：

- `src/renderer/pages/settings/models/components/AddModelDialog.tsx`
- `src/renderer/pages/settings/models/utils/index.ts`
- `src/renderer/pages/settings/models/index.tsx`
- `src/common/scodeConfig.ts`
- `src/common/ipcBridge.ts`
- `src/renderer/i18n/locales/*.json`

改动：

- `IAddModelFormValues` 增加 `supportsImageGeneration?: boolean`。
- `ScodeCustomModelProvider.models[]` 增加 `supportsImageGeneration?: boolean`。
- `ScodeModelEntry` 增加 `supports_image_generation?: boolean`。
- `buildEditableModelFromFormValues()` 把表单字段写入 `supportsImageGeneration`。
- `buildCustomApiKeyModelEntry()` 把 `supportsImageGeneration` 写入 `supports_image_generation`。
- `modelFromCustomApiKeyEntry()` 和 `editableModelFromEntry()` 要反向读出该字段，保证编辑时不丢。
- 模型列表页可增加一个「图片生成」Tag，方便用户确认配置。
- 勾选项必须明确提示当前支持的生图协议，避免用户误以为任意原生图片 API 都可调用。

UI：

```tsx
<Form.Item
  field='supportsImageGeneration'
  triggerPropName='checked'
  extra={t(
    'settings.sudocodeModel.supportsImageGenerationExtra',
    '仅支持 OpenAI 兼容图片接口 /images/generations、/images/edits，以及 Gemini generateContent 图片输出。若服务商使用其他原生接口，即使模型支持生图也可能无法调用。'
  )}
>
  <Checkbox>{t('settings.sudocodeModel.supportsImageGeneration', '图片生成')}</Checkbox>
</Form.Item>
```

预填规则：

- 新建模型默认不勾选。
- 编辑已有模型时，如果 `entry.supports_image_generation === true`，勾选。
- 如果没有显式字段，但模型名命中 `IMAGE_GENERATION_MODEL_PATTERN`，也预填为勾选，方便老配置升级。

布局注意：

- 高级配置从 3 个勾选框变为 4 个，桌面可用 `md:grid-cols-4` 或保持自动换行。
- `extra` 文案会让该项高度大于其他 Checkbox，建议高级配置不要强制等高卡片；保持表单自然换行即可。

交互文案：

| i18n key | zh-CN | en-US |
|---|---|---|
| `settings.sudocodeModel.supportsImageGeneration` | 图片生成 | Image generation |
| `settings.sudocodeModel.supportsImageGenerationExtra` | 仅支持 OpenAI 兼容图片接口 `/images/generations`、`/images/edits`，以及 Gemini `generateContent` 图片输出。若服务商使用其他原生接口，即使模型支持生图也可能无法调用。 | Supports only OpenAI-compatible image endpoints `/images/generations`, `/images/edits`, and Gemini `generateContent` image output. Providers with other native image APIs may not work even if the model can generate images. |

勾选语义：

- 勾选「图片生成」只是能力标注，表示该模型允许进入 Tools 的图像模型候选列表。
- 勾选不代表 Sudowork 已经验证该模型可调用。
- 真正的兼容性以“测试图片生成”或实际生图请求结果为准。

可选增强：增加“测试图片生成”按钮。

```tsx
<Button size='mini' onClick={onTestImageGeneration}>
  {t('settings.sudocodeModel.testImageGeneration', '测试图片生成')}
</Button>
```

测试提示：

```typescript
t(
  'settings.sudocodeModel.testImageGenerationCostHint',
  '测试会向当前服务商发送一次真实图片生成请求，可能产生费用。'
)
```

测试成功后自动勾选 `supportsImageGeneration`；测试失败时不勾选，并展示接口错误摘要。

### 2. Tools 图像模型下拉合并外部模型

文件：

- `src/renderer/pages/settings/tools/index.tsx`
- `src/common/scodeConfig.ts`
- `src/common/imageGenerationModelConfig.ts`

现有 IPC 已可用：

```typescript
const scodeConfigRes = await scode.getConfig.invoke();
```

不需要新增 `scode.getScodeConfig`。

加载逻辑：

```typescript
const [pricingResult, scodeConfigResult] = await Promise.all([
  scode.fetchSpecificImagePricing.invoke().catch(() => null),
  scode.getConfig.invoke().catch(() => null),
]);

const sudorouterOptions = pricingResult?.success && Array.isArray(pricingResult.data)
  ? pricingResult.data.map((item) => ({ label: item.model_id, value: item.model_id }))
  : [];

const customOptions = extractImageModelsFromScodeConfig(
  scodeConfigResult?.success ? scodeConfigResult.data : null
).map((item) => ({ label: item.label, value: item.value }));

setImageOptions([...sudorouterOptions, ...customOptions]);
```

错误处理建议：

- sudorouter pricing 拉取失败时，不要禁用整个下拉。如果有 custom image models，仍允许选择外部模型。
- `isImageListError` 只在 sudorouter 和 scode config 都失败，且没有任何可选模型时显示。
- 默认模型仍从 sudorouter pricing 中选择；外部模型不自动成为默认，除非用户显式选择。

### 3. 配置可用性校验支持外部模型

文件：

- `src/common/imageGenerationModelConfig.ts`
- `src/process/bridge/scodeBridge.ts`
- `src/renderer/context/AuthContext.tsx`
- `src/renderer/pages/settings/tools/index.tsx`

`resolveImageModelWithAvailability()` 增加第三个参数：

```typescript
export function resolveImageModelWithAvailability(
  saved: ImageGenerationModelConfig,
  items: SpecificImagePricingItem[],
  customImageModelValues: string[] = []
): { jsonModelId: string | null; persistedUseModel: string; changed: boolean } {
  const switchOn = saved.switch !== false;
  const useModel = saved.useModel;
  const inPricing = !!(useModel && items.some((it) => it.model_id === useModel));
  const inCustom = !!(useModel && customImageModelValues.includes(useModel));
  const isAvailable = inPricing || inCustom;
  const defaultModel = pickDefaultImageModelFromPricing(items);

  if (!switchOn) {
    if (useModel && !isAvailable) {
      return { jsonModelId: null, persistedUseModel: defaultModel, changed: true };
    }
    return { jsonModelId: null, persistedUseModel: useModel ?? '', changed: false };
  }

  if (useModel && isAvailable) {
    return { jsonModelId: useModel, persistedUseModel: useModel, changed: false };
  }
  if (useModel && !isAvailable) {
    return { jsonModelId: defaultModel || null, persistedUseModel: defaultModel, changed: true };
  }
  return { jsonModelId: defaultModel || null, persistedUseModel: '', changed: false };
}
```

`resolveImageModelForMainSync()` 也必须读取 `sudocode.json` 并传入 custom values：

```typescript
const scodeConfig = readExistingConfig() as ScodeConfig;
const customImageModelValues = extractImageModelsFromScodeConfig(scodeConfig).map((item) => item.value);
const { jsonModelId, persistedUseModel, changed } =
  resolveImageModelWithAvailability(saved, items, customImageModelValues);
```

这样外部模型不会在启动、登录、sudoclaw 网关启动时被误修回 sudorouter 默认模型。

### 4. resolveImageConfig 解析外部 provider 凭证

文件：

- `src/process/bridge/imageGenerationBridge.ts`

新增 helper：

```typescript
export function readApiKeyProviderCredentials(providerId: string): { baseUrl: string; apiKey: string } | null {
  try {
    const raw = fsSync.readFileSync(SUDOCODE_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as ScodeConfig;
    const provider = config.auth_modes?.['api-key']?.[providerId];
    if (provider?.baseUrl && provider?.apiKey) {
      return { baseUrl: provider.baseUrl.replace(/\/+$/, ''), apiKey: provider.apiKey };
    }
  } catch {
    // ignored
  }
  return null;
}
```

`resolveImageConfig()` 拿到 `imageModelId` 后，在 sudorouter 前加外部解析：

```typescript
const customRef = parseCustomImageModelRef(imageModelId);
if (customRef) {
  const externalCreds = readApiKeyProviderCredentials(customRef.providerId);
  if (externalCreds) {
    return { baseUrl: externalCreds.baseUrl, apiKey: externalCreds.apiKey, model: customRef.modelId };
  }
}
```

保留现有 sudorouter fallback：

- 裸模型名继续走 `readSudorouterCredentials()`。
- `model.config` sudorouter provider fallback 保持不变。
- 如果外部 provider 引用存在但凭证缺失，建议记录日志后继续 fallback；也可以直接返回 null。推荐继续 fallback 以保持现有容错，但日志必须明确，便于排查。

### 5. generateUserAvatar 复用 resolveImageConfig

文件：

- `src/process/bridge/imageGenerationBridge.ts`

当前 `generateUserAvatar()` 直接读 `readSudorouterCredentials()`，并把带 `/` 的模型截到最后一段。改为：

```typescript
const config = await resolveImageConfig();
if (!config) {
  return { success: false, msg: '图像生成功能尚未配置，无法生成头像' };
}

const imageUrl = await callImagesGenerations(
  config.baseUrl,
  config.apiKey,
  config.model,
  prompt,
  '1024x1024',
  1
);
```

这样头像生成和对话生图使用同一套配置。

### 6. scode skill 路径支持 Windows

文件：

- `skills/image-generation/SKILL.md`
- `skills/image-generation/scripts/generate_image.py`
- `skills/image-generation/scripts/generate_image.sh`

项目已新增 `generate_image.py`，skill 文档应默认使用：

```bash
python skills/image-generation/scripts/generate_image.py gen "<prompt>" "<absolute_filepath_no_ext>" [size]
python skills/image-generation/scripts/generate_image.py edit "<prompt>" "<image_path>" "<absolute_filepath_no_ext>" [size]
```

`generate_image.sh` 保留为 Unix fallback。

需要同步修正 `.sh` 的模型前缀处理：

- 不能无条件 `MODEL="${MODEL##*/}"`。
- 只有兼容旧的 `provider/model` 且确认 provider 是凭证前缀时才剥离。
- 更推荐由 `resolveImageConfig()` 注入裸 `IMAGE_MODEL`，脚本不再自行猜测 provider 前缀。

`generate_image.py` 也应使用同样规则：运行期 env 注入优先，配置文件读取 fallback 不破坏 namespaced model ID。

### 7. i18n 和类型覆盖

文件：

- `src/renderer/i18n/locales/zh-CN/settings.json`
- `src/renderer/i18n/locales/en-US/settings.json`
- `src/renderer/i18n/locales/zh-TW/settings.json`
- `src/renderer/i18n/locales/ja-JP/settings.json`
- `src/renderer/i18n/locales/ko-KR/settings.json`
- `src/renderer/i18n/locales/tr-TR/settings.json`
- `src/renderer/i18n/i18n-keys.d.ts`

新增 key：

```json
"supportsImageGeneration": "图片生成",
"supportsImageGenerationExtra": "仅支持 OpenAI 兼容图片接口 /images/generations、/images/edits，以及 Gemini generateContent 图片输出。若服务商使用其他原生接口，即使模型支持生图也可能无法调用。",
"testImageGeneration": "测试图片生成",
"testImageGenerationCostHint": "测试会向当前服务商发送一次真实图片生成请求，可能产生费用。"
```

英文建议：

```json
"supportsImageGeneration": "Image generation",
"supportsImageGenerationExtra": "Supports only OpenAI-compatible image endpoints /images/generations, /images/edits, and Gemini generateContent image output. Providers with other native image APIs may not work even if the model can generate images.",
"testImageGeneration": "Test image generation",
"testImageGenerationCostHint": "The test sends a real image generation request to the current provider and may incur charges."
```

不要在组件里硬编码新文案。

---

## 数据流

### 添加外部图片模型

用户在「设置 → 模型」添加：

```text
providerId = custom-openai
baseUrl = https://api.example.com/v1
apiKey = sk-xxx
modelId = flux-1
supportsImageGeneration = true
```

保存到 `sudocode.json`：

```json
{
  "auth_modes": {
    "api-key": {
      "custom-openai": {
        "baseUrl": "https://api.example.com/v1",
        "apiKey": "sk-xxx"
      }
    }
  },
  "models": {
    "custom-openai/flux-1": {
      "alias": "custom-openai/flux-1",
      "name": "custom-openai/flux-1",
      "supports_image_generation": true,
      "providers": {
        "api-key": {
          "provider": "custom-openai",
          "model": "flux-1",
          "api": "openai-completions"
        }
      }
    }
  }
}
```

### Tools 下拉

下拉合并：

```text
sudorouter: gemini-3.1-flash-image
sudorouter: gemini-3-pro-image
custom-openai / flux-1
```

用户选中外部模型后：

```typescript
ConfigStorage.set('tools.imageGenerationModel', {
  switch: true,
  useModel: 'custom-openai/flux-1',
});

scode.setImageModel.invoke({ modelId: 'custom-openai/flux-1' });
```

`scode.setImageModel` 继续同步：

- `sudocode.json tools.imageGenerationModel = 'custom-openai/flux-1'`
- `sudoclaw.json agents.defaults.imageGenerationModel = 'custom-openai/flux-1'`

### 对话内主进程生图

```text
resolveImageConfig()
  imageModelId = custom-openai/flux-1
  parseCustomImageModelRef -> { providerId: custom-openai, modelId: flux-1 }
  readApiKeyProviderCredentials(custom-openai)
  return { baseUrl: https://api.example.com/v1, apiKey: sk-xxx, model: flux-1 }

callImagesGenerations(baseUrl, apiKey, flux-1, ...)
```

### scode agent skill 生图

```text
acpConnectors
  resolveImageConfig()
  env:
    IMAGE_MODEL=flux-1
    PROVIDER_BASE_URL=https://api.example.com/v1
    PROVIDER_API_KEY=sk-xxx

image-generation skill
  python scripts/generate_image.py gen ...
```

### namespaced 模型

用户添加：

```text
providerId = custom
modelId = black-forest-labs/FLUX.1-schnell
```

选择值：

```text
custom/black-forest-labs/FLUX.1-schnell
```

解析结果必须是：

```typescript
{ providerId: 'custom', modelId: 'black-forest-labs/FLUX.1-schnell' }
```

---

## 不做

- 不改 `model.config`（IProvider[]）。外部图片模型配置在 ScodeConfig 内闭环。
- 不新增单独的密钥存储。外部密钥继续存于 `sudocode.json auth_modes.api-key` 和已有 SQLite 自定义模型表。
- 不实现任意厂商原生图片协议。第一版只支持 OpenAI-compatible 和 Gemini-compatible。
- 不自动启用所有外部模型作为图片模型。只接受 `supports_image_generation` 或保守正则命中的模型。

---

## 风险与处理

| 风险 | 处理 |
|---|---|
| 外部模型 ID 带 `/` 被截断 | 只按第一个 `/` 解析 providerId，后续完整保留 |
| 启动同步把外部模型误修为默认模型 | `resolveImageModelForMainSync()` 传入 custom image model values |
| sudorouter pricing 拉取失败导致外部模型下拉不可用 | Tools 页允许 scode config 单独成功时显示 custom options |
| 外部 provider 不兼容 `/images/generations` | 文档和 UI 说明仅支持 OpenAI-compatible/Gemini-compatible |
| Windows 无 bash 导致 skill 不可用 | 默认使用 `generate_image.py`，`.sh` 只作 fallback |
| 用户未勾选但模型名像图片模型 | 正则兜底显示，编辑时预填勾选，用户可关闭 |

---

## 测试计划

### 单元测试

| 文件 | 测试内容 |
|---|---|
| `tests/unit/scodeConfig.test.ts` | `buildCustomImageModelValue`、`parseCustomImageModelRef`、`extractImageModelsFromScodeConfig`；覆盖 namespaced model ID |
| `tests/unit/imageGenerationModelConfig.test.ts` | `resolveImageModelWithAvailability` 保留 custom value；switch off 时不泄漏运行期模型；失效 custom value 仍修复 |
| `tests/unit/imageGenerationModelSync.test.ts` | `writeSudoclawImageGenerationModel` 保留全限定名 |
| `tests/unit/imageGenerationBridge.test.ts` | `readApiKeyProviderCredentials` 和 `resolveImageConfig` 对外部 provider 返回外部凭证；裸模型仍走 sudorouter |
| `tests/unit/scodeConfig.test.ts` | `mergeCustomProviderIntoScodeConfig` 和 `extractCustomProvidersFromScodeConfig` 往返保留 `supportsImageGeneration` |
| `tests/unit/modelImageGenerationProtocolHint.dom.test.tsx` | 「图片生成」勾选项显示支持协议说明；测试按钮显示费用提示 |

### 集成/手工验收

1. 添加 `custom-openai/flux-1`，勾选「图片生成」，Tools 下拉出现 `custom-openai / flux-1`。
2. 「图片生成」勾选项旁边能看到支持协议说明。
3. 点击“测试图片生成”前显示可能产生费用的提示。
4. 测试 OpenAI-compatible provider 成功后自动勾选「图片生成」。
5. 测试不支持 `/images/generations` 的 provider 时，展示不兼容错误，不自动勾选。
6. 选择该模型后重启应用，Tools 选择不被修回 sudorouter 默认模型。
7. 触发对话内生图，日志显示请求发往外部 `baseUrl`，模型为 `flux-1`。
8. 触发 scode agent 的 `image-generation` skill，Windows 环境使用 `generate_image.py`，不再尝试 `bash`。
9. 添加 `custom/black-forest-labs/FLUX.1-schnell`，生图请求 model 保留 `black-forest-labs/FLUX.1-schnell`。
10. 切回 sudorouter 模型，仍走 sudorouter 凭证。
11. 关闭图像生成开关，`sudocode.json` 和 `sudoclaw.json` 写入空运行期模型，生图入口返回未配置提示。
12. 用户头像生成使用与 Tools 相同的外部模型配置。

### 验证命令

```bash
bunx eslint src/common/scodeConfig.ts --fix
bunx eslint src/common/imageGenerationModelConfig.ts --fix
bunx eslint src/process/bridge/imageGenerationBridge.ts --fix
bunx eslint src/process/bridge/scodeBridge.ts --fix
bunx eslint src/renderer/pages/settings/tools/index.tsx --fix
bunx eslint src/renderer/pages/settings/models/components/AddModelDialog.tsx --fix
bunx eslint src/renderer/pages/settings/models/utils/index.ts --fix
bunx tsc --noEmit
bun run test -- tests/unit/scodeConfig.test.ts tests/unit/imageGenerationModelConfig.test.ts tests/unit/imageGenerationModelSync.test.ts tests/unit/imageGenerationBridge.test.ts
```

---

## 受影响文件清单

| 文件 | 改动性质 |
|---|---|
| `src/common/ipcBridge.ts` | `ScodeModelEntry` 增加 `supports_image_generation` |
| `src/common/scodeConfig.ts` | 增加图片模型提取/解析 helper；自定义模型持久化保留 `supportsImageGeneration` |
| `src/common/imageGenerationModelConfig.ts` | `resolveImageModelWithAvailability` 接受 custom image model values |
| `src/process/bridge/imageGenerationBridge.ts` | 外部 provider 凭证解析；`generateUserAvatar` 复用 `resolveImageConfig` |
| `src/process/bridge/scodeBridge.ts` | `resolveImageModelForMainSync` 读取 custom image model values |
| `src/process/bridge/imageGenerationModelSync.ts` | 保留全限定名即可，通常只需补测试和注释 |
| `src/process/services/serviceManager/ServiceManager.ts` | 通过 `resolveImageModelForMainSync` 继承新校验；若签名变化则同步调用 |
| `src/renderer/pages/settings/models/components/AddModelDialog.tsx` | 增加「图片生成」勾选框和编辑预填 |
| `src/renderer/pages/settings/models/components/AddModelDialog.tsx` | 展示支持协议说明；可选增加“测试图片生成”按钮和费用提示 |
| `src/renderer/pages/settings/models/utils/index.ts` | 表单模型与 ScodeModelEntry 字段往返 |
| `src/renderer/pages/settings/models/index.tsx` | 可选展示「图片生成」Tag |
| `src/renderer/pages/settings/tools/index.tsx` | 合并 sudorouter 和 custom image model options；容错调整 |
| `src/renderer/context/AuthContext.tsx` | 登录/初始化同步时传 custom image model values |
| `src/renderer/i18n/locales/*.json` | 新增 `settings.sudocodeModel.supportsImageGeneration` |
| `skills/image-generation/SKILL.md` | 默认走 Python 跨平台入口 |
| `skills/image-generation/scripts/generate_image.py` | Windows/跨平台生图入口 |
| `skills/image-generation/scripts/generate_image.sh` | 修正或移除无条件剥离 `/` 前缀的逻辑 |

---

## 实施顺序

1. 先在 `src/common/scodeConfig.ts` 增加 `supportsImageGeneration` 类型、解析 helper、提取 helper，并补单测。
2. 修改 `imageGenerationModelConfig.ts`，让可用性校验接受 custom values，并补单测。
3. 修改 Tools 页，把下拉选项合并外部图片模型，并调整错误态。
4. 修改 AddModelDialog 和模型设置页，支持标注与展示「图片生成」，并显示当前支持的生图协议说明。
5. 修改 `resolveImageConfig()` 和 `generateUserAvatar()`，打通外部 provider 运行期凭证。
6. 修改 `resolveImageModelForMainSync()` 及相关启动同步路径，避免外部选择被误修。
7. 可选增加“测试图片生成”入口：真实调用最小生图请求，成功后自动勾选，失败时展示兼容性错误。
8. 修正 image-generation skill 文档和脚本模型名处理。
9. 跑 lint、`bunx tsc --noEmit`、相关单测和手工生图验收。

---

## 可行性结论

该方案可行，但可行条件是把外部图片模型作为 ScodeConfig 的一等能力处理，而不是只在 Tools 下拉里追加一个字符串。关键闭环如下：

- ScodeConfig 保存能力标注和 provider 凭证。
- Common helper 统一提取、解析、校验外部图片模型。
- Renderer、启动同步、运行期生图共用同一套 custom image model values。
- `resolveImageConfig()` 是主要运行期收敛点，`generateUserAvatar()` 等旁路入口必须归并进来。
- skill 默认走跨平台 Python 入口，避免 Windows bash 依赖。
