# 招中标正文详情

**分类:** 招投标信息
**路径:** `POST /v1/company/bidding/getContentByType`
**Content-Type:** `application/json`

通过正文id，查询招中标正文详情

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| md5 | string | 是 | 项目id |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 |  |
| bidWinTime | string | 是 | 中标时间 |
| content | string | 是 | 正文 |
| contentId | string | 是 |  |
| projectName | string | 是 | 项目名称 |
| title | string | 是 | 中标公示标题 |
| url | string | 是 | 原文链接 |
| msg | string | 是 |  |
