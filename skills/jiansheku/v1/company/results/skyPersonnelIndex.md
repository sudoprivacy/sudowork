# 四库备案业绩-人员技术指标

**分类:** 四库业绩
**路径:** `POST /v1/company/results/skyPersonnelIndex`
**Content-Type:** `application/json`

四库备案业绩-人员技术指标

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| pageIndex | number | 是 |  |
| pageSize | number | 是 |  |
| pid | string | 否 | 项目编号 |
| companyName | string | 否 | 企业名称 |
| creditCode | string | 否 | 企业信用代码 |
| staffId | string | 否 | 人员 id |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 |  |
| msg | string | 是 |  |
| list | array | 是 |  |
| companyCode | string | 是 |  |
| companyId | number | 是 |  |
| companyName | string | 是 |  |
| createTime | number | 是 |  |
| dataLevel | string | 是 |  |
| endDate | number | 是 |  |
| id | number | 是 |  |
| isHistory | number | 是 |  |
| performanceNumber | string | 是 |  |
| personCardno | string | 是 |  |
| personName | string | 是 |  |
| personPerformanceNo | string | 是 |  |
| personRole | string | 是 |  |
| pid | string | 是 |  |
| projectName | string | 是 |  |
| projectType | string | 是 |  |
| qualificationsLevel | string | 是 |  |
| scale | string | 是 |  |
| staffId | string | 是 |  |
| startDate | number | 是 |  |
| updateTime | number | 是 |  |
| totalCount | number | 是 |  |
