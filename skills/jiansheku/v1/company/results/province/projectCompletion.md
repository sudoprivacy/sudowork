# 一体化平台业绩-竣工验收列表

**分类:** 一体化业绩
**路径:** `POST /v1/company/results/province/projectCompletion`
**Content-Type:** `application/json`

### **接口描述**
省级一体化竣工验收集合

### **字符编码**
UTF-8

### **请求地址**
/v1/company/results/province/projectCompletion

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 32 | 是 | 项目id |
| pageIndex | Integer | - | 是 | 页数 |
| pageSize | Integer | - | 是 | 条数 |


#### **请求示例**
{
  "pid": "0000963e04002f5950b77aa8f9ea17c2",
  "pageIndex": 1,
  "pageSize": 1,
}

### **响应参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| area | Double | 15,2 | 否 | 实际面积（平方米） |
| money | Double | 15,4 | 否 | 金额（万元） |
| overDate | String | 20 | 否 | 实际竣工日期 |
| licenceNo | String | 32 | 否 | 施工许可证编号 |
| dataLevel | String | 10 | 否 | 数据等级 |
| structure | String | 20 | 否 | 结构体系 |
| length | String | 20 | 否 | 长度（米） |
| scale | String | 20 | 否 | 建设规模 |
| completionCheckNo | String | 200 | 否 | 竣工验收编号 |
| workDate | String | 20 | 否 | 实际开工日期 |
| projectCode | String | 20 | 否 | 项目代码 |
| mark | String | 20 | 否 | 备注 |
| span | String | 20 | 否 | 跨度（米） |
| id | String | 20 | 否 | 竣工验收id |
| totalCount | Integer | - | 是 | 总条数 |


#### **返回结果示例**
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 2,
    "list": [
      {
        "area": 525.000000,
        "overDate": "2022-12-01",
        "money": 2674.5779,
        "id": 110986,
        "licenceNo": "330100201903220118",
        "dataLevel": "",
        "structure": "其他",
        "length":"", 
        "scale":"项目位于庆春路与大学路交叉路口，为人行过街通道，主通道净宽6.2m，净高3.0m，顶管通道32.74m，工作井2座，出入口4处。", 
        "relationId":"e752d714deec12522d398b6ed5f6b3c5", 
        "completionCheckNo":"2016-330100-48-01-028683-000-JX-001", 
        "workDate":"2019-03-25 00:00:00", 
        "projectCode":"2016-330100-48-01-028683-000", 
        "mark":"", 
        "span":""  
      }
    ]
  }
}
