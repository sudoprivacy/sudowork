# 荣誉资质证书查询

**分类:** 企业资质
**路径:** `POST /v1/company/business/honorcer`
**Content-Type:** `application/json`

根据企业查荣誉资质数据

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| companyName | string | 否 | 企业名称 |
| creditCode | string | 否 | 企业统一社会信用代码 |
| cid | number | 否 | 企业id |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 |  |
| list | array | 是 |  |
| certNo | string | 是 | 证书编号 |
| certStatus | string | 是 | 证书状态：有效，过期，撤销，未知 |
| companyName | string | 是 | 企业名称 |
| creditCode | string | 是 | 企业统一社会信用代码 |
| endDate | string | 是 | 证书有效期-截止日 |
| honorCategory | string | 是 | 荣誉资质类别 |
| honorKind | string | 是 | 荣誉资质大类 |
| honorLevel | string | 是 | 荣誉资质等级 |
| honorName | string | 是 | 荣誉资质名称 |
| honorSort | string | 是 | 荣誉资质小类 |
| honorType | string | 是 | 荣誉资质类型 |
| issueAuthority | string | 是 | 证书颁发机构 |
| startDate | string | 是 | 证书有效期-起始日 |
| totalCount | number | 是 | 总条数 |
| msg | string | 是 |  |
