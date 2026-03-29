# 企业资质信息

**分类:** 企业资质
**路径:** `POST /v1/company/qualification/buildCert`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/qualification/buildCert

### 请求方式
POST(application/json)

### 请求参数



































| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| category | Integer | - | 否 | 资质类别209 建筑业企业资质211 工程勘察213 工程设计215 工程监理219 设计施工一体化企业资质221 造价咨询企业资质1817 展览工程1819 文物保护资质1821 电力业务许可证1823 承装（修、试）电力设施许可证1827 地质灾害治理工程1831 消防技术服务机构1879 安防工程资质1889 信息系统集成及服务1921 特种设备安装改造维修许可1951 爆破从业单位资质2003 城乡规划编制资质2009 水文、水资源调查评价资质2041 测绘资质2163 施工劳务资质2859 工程咨询资信单位资质3115 itss信息技术服务标准3144 重庆公路养护资质3167 房地产开发资质3174 房地产估价机构资质3188 公路水运工程试验检测机构3305 地质勘查资质3477 公路养护从业资格3508 工程质量检测资质3662 博物馆陈列展览资质3881 重庆园林绿化资质3905 质量检测机构3936 水利工程质量检测资质 |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
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
