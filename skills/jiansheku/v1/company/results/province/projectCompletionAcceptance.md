# 一体化平台业绩-竣工验收备案集合

**分类:** 一体化业绩
**路径:** `POST /v1/company/results/province/projectCompletionAcceptance`
**Content-Type:** `application/json`

### **接口描述**
省级一体化竣工验收备案集合。

### **字符编码**
UTF-8

### **请求地址**
/v1/company/results/province/projectCompletionAcceptance

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
  "pid": "431003FT3R4EQ9RF6JRD4RF0C543D1B7D",
  "pageIndex":1,
  "pageSize":2
}

### **响应参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| area | Double | 20,4 | 否 | 实际面积（平方米） |
| overDate | String | 20 | 否 | 实际竣工验收日期 |
| length | String | 50 | 否 | 长度（米） |
| money | Double | 15,4 | 否 | 实际造价（万元） |
| completionNo | String | 100 | 否 | 竣工备案编号 |
| id | Integer | 11 | 否 | 竣工验收备案id |
| licenceNo | String | 150 | 否 | 施工许可编号 |
| dataLevel | String | 10 | 否 | 数据等级 |
| structure | String | 10 | 否 | 结构体系 |
| workDate | String | 10 | 否 | 实际开工日期 |
| mark | String | 10 | 否 | 备注 |
| span | String | 10 | 否 | 跨度 |
| scale | String | 100 | 否 | 建筑规模 |
| totalCount | Integer | 11 | 是 | 总条数 |

 

#### **返回结果示例**
{
  "code": 200,
  "msg": "成功",
  "data": {
    "totalCount": 1,
    "list": [
      {
        "area": 7812.01,
        "overDate": "2019-12-20",
        "money": 388.439,
        "id": 1,
        "licenceNo": "5328012018112002010110",
        "completionNo":"H5328012003170077JX013",  
        "dataLevel": "C",
        "structure": "",
        "length":"", 
        "scale":"", 
        "relationId":"bfc12e0083e837b3159755e506b87df6", 
        "structure":"框架结构", 
        "workDate":"2017-02-15", 
        "mark":"",   
        "span":""  
      }
    ]
  }
}
