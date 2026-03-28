# 建筑企业资质验证

**分类:** 企业资质
**路径:** `POST /v1/company/control/yzjzqy`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/control/yzjzqy

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| certName | String | 255 | 是 | 资质名称 |
| companyName | String | 255 | 是 | 企业名称 |
| creditCode | String | 255 | 是 | 企业统一社会信用代码 |


#### 请求示例

```
{
  	"companyName":"海南海顺实业开发有限公司",
	"creditCode":"91469031747750002M",
	"certName":"矿山工程施工总承包二级"
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
