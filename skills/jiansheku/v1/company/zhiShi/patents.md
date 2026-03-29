# 专利信息

**分类:** 知识产权
**路径:** `POST /v1/company/zhiShi/patents`
**Content-Type:** `application/json`

### **接口描述**
通过社会信用代码，查询此企业专业信息。

### **字符编码**
UTF-8

### **请求地址**
/v1/company/zhiShi/patents

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 是 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### **请求示例**
{
  "companyName" : "中建三局集团有限公司",
  "pageIndex":"1",
  "pageSize":"1"
}

### **响应参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| brief | String | 65535 | 否 | 专利摘要 |
| outhorDate | String | 20 | 是 | 公布公告日 |
| outhorNum | String | 100 | 是 | 公布公告号 |
| patentName | String | 255 | 是 | 专利名称 |
| requestDate | String | 20 | 是 | 申请日期 |
| authorizeNum | String | 20 | 是 | 授权公告号 |
| authorizeDate | String | 20 | 是 | 授权公告日 |
| patentPerson | String | 65535 | 是 | 当前申请（专利权）人 |
| designer | String | 65535 | 是 | 发明人 |
| agentPeople | String | 255 | 是 | 代理人 |
| agent | String | 255 | 是 | 代理机构 |
| lastStatus | String | 100 | 是 | 最新法律状态 |
| role | String | 50 | 是 | 角色 |
| isHistory | Integer | - | 是 | 是否为历史数据 0当前 非零历史 |
| typeName | String | 100 | 是 | 专利类型名称 |
| requestNum | String | 100 | 是 | 专利申请号 |
| totalCount | Integer | - | 是 | 总条数 |


#### **返回结果示例**
{
    "code": 200,
    "data": {
        "list": [
            {
                "agent": "湖北武汉永嘉专利代理有限公司",
                "agentPeople": "唐万荣;王淳景",
                "authorizeDate": "2017-06-23",
                "authorizeNum": "CN206273766U",
                "brief": "本实用新型公开了一种可适用于多吊机转换的平台基座，包括中心桁架支承座、中心桁架、片状桁架和吊机转换座，所述中心桁架支承座固定安装于其它附着件上，所述中心桁架固定安装在所述中心桁架支承座上，所述片状桁架布设在所述中心桁架上，多个吊机转换座可拆卸安装在所述片状桁架的各端部，所述吊机转换座与安装于其上的吊机相适配。本实用新型根据现场吊装需求，可以灵活匹配吊机型号和吊机数量，多台吊机公用一个基座，扩大了吊机群的吊装范围，减小了吊机群作业的安全风险，适应各型吊机的安装。",
                "designer": "陈波;李霞;杨辉;王建春;巴鑫;夏劲松",
                "isHistory": "0",
                "lastStatus": "授权",
                "outhorDate": "",
                "outhorNum": "",
                "patentName": "一种可适用于多吊机转换的平台基座",
                "patentPerson": "中建三局集团有限公司",
                "requestDate": "2016-10-28",
                "requestNum": "2016211930475",
                "role": "专利权人",
                "type": "syxx",
                "typeName": "中国实用新型专利"
            }
        ],
        "totalCount": 2
    },
    "msg": "查询成功"
}
