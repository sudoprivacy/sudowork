# 主要成员查询

**分类:** 工商信息
**路径:** `POST /v1/company/personnel/backbone`
**Content-Type:** `application/json`

### 请求地址
/v1/company/personnel/backbone

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "companyName":"中国华西工程设计建设有限公司",
  "pageIndex":"1",
  "pageSize":"3"
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| jobTitle | String | 255 | 否 | 主要人员职位 |
| name | String | 255 | 否 | 主要人员姓名 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "jobTitle": "董事",
                "name": "王强"
            },
            {
                "jobTitle": "董事",
                "name": "郭凤龙"
            },
            {
                "jobTitle": "监事",
                "name": "贾剑锋"
            }
        ],
        "totalCount": 14
    },
    "msg": "查询成功"
}

```
