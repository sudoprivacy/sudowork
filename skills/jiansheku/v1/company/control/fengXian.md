# 企业三要素验证

**分类:** 工商信息
**路径:** `POST /v1/company/control/fengXian`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/control/fengXian

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| corporatePerson | String | 255 | 是 | 法人 |
| companyName | String | 255 | 是 | 企业名称 |
| creditCode | String | 255 | 是 | 企业统一社会信用代码 |


#### 请求示例

```
{
  	"companyName":"中国华西工程设计建设有限公司",
	"creditCode":"91510000201803520Y",
	"corporatePerson":"周华"
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
        "exist": true
    },
    "msg": "请求成功"
}

```
