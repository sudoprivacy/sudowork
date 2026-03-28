# 人员资质证书

**分类:** 企业人员
**路径:** `POST /v1/company/personnel/qualification/cert`
**Content-Type:** `application/json`

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| cid | number | 否 | 企业Id |
| companyName | string | 否 | 企业名称 |
| creditCode | string | 否 | 社会信用代码 |
| staffCertType | string | 否 | 证书类别(注册人员，职称人员，现场管理人员，三类人员，其他人员） |
| staffCertCategory | string | 否 | 证书大类 |
| staffCertLevel | string | 否 | 证书等级 |
| staffName | string | 否 | 人员姓名 |
| pageIndex | number | 否 | 页数 |
| pageSize | string | 否 | 条数 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 |  |
| list | array | 是 |  |
| certDateEnd | number | 是 | 证书到期日期 |
| certDateStart | number | 是 | 证书发证日期 |
| currentCompanyId | number | 是 | 企业id |
| currentCompanyName | string | 是 | 企业名称 |
| isHistory | number | 是 | 数据是否为历史 |
| issueAuthority | string | 是 | 证书颁发机构 |
| staffCertCategory | string | 是 | 证书大类 |
| staffCertKind | string | 是 | 证书小类 |
| staffCertLevel | string | 是 | 证书等级 |
| staffCertName | string | 是 | 证书名称 |
| staffCertNo | string | 是 | 证书编号 |
| staffCertProfession | string | 是 | 证书专业 |
| staffCertRegisteredDate | number | 是 | 人员证书注册时间 |
| staffCertType | string | 是 | 证书类别 |
| staffId | string | 是 | 人员id |
| staffName | string | 是 | 人员姓名 |
| staffRegisteredNo | string | 是 | 注册号 |
| staffSealNo | string | 是 | 执业印章编号 |
| totalCount | number | 是 |  |
| msg | string | 是 |  |
