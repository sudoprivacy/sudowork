# 企业备案地核验

**分类:** 经营信息
**路径:** `POST /v1/company/control/checkAddress`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/control/checkAddress

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 是 | 企业id |
| provinceId | Integer | - | 是 | 省级行政编码 |
| creditCode | String | 255 | 是 | 企业统一社会信用代码 |


#### 请求示例

```
{
  	"cid":"11627",	
	"creditCode":"91510000201803520Y",
	"provinceId":"510000"
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
