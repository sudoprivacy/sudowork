---
name: jiansheku
description: >
  建设库 (Jiansheku) Open API integration — Chinese construction industry data platform
  with 93 endpoints across 18 categories. Use this skill to query company registration,
  qualifications, bidding records, project performance, risk data, and more.
  Trigger when user mentions: 建设库, 大司空, 工商信息, 企业资质, 招投标, 四库业绩,
  or any Chinese construction industry data lookup.
---

# 建设库 API 集成指南

## 一、凭证获取与配置

调用建设库 API 需要 **AppKey** 和 **AppSecret** 两个凭证。

### 如何获取凭证

1. 凭证由**大司空科技**分配，需要联系建设库商务团队开通
2. 开通后会收到一封《大司空科技开放平台数据接口服务开通通知》，里面包含 AppKey（32位）和 AppSecret（32位）
3. 凭证还关联了**已授权的接口列表**和**调用额度**，不同套餐可用的接口不同

### 凭证在哪里配置

凭证按以下优先级自动获取：

1. **环境变量**（最高优先）：`JIANSHEKU_APP_KEY` 和 `JIANSHEKU_APP_SECRET`
2. **Nexus 秘钥库**（推荐）：namespace `service:jiansheku`，通过桌面应用设置 UI 配置
3. **`.env` 文件**（向后兼容）：`skills/jiansheku/.env`

**推荐方式：** 在桌面应用中配置：**设置 → 远程连接 → 秘钥管理 → 建设库**，填入 App Key 和 App Secret 后保存。凭证安全存储在本地 Nexus 秘钥库中，脚本每次调用时自动读取。

**其他方式：**

- 环境变量（用于调试/CI）：
  ```bash
  export JIANSHEKU_APP_KEY=你的32位AppKey
  export JIANSHEKU_APP_SECRET=你的32位AppSecret
  ```

- `.env` 文件（向后兼容）：
  ```
  skills/jiansheku/.env
  JIANSHEKU_APP_KEY=你的32位AppKey
  JIANSHEKU_APP_SECRET=你的32位AppSecret
  ```

**如果凭证缺失：** 脚本会报错并列出所有配置方式。此时应引导用户通过桌面应用的秘钥管理页面配置凭证，或联系建设库（大司空科技）商务团队获取。

### 检查凭证是否可用

```bash
python scripts/jiansheku_api.py --endpoint /v1/company/business/base/info --data '{"companyName":"中建三局集团有限公司"}'
```

- 返回 JSON 数据 → 凭证正常
- 报错 `[205] 签名验证异常` → AppKey 或 AppSecret 不正确
- 报错 `[206] appKey已过期停用` → 凭证已过期，需联系大司空续期
- 报错 `[216] 未授权调用该接口` → 凭证有效但未开通该接口

## 二、SDK 使用方法

SDK 文件位于 `scripts/jiansheku_api.py`，签名算法（ACS3-HMAC-SHA256）已全部封装，agent 只需关注调用。

### 命令行调用

```bash
python scripts/jiansheku_api.py --endpoint /v1/company/business/base/info --data '{"companyName":"中建三局集团有限公司"}'
```

### Python 代码调用

```python
from jiansheku_api import Jiansheku, resolve_credentials

# 自动从 Nexus 秘钥库 / 环境变量 / .env 文件获取凭证
app_key, app_secret = resolve_credentials()
api = Jiansheku(app_key, app_secret)

# 调用任意接口：传 path + body dict，签名自动完成
result = api.call("/v1/company/business/base/info", {"companyName": "中建三局集团有限公司"})

# api.call() 成功时返回 response 中的 data 字段
# api.raw() 返回完整 response（含 code/msg/data），不抛异常
# api.lookup("企业名") 用于查企业 cid/eid（form-encoded 特殊接口）
```

### 响应码含义

| code | 含义 | 处理方式 |
|------|------|----------|
| 200 | 成功 | 正常返回 data |
| 201 | 暂无数据 | 正常，该企业无此类记录 |
| 300 | 暂无此公司 | 检查公司名称是否正确 |
| 400 | 参数错误 | 检查请求参数 |
| 216 | 未授权 | 该 appKey 未开通此接口 |
| 500 | 系统异常 | 服务端错误，可重试 |

## 二、API 端点目录结构

所有 93 个 API 端点文档按路径组织在 `v1/` 目录下，每个文件包含参数定义和请求/响应示例。完整索引见 [INDEX.md](INDEX.md)。

```
v1/company/
├── business/         # 工商信息 + 荣誉
│   ├── base/info.md
│   ├── checkTheEnterprise.md
│   ├── combinedSearch.md
│   ├── ...
├── qualification/    # 企业资质
│   ├── buildCert.md
│   ├── anXu.md
│   ├── ...
├── results/          # 四库业绩 + 一体化业绩 + 水利
│   ├── companyResults.md
│   ├── province/     # 一体化业绩
│   ├── sky/          # 竣工验收
│   ├── ...
├── bidding/          # 招投标
│   ├── newZhaoBiao/
│   ├── zhongBiao/
│   ├── ...
├── industrial/       # 经营风险 + 工商变更
├── control/          # 核验类接口
├── personnel/        # 人员信息
├── siFaInfo/         # 司法信息
├── taxInfo/          # 税务信息
├── zhiShi/           # 知识产权
└── search/fuzzy/     # 模糊搜索
```

## 三、高层任务模板

以下 6 个模板覆盖绝大多数使用场景。**agent 应优先使用这些模板。**

### 模板 A：企业搜索（按条件筛选企业列表）

**核心接口：** `POST /v1/company/business/combinedSearch`

```python
# 找广东省同时持有「市政一级」和「公路一级」资质的企业
result = api.call("/v1/company/business/combinedSearch", {
    "aptitudeQueryDto": {
        "aptitudeQueryType": "and",
        "aptitudeDtoList": [
            {"nameStr": "市政公用工程施工总承包一级", "queryType": "and"},
            {"nameStr": "公路工程施工总承包一级", "queryType": "and"}
        ],
        "aptitudeSource": "new",
        "domicile": "广东"
    },
    "page": {"page": 1, "limit": 20, "order": "desc"}
})
```

### 模板 B：企业档案（一家企业的全面信息）

```python
company = "中国建筑第二工程局有限公司"
info = api.call("/v1/company/business/base/info", {"companyName": company})
quals = api.call("/v1/company/qualification/buildCert", {"companyName": company})
staff = api.call("/v1/company/personnel/aqy", {"companyName": company})
safety = api.call("/v1/company/qualification/anXu", {"companyName": company})
```

### 模板 C：业绩查询

```python
# 四库业绩
siku = api.call("/v1/company/results/companyResults", {
    "companyName": company, "page": {"page": 1, "limit": 20}
})
# 中标业绩
bids = api.call("/v1/company/bidding/zhongBiao/list", {
    "companyName": company, "pageIndex": 1, "pageSize": 20
})
```

### 模板 D：风险扫描

```python
# 使用 api.raw() 区分「无数据」和「有数据」
abnormals = api.raw("/v1/company/industrial/abnormals", {"companyName": company})
penalties = api.raw("/v1/company/business/xzcf", {"companyName": company})
violations = api.raw("/v1/company/business/weiFa", {"companyName": company})
dishonest = api.raw("/v1/company/siFaInfo/executions", {"companyName": company})
```

### 模板 E：招投标查询

```python
tenders = api.call("/v1/company/bidding/newZhaoBiao/list", {
    "keyword": "医院", "pageIndex": 1, "pageSize": 20
})
bids = api.call("/v1/company/bidding/newTouBiao/list", {
    "companyName": company, "pageIndex": 1, "pageSize": 20
})
```

### 模板 F：企业核验

```python
verify = api.call("/v1/company/control/yzjzqy", {
    "companyName": company, "aptitudeName": "建筑工程施工总承包一级"
})
```

## 四、分页注意事项

**方式 A — pageIndex/pageSize（大多数接口）：**
```python
{"companyName": "xxx", "pageIndex": 1, "pageSize": 20}
```

**方式 B — page 对象（四库/一体化/中标组合/水利/组合查询）：**
```python
{"companyName": "xxx", "page": {"page": 1, "limit": 20}}
```

**混用会返回 400 错误。** 使用 page 对象的接口：combinedSearch、companyResults、province/*、waterProjectList、bidding/project/recently。

## 五、已知文档示例问题

| 接口 | 文档问题 | 正确用法 |
|------|----------|----------|
| 严重违法 | 示例含占位符 creditCode | 只传 companyName |
| 限制高消费 | isHistory 应为 int | `isHistory: 0` 或 `1` |
| 人员资质证书 | pageSize 应为 int | `pageSize: 10` |
| 中标组合查询 | 用 pageIndex/pageSize | 必须用 `page` 对象 |
| 资质来源查询 | source 为中文 | `source: 1`（Integer） |
| 招中标正文 | 用 md5 字段 | 改用 `contentId` + `type` |
| 模糊搜索 | 用 companyName | 改用 `keyword` 字段 |
