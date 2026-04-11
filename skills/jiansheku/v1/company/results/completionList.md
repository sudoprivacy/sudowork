# 四库备案业绩-竣工验收备案节点信息查询

**分类:** 四库业绩
**路径:** `POST /v1/company/results/completionList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/completionList

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 32 | 是 | 项目id |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "pid": "3101151211210104",
  "pageIndex": 1,
  "pageSize": 2
}

```

### 响应参数
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| area | String | 30 | 否 | 实际面积（平方米） |
| completionNo | String | 50 | 否 | 竣工验收备案编号 |
| dataLevel | String | 10 | 否 | 数据等级 |
| dataSource | String | 10 | 否 | 数据来源 |
| endDate | String | 20 | 否 | 实际竣工验收备案日期 |
| engineeringName | String | 65535 | 否 | 工程名称 |
| length | Double | 15,4 | 否 | 长度（米） |
| licenceNo | String | 50 | 否 | 施工许可证编号 |
| mark | String | 65535 | 否 | 备注 |
| money | Double | 30,4 | 否 | 实际造价（万元） |
| projectCode | String | 32 | 是 | 项目代码 |
| projectName | String | 255 | 否 | 项目名称 |
| provinceCompletionNo | String | 50 | 否 | 省级竣工备案编号 |
| scale | String | 65535 | 否 | 实际建设规模 |
| span | Double | 15,4 | 否 | 跨度（米） |
| startDate | String | 20 | 否 | 实际开工日期 |
| structure | String | 20 | 否 | 结构体系 |
| id | String | 20 | 否 | 竣工验收备案id |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
    "data": {
        "list": [
            {
                "area": "701450.00",
                "completionNo": "3101151211210104-JX-001",
                "dataLevel": "",
                "dataSource": "业务办理",
                "endDate": 1596470400,
                "engineeringName": "上海科技大学新校区一期、中国科学院上海浦东科技园二期项目",
                "id": 0,
                "length": 0.0,
                "licenceNo": "",
                "mark": "",
                "money": -1.0,
                "projectCode": "",
                "projectName": "上海科技大学新校区一期、中国科学院上海浦东科技园二期项目",
                "provinceCompletionNo": "2020ZZ0028",
                "scale": "-",
                "span": 0.0,
                "startDate": -2209017600,
                "structure": ""
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
