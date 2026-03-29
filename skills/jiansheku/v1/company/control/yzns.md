# A级纳税人核验

**分类:** 诚实守信
**路径:** `POST /v1/company/control/yzns`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/control/yzns

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 是 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |


#### 请求示例

```
{
  	"companyName":"海南第二建设工程有限公司"

```
} 
 

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
返回code码见 API 前置说明
