# 小微企业验证

**分类:** 工商信息
**路径:** `POST /v1/company/control/checkSmall`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/control/checkSmall

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 是 | 企业id |
| companyName | String | 255 | 是 | 企业名称 |
| creditCode | String | 255 | 是 | 企业统一社会信用代码 |


#### 请求示例

```
{
  	"companyName":"中国华西工程设计建设有限公司"
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| exist | Boolean | - | 是 | 验证结果 |


#### 返回结果示例

```
{
  "code": 200,
    "data": {
        "exist": false
    },
    "msg": "请求成功"
}

```
