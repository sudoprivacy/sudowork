# 分支机构查询

**分类:** 工商信息
**路径:** `POST /v1/company/industrial/branches`
**Content-Type:** `application/json`

### **分支机构查询**

### **接口描述**
根据企业查企业分支机构

### **字符编码**
UTF-8

### **请求地址**
/v1/company/industrial/branches

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |

 

#### **请求示例**
{
  "companyName":"中电建建筑集团有限公司",
  "pageIndex":"1",
  "pageSize":"2"
}

### **响应参数**
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| belongOrg | String | 255 | 否 | 登记机关 |
| creditNo | String | 255 | 否 | 企业统一社会信用代码 |
| name | String | 255 | 否 | 分支机构名称 |
| operName | String | 255 | 否 | 分支机构负责人 |
| regNo | String | 255 | 是 | 注册号 |
| registCapi | String | 255 | 否 | 注册资本 |
| startDate | String | 255 | 是 | 成立日期 |
| status | String | 50 | 否 | 企业状态 |
| subEid | String | 36 | 否 | 分支机构eid |
| totalCount | integer | - | 是 | 总条数 |


#### **返回结果示例**
{
                "belongOrg": "北京市房山区市场监督管理局",
                "creditNo": "91110111MADFCG388E",
                "name": "中电建建筑集团有限公司北京房山分公司",
                "operName": "侯金鹏",
                "regNo": "110111041336914",
                "registCapi": "",
                "startDate": "2024-04-11",
                "status": "存续（在营、开业、在册）",
                "subEid": "a8477afa-563d-4121-b0e8-b5db54ccde8c"
            },
            {
                "belongOrg": "廊坊市霸州市市场监督管理局",
                "creditNo": "91131081MADDKFHM08",
                "name": "中电建建筑集团有限公司霸州分公司",
                "operName": "刘晓飞",
                "regNo": "131081300048156",
                "registCapi": "",
                "startDate": "2024-03-15",
                "status": "存续（在营、开业、在册）",
                "subEid": "c5ca05c1-f6a2-4a4b-9f3b-755d97811ad8"
            }
        ],
        "totalCount": 55
    },
    "msg": "查询成功"
}
返回code码见 API 前置说明
