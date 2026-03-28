# 企业备案地查询

**分类:** 经营信息
**路径:** `POST /v1/company/business/record`
**Content-Type:** `application/json`

根据企业查企业备案地

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| companyName | string | 否 | 企业名称 |
| cid | number | 否 | 企业id |
| creditCode | string | 否 | 企业统一社会信用代码 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | array | 是 |  |
| count | number | 是 | 业绩数 |
| isReg | number | 是 | 是否为注册地-1：是，0：否 |
| provinceIdArea | number | 是 | 省代码 |
| provinceName | string | 是 | 省名称 |
| msg | string | 是 |  |
