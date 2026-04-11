# 四库备案业绩-施工许可节点信息查询

**分类:** 四库业绩
**路径:** `POST /v1/company/results/skyLicenceList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/skyLicenceList

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |
| pid | String | 32 | 是 | 项目id |


#### 请求示例

```
{
  "pid": 1100000509019901,
  "pageIndex": 1,
  "pageSize": 1
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| area | Double | 15,4 | 否 | 面积（平方米） |
| buildPlanNo | String | 255 | 否 | 建设用地规划许可证编号 |
| provinceLicenceNo | String | 100 | 否 | 施工许可证编号 |
| licenceNo | String | 50 | 是 | 省级施工许可证编号 |
| projectName | String | 255 | 否 | 项目名称 |
| engineeringName | String | 65535 | 否 | 工程名称 |
| projectCode | String | 50 | 否 | 项目代码 |
| pid | String | 32 | 是 | 项目id |
| projectPlanNo | String | 65535 | 否 | 建设工程规划许可证编号 |
| tenderNo | String | 50 | 否 | 中标通知书编号 |
| censorNo | String | 50 | 否 | 施工图审查合格书编号 |
| dataLevel | String | 10 | 否 | 数据等级 |
| releaseDate | Long | 20 | 否 | 发证日期 |
| recordDate | Long | 20 | 否 | 记录登记时间 |
| dataSource | String | 10 | 否 | 数据来源 |
| id | String | 20 | 否 | 施工许可id |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 1,
    "list": [
      {
        "pageIndex": 1,
        "pageSize": 10,
        "licenceNo": "1100000509019901-SX-001",
        "provinceLicenceNo": "[2010]施[朝]建字0009号",
        "projectName": "飞行过山车排队区、渡口码头、雨林天堂变电所",
        "engineeringName": null,
        "projectCode": "",
        "pid": "1100000509019901",
        "buildPlanNo": null,
        "projectPlanNo": "2009规（朝）建字0047号",
        "tenderNo": null,
        "censorNo": null,
        "dataLevel": "D",
        "money": null,
        "area": null,
        "length": null,
        "span": 0,
        "scale": "",
        "releaseDate": 1263455141,
        "recordDate": 1263455141,
        "dataSource": null,
        "checkDepartName": "",
        "checkPersonName": "",
        "id": 4838798
      }
    ]
  }
}

```
