# 一体化平台业绩-施工许可节点信息查询

**分类:** 一体化业绩
**路径:** `POST /v1/company/results/province/sgxk`
**Content-Type:** `application/json`

### **接口描述**
省级一体化施工施工许可集合

### **字符编码**
UTF-8

### **请求地址**
/v1/company/results/province/sgxk

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 50 | 是 | 项目id |
| pageIndex | Integer | - | 是 | 页数 |
| pageSize | Integer | - | 是 | 条数 |


#### **请求示例**
{
   "pid": "b263d4a74e5861c82a025ece10ae624f",
   "pageIndex":1,
   "pageSize":2
}

### **响应参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| area | Double | 15,2 | 否 | 实际面积（平方米） |
| money | Double | 15,4 | 否 | 金额（万元） |
| releaseDate | String | 20 | 否 | 发证日期 |
| licenceNo | String | 255 | 否 | 施工许可证编号 |
| dataLevel | String | 10 | 否 | 数据等级 |
| tenderNo | String | 200 | 否 | 中标通知书号 |
| buildPlanNo | String | 200 | 否 | 建设用地规划许可证编号 |
| recordDate | String | 20 | 否 | 记录登记时间 |
| dataSource | String | 255 | 否 | 数据来源 |
| span | String | 25 | 否 | 跨度 |
| companyName1 | String | 255 | 否 | 总监理所属单位 |
| zj | String | 255 | 否 | 总监理 |
| pm | String | 255 | 否 | 项目经理 |
| contractDuration | String | 20 | 否 | 合同工期（天） |
| length | String | 25 | 否 | 长度（米） |
| scale | String | 25 | 否 | 建筑规模（平方米） |
| censorNo | String | 255 | 否 | 施工图审查编号 |
| projectCode | String | 255 | 否 | 项目代码 |
| company2 | String | 255 | 否 | 项目经理所属单位 |
| id | String | 25 | 是 | 施工许可id |
| totalCount | Integer | - | 是 | 总条数 |


 

#### **返回结果示例**
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 1,
    "list": [
      {
        "area": "",
        "money": 2962.8,
        "releaseDate": "2017-1-24",
        "relationId": "145f998d7ae29009a8a24ba627139d4d",
        "id": 287780,
        "licenceNo": "430200201701240302",
        "dataLevel": "B",
        "contractDuration": "",
        "length":"",
        "scale":"",  
        "censorNo":"",
        "projectCode":"",
        "tenderNo":"",
        "buildPlanNo":"",
        "recordDate":"",
        "dataSource":"",
        "span":"",
        "companyName1":"湖南联合工程管理有限公司",
        "zj":"蔡金钒",
        "company2":"",
        "pm":""  
      }
    ]
  }
}
