# 经营异常

**分类:** 经营风险
**路径:** `POST /v1/company/industrial/abnormals`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/abnormals

### 请求方式
POST(application/json)

### 请求参数
****************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
 "companyName":"儋州市莪蔓供销社",
 "pageIndex":1,
 "pageSize":1
}

```

### 响应参数
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| department | String | 1000 | 否 | 列入经营异常做出决定机关 |
| inDate | String | 50 | 否 | 列入日期 |
| inReason | String | 65535 | 否 | 列入经营异常名录原因 json |
| outDate | String | 50 | 否 | 移出日期 |
| outDepartment | String | 100 | 否 | 移出经营异常作出决定机关 |
| outReason | String | 65535 | 否 | 移出经营异常名录原因 json |
| totalCount | Integer | - | 是 | 总条数 |
| uTags | Integer | - | 否 | 状态：0为当前，非0为历史 |


 

#### 返回结果示例

```
{
  "code": 200,
    "data": {
        "list": [
            {
                "department": "儋州市市场监督管理局",
                "id": 737980,
                "inDate": "2015-07-14",
                "inReason": "未依照《企业信息公示暂行条例》第八条规定的期限公示年度报告的",
                "outDate": "",
                "outDepartment": "",
                "outReason": "",
                "uTags": 0
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
