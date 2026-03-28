# 注册人员数量统计查询

**分类:** 执业人员
**路径:** `POST /v1/company/personnel/aqy`
**Content-Type:** `application/json`

### **接口描述**
通过企业id、人员姓名、人员类型，查询此企业注册人员数量统计信息。

### **字符编码**
UTF-8

### **请求地址**
/v1/company/personnel/aqy

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业Id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |

 

#### **请求示例**
{
  "companyName": "吉林安装集团股份有限公司"
}

### **响应参数**
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| ejjg | Integer | - | 是 | 二级注册结构工程师人数 |
| ejjzrs | Integer | - | 是 | 二级注册建造师人数 |
| ejzcjzsrs | Integer | - | 是 | 二级注册建筑师人数 |
| gysb | Integer | - | 是 | 注册公用设备工程师人数 |
| yjjg | Integer | - | 是 | 一级注册结构工程师人数 |
| yjjzrs | Integer | - | 是 | 一级注册建造师人数 |
| yjzcjzsrs | Integer | - | 是 | 一级注册建筑师人数 |
| zcdq | Integer | - | 是 | 注册电气工程师人数 |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |


#### **返回结果示例**
{
    "code": 200,
    "data": {
        "companyName": "吉林安装集团股份有限公司",
        "creditCode": "91220000744574795A",
        "ejjg": 0,
        "ejjzrs": 0,
        "ejzcjzsrs": 0,
        "gysb": 0,
        "yjjg": 0,
        "yjjzrs": 0,
        "yjzcjzsrs": 0,
        "zcdq": 0
    },
    "msg": "请求成功"
}
返回code码见 API 前置说明
