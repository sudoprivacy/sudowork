# 是否为国有企业

**分类:** 经营信息
**路径:** `POST /v1/company/business/isStateEnt`
**Content-Type:** `application/json`

输入企业名称/id/统一社会信用代码，该企业若有国有企业/省属国企/央企/央企子公司任意一个标签，则返回”是“，否则返回”否“

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| companyName | string | 是 | 企业名称 |
| cid | number | 否 | 企业id |
| creditCode | string | 否 | 企业统一社会信用代码 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 |  |
| isStateCompany | number | 是 | 是否为国有企业（1是，0否） |
| msg | string | 是 |  |
