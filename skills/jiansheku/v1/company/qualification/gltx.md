# 管理体系认证

**分类:** 荣誉奖项
**路径:** `POST /v1/company/qualification/gltx`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/qualification/gltx

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| licenseName | String | 255 | 否 | 证书名称 |
| status | string | 255 | 否 | 证书状态 |
| pageIndex | Integer | - | 是 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "pageIndex":1,
  "pageSize":1,
  "status":"有效",
  "companyName":"中建三局集团有限公司"
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| licenseName | String | 100 | 是 | 证书名称 |
| certificateNo | String | 100 | 否 | 证书编号 |
| id | String | 32 | 是 | 管理体系id |
| issueDateTime | String | 20 | 否 | 发证日期 |
| issueUnit | String | 255 | 否 | 发证机关 |
| remark | String | 255 | 否 | 备注 |
| status | String | 10 | 否 | 证书状态：状态：有效，撤销，注销，含过期，暂停 |
| validityDate | String | 20 | 否 | 证书有效期 |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "certificateNo": "00623E30775R7L",
                "companyName": "中建三局集团有限公司",
                "creditCode": "91420000757013137P",
                "id": "5720374",
                "issueDateTime": "2023-08-08",
                "issueUnit": "中质协质量保证中心",
                "licenseName": "环境管理体系认证",
                "remark": "",
                "status": "有效",
                "validityDate": "2026-08-31"
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}
```
