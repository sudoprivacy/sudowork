# 企业对外投资查询

**分类:** 工商信息
**路径:** `POST /v1/company/industrial/investments`
**Content-Type:** `application/json`

### 对外投资查询

### 接口描述
根据企业查企业对外投资

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/investments

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
 "companyName": "上海国际汽车城新能源投资发展有限公司",
 "pageIndx":1,
 "pageSize":1
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| investEid | string | 36 | 是 | 被投资企业id |
| investName | string | 255 | 是 | 被投资企业名称 |
| name | string | 255 | 是 | 企业名称 |
| shouldCapi | Decimal | 40,6 | 是 | 投资金额/数据源原始认缴额(单位未转换) |
| shouldCapiConv | Decimal | 40,6 | 是 | 应缴额（转换为万元人民币的） |
| stockNum | Long | 30 | 是 | 在被投资企业的持股数 |
| stockPercent | Decimal | 40,10 | 是 | 股比 |
| business_status | string | 255 | 否 | 被投资企业经营状态 |
| totalCount | integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "msg": "查询成功",
    "data": {
        "totalCount": 8,
        "list": [
            {
                "stockPercent": 0.0777777346,
                "business_status": "存续（在营、开业、在册）",
                "name": "上海国际汽车城新能源投资发展有限公司",
                "shouldCapi": 400,
                "investName": "上海驿动汽车服务有限公司",
                "investEid": "44e77e99-e9aa-4d0e-96fb-45f8ec428403",
                "shouldCapiConv": 400
            }
        ]
    }
}

```
返回code码见 API 前置说明
