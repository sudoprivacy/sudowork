# 简易注销

**分类:** 经营风险
**路径:** `POST /v1/company/industrial/cancel`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/cancel

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  	"companyName": "海口汉嘉实业有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 参数说明 |
| --- | --- | --- | --- | --- |
| companyCode | String | 255 | 否 | 企业编码 |
| creditRegNo | String | 100 | 否 | 企业统一社会信用代码 |
| department | String | 255 | 否 | 登记机关 |
| gsScaObjections | String | 65535 | 否 | 异议信息 |
| gsScaResult | String | 65535 | 否 | 简易注销结果 |
| noticePeriod | String | 255 | 否 | 公告期 |
| url | String | 255 | 否 | 全体投资人承诺书（地址） |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "companyCode": "460100011127076",
                "noticePeriod": "2021年12月24日 - 2021年12月30日",
                "creditRegNo": "91460100MA5RCXLG0F",
                "gsScaResult": "[{\"date\":\"2021-12-31\",\"result\":\"准许简易注销（未开业、无债权债务）\"}]",
                "department": "海口市市场监督管理局",
                "url": "91460100MA5RCXLG0F.jpg",
                "gsScaObjections": "[]"
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
