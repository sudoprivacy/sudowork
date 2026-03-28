# 水利业绩-相关负责人信息查询

**分类:** 水利业绩
**路径:** `POST /v1/company/personnel/waterStaffList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/personnel/waterStaffList

### 请求方式
POST(application/json)

### 请求参数
****************
| 参数名 | 类型 | 长度 | 必须 | 说明 |
| --- | --- | --- | --- | --- |
| id | Integer | - | 是 | 水利业绩id |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "id":"00544953515410155995554545148569",
  "pageIndex":"1",
  "pageSize":"2"
}

```

### 响应参数
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| professionalPapers | String | 100 | 否 | 证书专业 |
| web | String | 100 | 否 | 来源网站 |
| startTimeProjectPrincipal | Date | - | 否 | 监管：项目负责人任职开始日期 |
| postName | String | 20 | 否 | 职称 |
| name | String | 150 | 否 | 姓名 |
| duty | String | 50 | 否 | 职务 |
| licenseNum | String | 50 | 否 | 证书编号 |
| overTimeProjectPrincipal | Date | - | 否 | 监管：项目负责人任职结束日期 |
| licenseName | String | 50 | 否 | 证书名称 |
| staffId | String | 32 | 否 | 人员id |
| totalCount | Integer | - | 否 | 总条数 |


 

#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 1,
    "list": [
      {
        "professionalPapers": "水利水电工程",
        "web": null,
        "startTimeProjectPrincipal": null,
        "grade": "二级",
        "postName": "工程师",
        "name": "严加南",
        "duty": "项目经理",
        "licenseNum": "05012518",
        "overTimeProjectPrincipal": null,
        "licenseName": "注册建造师",
        "staffId": null
      }
    ]
  }
}

```
