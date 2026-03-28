# 工商清算组人员

**分类:** 经营风险
**路径:** `POST /v1/company/industrial/clear`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/clear

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
  	"companyName": "云南友众科技有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| employees | String | 255 | 否 | 清算组成员 |
| leader | String | 255 | 否 | 算组负责人 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "leader": "柏丹丹",
                "employees": "柏丹丹、柴正悦、屈士君"
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
