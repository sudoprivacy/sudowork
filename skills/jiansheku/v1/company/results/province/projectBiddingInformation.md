# 一体化平台业绩-招投标节点信息查询

**分类:** 一体化业绩
**路径:** `POST /v1/company/results/province/projectBiddingInformation`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/province/projectBiddingInformation

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 50 | 是 | 项目id |
| pageIndex | Integer | - | 是 | 页数 |
| pageSize | Integer | - | 是 | 条数 |


#### 请求示例

```
{
  "pid": "49302FE904D8666644443B0C543D1B7D",
  "pageIndex":1,
  "pageSize":2
}

```

### 响应参数

 
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| tenderCorpName | String | 255 | 是 | 中标单位名称 |
| jskEid | String | 20 | 是 | 中标单位id |
| tenderType | String | 20 | 否 | 招标类型 |
| tenderWay | String | 20 | 否 | 招标方式 |
| tenderDate | String | 20 | 否 | 中标日期 |
| money | Double | 15,4 | 否 | 中标金额 |
| tenderNo | String | 100 | 否 | 中标通知书编号 |
| dataLevel | String | 10 | 否 | 数据等级 |
| scale | String | 65535 | 否 | 建设规模 |
| area | Double | 15,2 | 否 | 总面积（平方米） |
| agencyCorpName | String | 100 | 否 | 招标代理单位名称 |
| agencyCorpCode | String | 50 | 否 | 招标代理单位统一社会信用代码 |
| tenderCorpCode | String | 255 | 否 | 中标单位统一社会信用代码 |
| pmName | String | 100 | 否 | 项目负责人 |
| recordDate | String | 20 | 否 | 记录登记时间 |
| dataSource | String | 10 | 是 | 数据来源 |
| totalCount | Integer | - | 是 | 总条数 |


 

#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "area": 25430,
                "tenderCorpName": "云南建投第九建设有限公司",
                "pmCardNo": "5301231964******35",
                "pmCardType": "身份证",
                "scale": "总建筑面积为25430㎡",
                "pmName": "王忠群",
                "agencyCorpCode": "",
                "agencyCorpName": "",
                "tenderCorpCode": "915300002165234762",
                "tenderType": "施工",
                "tenderWay": "公开招标",
                "money": 7680.29,
                "tenderDate": "2017-05-24",
                "tenderNo": "云海（2017）中字第023号",
                "jskEid": 78897,
                "recordDate": "",
                "id": 3589,
                "dataSource": "历史业绩补录",
                "provinceTenderNo": "",
                "dataLevel": "A"
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
