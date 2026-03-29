# 纳税人类型

**分类:** 经营信息
**路径:** `POST /v1/company/taxInfo/payerType`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/taxInfo/payerType

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
  	"companyName": "中建三局集团有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 参数说明 |
| --- | --- | --- | --- | --- |
| createdTime | Long | - | 否 | 登记时间 |
| qualification | String | 100 | 否 | 资格类型 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "createdTime": "1520943624085",
                "qualification": "按征收率征收增值税小规模纳税人"
            }
        ],
        "totalCount": 2
    },
    "msg": "查询成功"
}

```
