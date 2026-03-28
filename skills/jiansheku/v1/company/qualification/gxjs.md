# 高新技术企业

**分类:** 企业资质
**路径:** `POST /v1/company/qualification/gxjs`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/qualification/gxjs

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

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| certificateNo | string | 100 | 否 | 证书编号 |
| id | string | 20 | 否 | 资质id |
| issueDateTime | string | 64 | 否 | 发证日期 |
| issueUnit | string | 64 | 否 | 发证机关 |
| licenseName | string | 64 | 否 | 证书名称 |
| remark | string | 64 | 否 | 备注 |
| status | string | 50 | 否 | 证书状态: 1.未知,2.有效,3.过期,4.撤销,5.其他 |
| validityDate | string | 64 | 否 | 证书有效期截止日 |
| totalCount | integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "certificateNo": "GR201642001346",
                "id": "675849",
                "issueDateTime": "2016-12-13",
                "issueUnit": "",
                "licenseName": "",
                "remark": "",
                "status": "过期",
                "validityDate": "2019-12-13"
            }
        ],
        "totalCount": 3
    },
    "msg": "查询成功"
}

```
