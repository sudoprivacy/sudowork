# 水利业绩-获奖信息查询

**分类:** 水利业绩
**路径:** `POST /v1/company/results/waterProject/awardList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/waterProject/awardList

### 请求方式
POST(application/json)

### 请求参数
****************
| 参数名 | 类型 | 长度 | 必须 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 32 | true | 项目编号 |
| pageIndex | Integer | - | false | 页数 |
| pageSize | Integer | - | false | 条数 |


#### 请求示例

```
{
  "pid":"cb57dddcec40cb9b44346fc7b0d8a211",
  "pageIndex":"1",
  "pageSize":"2"
}

```

### 响应参数
********
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Integer | - | 是 | 自增id |
| pid | String | 50 | 否 | 项目编号 |
| awardsName | String | 150 | 否 | 奖项名称 |
| awardsType | String | 50 | 否 | 奖项类别 |
| awardsLevel | String | 50 | 否 | 奖项级别 |
| awardsGrade | Integer | - | 否 | 奖项等级 |
| issueUnit | String | 50 | 否 | 颁奖单位 |
| issueNum | String | 50 | 否 | 奖项编号 |
| issueTime | String | 20 | 否 | 颁发时间 “yyyy-mm-dd” |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 2,
    "list": [
      {
        "id": null,
        "pid": null,
        "awardsName": "诚信履约施工企业称号",
        "awardsType": "其他",
        "awardsLevel": "县市级",
        "awardsGrade": "不分等",
        "issueUnit": "凤凰县水利局",
        "issueNum": "",
        "issueTime": "2015-05-01"
      },
      {
        "id": null,
        "pid": null,
        "awardsName": "水利工程建设项目文明工地",
        "awardsType": "文明工地奖",
        "awardsLevel": "县市级",
        "awardsGrade": "不分等",
        "issueUnit": "凤凰县水利局",
        "issueNum": "",
        "issueTime": "2015-05-01"
      }
    ]
  }
}

```
