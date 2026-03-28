# 被执行人

**分类:** 司法涉诉
**路径:** `POST /v1/company/siFaInfo/executedPersons`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/siFaInfo/executedPersons

### 请求方式
POST(application/json)

### 请求参数

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |
| uTags | Integer | - | 否 | 是否历史：1是，0否 |


#### 请求示例

```
{
 "companyName": "中国华西工程设计建设有限公司",
 "uTags":1,
 "pageIndex":1,
 "pageSize":1
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| amount | Long | - | 否 | 执行标的 |
| caseDate | String | 20 | 否 | 立案日期 |
| caseId | String | 255 | 否 | 案件id |
| caseNumber | String | 255 | 否 | 案号 |
| court | String | 255 | 否 | 执行法院 |
| number | String | 255 | 否 | 纳税人识别号/组织机构代码 |
| status | String | 20 | 否 | 执行状态：0: 执行中，1: 已结案 |
| type | String | 20 | 否 | 被执行人类型 |
| uTags | String | 10 | 否 | 状态：0：当前 非0：历史 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
    "data": {
        "list": [
            {
                "number": "",
                "amount": 8154487,
                "caseDate": "2021-06-07",
                "caseNumber": "（2021）川0118执恢98号",
                "uTags": "1",
                "caseId": "1370313503",
                "type": "E",
                "court": "成都市新津区人民法院",
                "status": "0"
            }
        ],
        "totalCount": 3
    },
    "msg": "查询成功"
}

```
