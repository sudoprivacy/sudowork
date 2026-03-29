# 知识产权出质

**分类:** 债务风险
**路径:** `POST /v1/company/industrial/knowledge`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/knowledge

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
  	"companyName": "南京开物科技发展有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| name | String | 255 | 否 | 名称 |
| number | String | 255 | 否 | 知识产权注册号 |
| pawnee | String | 255 | 否 | 质权人名称 |
| period | String | 255 | 否 | 质权登记期限 |
| pledgor | String | 255 | 否 | 出质人名称 |
| publicDate | String | 255 | 否 | 公示日期 |
| status | String | 255 | 否 | 状态 |
| type | String | 255 | 否 | 种类 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "number": "4018723",
                "period": "2006年05月28日-2016年05月27日",
                "pawnee": "中华人民共和国国际工商行政管理总局商标局",
                "name": "理桥",
                "publicDate": "2017-01-24",
                "type": "第9类",
                "pledgor": "南京开物科技发展有限公司",
                "status": "有效"
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
