# 企业资质信息（带来源网站查询）

**分类:** 企业资质
**路径:** `POST /v1/company/qualification/buildCertSource`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/qualification/buildCertSource

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| category | Integer | - | 否 | 资质类别 |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| source | String |  | 是 | 来源网站 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |
| validityDateEnd | String | 20 | 否 | 到期时间止 yyyy-MM-dd |
| validityDateStart | String | 20 | 否 | 到期时间起yyyy-MM-dd |

 

#### 请求示例

```
{
  "pageIndex":1,
  "pageSize":1,
  "companyName":"中建三局集团有限公司",
  "source":"全国建筑市场监管公共服务平台",
  "validityDateStart":"2023-06-15",
  "validityDateEnd":"2023-12-31"
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| authority | String | 120 | 否 | 颁发机构 |
| category | String | 20 | 是 | 资质类别 |
| certName | String | 70 | 是 | 资质名称 |
| certificateNo | String | 80 | 否 | 证书编号 |
| id | String | 20 | 是 | 资质id |
| issueDateTime | String | 20 | 否 | 发证时间yyyy-MM-dd |
| level | String | 20 | 否 | 资质等级 |
| major | String | 20 | 否 | 资质小类 |
| profession | String | 20 | 否 | 资质专业 |
| source | String | 100 |  | 来源网站 |
| type | String | 20 | 否 | 资质大类 |
| validityDate | String | 20 | 否 | 到期时间 yyyy-MM-dd |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| certStatus | String | 20 | 否 | 证书状态：有效，未知，过期 |
| totalCount | Integer |  | 是 | 总条数 |


####  

#### 返回结果示例

```
{
  "code": 200,
  "data": {
    "list": [
      {
        "authority": "住房和城乡建设部",
        "category": "建筑业企业资质",
        "certName": "建筑工程施工总承包",
        "certStatus": "有效",
        "certificateNo": "D142011823",
        "companyName": "中建三局集团有限公司",
        "creditCode": "91420000757013137P",
        "id": 35192154,
        "issueDateTime": "2023-12-22",
        "level": "特级",
        "levelValue": 0,
        "limitText": "",
        "major": "建筑工程施工总承包",
        "profession": "",
        "type": "施工总承包",
        "validityDate": "2028-12-22"
      },
      {
        "authority": "住房和城乡建设部",
        "category": "建筑业企业资质",
        "certName": "公路工程施工总承包",
        "certStatus": "有效",
        "certificateNo": "D142011823",
        "companyName": "中建三局集团有限公司",
        "creditCode": "91420000757013137P",
        "id": 35192300,
        "issueDateTime": "2023-12-22",
        "level": "特级",
        "levelValue": 0,
        "limitText": "",
        "major": "公路工程施工总承包",
        "profession": "",
        "type": "施工总承包",
        "validityDate": "2028-12-22"
      },
      {
        "authority": "住房和城乡建设部",
        "category": "建筑业企业资质",
        "certName": "市政公用工程施工总承包",
        "certStatus": "有效",
        "certificateNo": "D142011823",
        "companyName": "中建三局集团有限公司",
        "creditCode": "91420000757013137P",
        "id": 35192301,
        "issueDateTime": "2023-12-22",
        "level": "特级",
        "levelValue": 0,
        "limitText": "",
        "major": "市政公用工程施工总承包",
        "profession": "",
        "type": "施工总承包",
        "validityDate": "2028-12-22"
      }
    ],
    "totalCount": 34
  },
  "msg": "操作成功"
}
```
