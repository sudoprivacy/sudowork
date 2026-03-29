# 施工工法

**分类:** 知识产权
**路径:** `POST /v1/company/business/sggfList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/business/sggfList

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| companyId | Integer | - | 是 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "companyName":"中建三局集团有限公司",
  "pageIndex":1,
  "pageSize":1
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| level | String | 255 | 是 | 工法级别 |
| org | String | 255 | 是 | 颁发机构 |
| projectJoin | String | 65535 | 否 | 参与人员 |
| name | String | 255 | 是 | 工法名称 |
| publishDateStr | String | 255 | 是 | 发布日期 |
| id | String | 36 | 是 | 工法id |
| typeIndustry | String | 255 | 是 | 行业类型 |
| typeSection | String | 255 | 是 | 工法类别 |
| companyName | String | 255 | 是 | 编制单位 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data":
  {
    "totalCount": 1118,
    "list":
    [
      {
        "level": "省级",
        "projectJoin": "[\"方园\",\"李天兵\",\"宋琦\",\"时亮亮\",\"柳玉廷\"]",
        "org": "[\"河南省土木建筑学会\"]",
        "companyName": "中建三局集团有限公司",
        "name": "民航机场项目全建造周期智慧建造施工工法",
        "publishDateStr": "2021-12-30",
        "id": "00093a4c-0996-11ed-b2f8-b8ca3a614739",
        "typeSection": "土木工程工法",
        "typeIndustry": "土木工程工法"
      },
      {
        "level": "省级",
        "projectJoin": "[\"彭乐\",\"李高钦\",\"郭敏帅\",\"彭文川\",\"黄川江\"]",
        "org": "[\"四川省住房和城乡建设厅\"]",
        "companyName": "中建三局集团有限公司",
        "name": "一次注塑成型检查井预制组合安装工法",
        "publishDateStr": "2015-04-07",
        "id": "0116dbfa-09b0-11ed-b2f8-b8ca3a614739",
        "typeSection": "房屋建筑工程工法",
        "typeIndustry": "工程建设工法"
      }
    ]
  }
}

```
