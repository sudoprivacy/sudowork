# 一体化平台业绩-合同登记节点信息查询

**分类:** 一体化业绩
**路径:** `POST /v1/company/results/province/projectContract`
**Content-Type:** `application/json`

### **接口描述**
省级一体化-合同登记信息集合

### **字符编码**
UTF-8

### **请求地址**
/v1/company/results/province/projectContract

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
  "pid": "79231FE904D8666644443B0C543D1B7D",
  "pageIndex":1,
  "pageSize":2
}

### **响应参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| contractType | String | 20 | 否 | 合同类别 |
| dataLevel | String | 10 | 否 | 数据等级 |
| jskEid | String | 20 | 否 | 承包单位id |
| money | String | 20 | 否 | 实际造价（万元） |
| propietorCorpName | String | 150 | 否 | 发包单位名称 |
| contractorCorpName | String | 150 | 否 | 承包单位名称 |
| id | Integer | 11 | 是 | 合同登记id |
| contractDate | String | 20 | 否 | 合同签订日期 |
| propietorCorpCode | String | 255 | 否 | 发包单位统一社会信用代码 |
| contractorCorpCode | String | 255 | 否 | 承包单位统一社会信用代码 |
| contractNo | String | 255 | 否 | 合同编号 |
| scale | String | 255 | 否 | 建设规模 |
| recordNo | String | 200 | 否 | 合同登记编号 |
| recordDate | String | 20 | 否 | 记录登记时间 |
| unionCorpName | String | 255 | 否 | 联合体承包单位名称 |
| unionCorpCode | String | 255 | 否 | 联合体承包单位统一社会信用代码 |
| dataSource | String | 255 | 否 | 数据来源 |
| totalCount | Integer | 11 | 是 | 总条数 |


#### **返回结果示例**
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 1,
    "list": [
      {
        "provinceContractNo": "",
        "money": 913.8285,
        "contractType": "施工总包",
        "jskEid": 6984,
        "contractorCorpName": "丽江乙立建筑装饰有限公司",
        "id": 1,
        "propietorCorpName": "丽江供排水有限公司",
        "dataLevel": "C",
        "contractDate": "2017-5-24 0:00:00", 
        "propietorCorpCode": "91530702219210897C",
        "contractorCorpCode": "91530700713494135Y",
        "contractNo": "",
        "scale": "",
        "recordNo": "HZ001",
        "recordDate": "",
        "unionCorpName": "",
        "dataSource": "历史业绩补录",
        "unionCorpCode": “”
      }
    ]
  }
}
