# 一体化平台业绩-施工图审查节点信息查询

**分类:** 一体化业绩
**路径:** `POST /v1/company/results/province/projectExamination`
**Content-Type:** `application/json`

### **接口描述**
省级一体化施工图审查信息集合

### **字符编码**
UTF-8

### **请求地址**
/v1/company/results/province/projectExamination

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 50 | 是 | 项目id |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### **请求示例**
{
  "pid": "36541FE904D8666644443B0C543D1B7D",
  "pageIndex":1,
  "pageSize":2
}

### **响应参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| recordDate | String | 20 | 否 | 记录登记时间 |
| onePass | Integer | - | 否 | 一次审查是否通过 通过为 1； 不通过为 0 |
| censorNo | String | 100 | 否 | 施工图审查合格书编号 |
| censorCorpName | String | 150 | 否 | 施工图审查机构名称 |
| censorDate | String | 20 | 否 | 审查完成时间 |
| dataLevel | String | 10 | 否 | 数据等级 |
| oneViolationEntryCount | Integer | - | 否 | 一次审查时违反强制性标准条目 |
| rfCensorNo | String | 50 | 否 | 人防设计审核合格证书编号 |
| isUnion | String | 2 | 否 | 是否联合审查（0：否 1：是） |
| rfCensorCorpName | String | 50 | 否 | 人防设计审核机构 |
| scale | String | 65535 | 否 | 建设规模 |
| xfCensorNo | String | 50 | 否 | 消防设计审核合格证书编号 |
| xfCensorCorpName | String | 50 | 否 | 消防审查机构 |
| censorCorpCode | String | 50 | 否 | 审图机构统一社会信用代码 |
| oneViolationCount | Integer | - | 否 | 一次审查时违反强制性标准数 |
| xfCensorDate | String | 20 | 否 | 消防设计审核时间 |
| rfCensorDate | String | 20 | 否 | 人防设计审核时间 |
| dataSource | String | 10 | 否 | 数据来源 |
| id | Integer | - | 是 | 施工图审查id |
| totalCount | Integer | - | 是 | 总条数 |


### 
 

#### **返回结果示例**
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 2,
    "list": [
      {
        "id": 1,
        "dataLevel": "B",
        "censorNo": "YST-6768-FSJ-111",
        "censorCorpName": "普洱市建筑勘察设计院",
        "onePass": "1",
        "censorDate": "2016-12-26",
        "recordDate": "",
        "oneViolationEntryCount": "",
        "rfCensorNo": "",
        "isUnion": "0",
        "rfCensorCorpName": "",
        "scale": "18976.42平方米",
        "xfCensorNo": "",
        "relationId": "d270e2cefdd809d36a2ef8d86b37ef24",
        "xfCensorCorpName": "",
        "censorCorpCode": "91530800218350951Y",
        "oneViolationCount": "",
        "xfCensorDate": "",
        "rfCensorDate": "",
        "dataSource":"历史业绩补录"  
      }
    ]
  }
}
