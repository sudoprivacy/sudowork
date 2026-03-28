# 四库业绩-项目基本信息详情查询

**分类:** 四库业绩
**路径:** `POST /v1/company/results/skyPro`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/skyPro

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | String | 50 | 是 | 项目id |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "id": 1504021705220148,
  "pageIndex": 1,
  "pageSize": 2
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| address | String | 255 | 否 | 项目具体地点 |
| approvalDate | Long | - | 否 | 立项批复时间 |
| approvalDepart | String | 200 | 否 | 立项批复机关 |
| approvalLevel | String | 10 | 否 | 立项等级 |
| approvalNo | String | 255 | 否 | 立项文号 |
| area | Double | 20,2 | 否 | 总面积（平方米） |
| buildCorpCode | String | 50 | 否 | 建设单位统一信用社会代码 |
| buildCorpName | String | 150 | 否 | 建设单位 |
| buildPlanNo | String | 255 | 否 | 建设用地规划许可证编号 |
| dataLevel | String | 10 | 否 | 数据等级 |
| dataSource | String | 10 | 否 | 数据来源 |
| division | String | 50 | 否 | 行政区划 |
| energySaveInfo | String | 65535 | 否 | 建筑节能信息 |
| fundSource | String | 200 | 否 | 资金来源 |
| id | String | 20 | 否 | 项目id |
| invest | Double | 15,2 | 否 | 总投资（万元） |
| isMajor | Integer | - | 否 | 0-非重点项目 1-重点项目 默认为 0 |
| length | Double | 15,2 | 否 | 总长度（米） |
| locationX | String | 30 | 否 | 经度 |
| locationY | String | 30 | 否 | 纬度 |
| nationalPercentTage | Double | 15,2 | 否 | 国有资金出自比例 |
| nature | String | 32 | 否 | 建设性质 |
| planEndDate | Long | - | 否 | 计划竣工日期 |
| planStartDate | Long | - | 否 | 计划开工日期 |
| projectCode | String | 100 | 否 | 项目代码 |
| projectPlanNo | String | 200 | 否 | 建设工程规划许可证编号 |
| projectType | String | 32 | 否 | 项目分类 |
| purpose | String | 32 | 否 | 工程用途 |
| scale | String | 65535 | 否 | 建设规模 |
| transfiniteInfo | String | 65535 | 否 | 超限项目信息 |


#### 返回结果示例

```
{
    "code":200,
    "data":[
        {
            "address":"",
            "approvalDate":0,
            "approvalDepart":"",
            "approvalLevel":"",
            "approvalNo":"",
            "area":4237.4,
            "buildCorpCode":"",
            "buildCorpName":"红山区教育局",
            "buildPlanNo":"",
            "dataLevel":"D",
            "dataSource":"",
            "division":"内蒙古自治区赤峰市红山区",
            "energySaveInfo":"",
            "fundSource":"",
            "id":"1504021705220148",
            "invest":620.23,
            "isMajor":0,
            "length":0,
            "locationX":"",
            "locationY":"",
            "nationalPercentTage":0,
            "nature":"",
            "planEndDate":0,
            "planStartDate":0,
            "projectCode":"",
            "projectPlanNo":"",
            "projectType":"房屋建筑工程",
            "purpose":"",
            "scale":"4237.4",
            "transfiniteInfo":""
        }
    ],
    "msg":"操作成功"
}
```
