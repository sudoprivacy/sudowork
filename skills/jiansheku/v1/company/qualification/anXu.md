# 建筑安全生产许可证

**分类:** 企业资质
**路径:** `POST /v1/company/qualification/anXu`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/qualification/anXu

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| certStatus | string | 255 | 否 | 证书状态 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "pageIndex":1,
  "pageSize":1,
  "certStatus":"有效",
  "companyName":"中建三局集团有限公司"
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| certNo | String | 80 | 是 | 证书编号 |
| companyAddr | String | 255 | 否 | 企业工商地址 |
| companyName | String | 255 | 是 | 单位名称 |
| issueDate | String | 20 | 是 | 发证日期 |
| majorManager | String | 20 | 否 | 主要负责人 |
| validityDate | String | 20 | 否 | 证书有效期 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| certStatus | String | 20 | 否 | 证书状态：有效，未知，过期 |
| totalCount | Integer | - | 是 | 总条数 |


 

### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "certNo": "（鄂）JZ安许证字【2005】000115",
                "certStatus": "有效",
                "companyAddr": "武汉市关山路552号",
                "companyName": "中建三局集团有限公司",
                "creditCode": "91420000757013137P",
                "issueDate": "2022-09-16",
                "majorManager": "陈卫国",
                "validityDate": "2025-09-16"
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
