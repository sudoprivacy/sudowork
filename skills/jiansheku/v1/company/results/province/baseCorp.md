# 一体化平台业绩-参与单位及相关负责人信息

**分类:** 一体化业绩
**路径:** `POST /v1/company/results/province/baseCorp`
**Content-Type:** `application/json`

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 255 | 是 | 项目id |
| pageIndex | Integer | - | 是 | 页数 |
| pageSize | Integer | - | 是 | 条数 |


#### 请求示例

```
{
  "pid":"D87A612A331CFB4944A4532B522A3983",
  "pageIndex":1,
  "pageSize":2
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| personName | String | 50 | 否 | 负责人姓名 |
| corpRole | String | 50 | 是 | 企业承担角色 |
| jskEid | Integer | - | 是 | 企业id |
| personRole | String | 150 | 否 | 人员角色 |
| corpCode | String | 50 | 否 | 企业统一社会信用代码 |
| corpName | String | 255 | 是 | 企业名称 |
| staffId | String | 50 | 否 | 人员ID |
| totalCount | Integer | - | 是 | 总条数 |


 

#### 返回结果示例

```
{
  "code": 200,
  "data": {
    "list": [
      {
        "personName": null,
        "corpRole": "施工单位",
        "jskEid": 16501,
        "personRole": null,
        "corpName": "江苏建航工程有限公司",
        "corpCode": null,
        "staffId": null,
        "staffCard": null
      },
      {
        "personName": null,
        "corpRole": "监理单位",
        "jskEid": 82244,
        "personRole": null,
        "corpName": "四川明力建设工程项目管理有限公司",
        "corpCode": null,
        "staffId": null,
        "staffCard": null
      }
    ],
    "totalCount": 5
  },
  "msg": "查询成功"
}

```
