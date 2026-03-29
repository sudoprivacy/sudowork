# 标准接口-企业模糊查询-全量企业

**分类:** 工商信息
**路径:** `POST /v1/company/search/fuzzy/all`
**Content-Type:** `application/json`

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| keyword | string | 是 | 企业名称 |
| pageIndex | string | 是 | 页数 |
| pageSize | string | 是 | 条数 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 | 响应数据 |
| list | array | 是 | 数据列表 |
| name | string | 是 | 企业名称（关键词标红） |
| registeredCapitalStr | string | 是 | 注册资本字符串 |
| registeredDate | string | 是 | 注册时间 |
| creditCode | string | 是 | 统一社会信用代码 |
| registeredCapital | number | 是 | 注册资本 |
| legalPerson | string | 是 | 法人 |
| businessStatus | string | 是 | 经营状态 |
| domicile | string | 是 | 所属省市区 |
| jskEid | number | 是 | 企业eid |
| totalCount | number | 是 | 总条数 |
| msg | string | 是 |  |
| county | string | 是 | 区县 |
| province | string | 是 | 省份 |
| id | string | 是 | 企业id |
| formerName | string | 是 | 曾用名 |
| city | string | 是 | 所属市 |
