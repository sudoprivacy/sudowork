# 企业荣誉奖项

**分类:** 荣誉奖项
**路径:** `POST /v1/company/business/award`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/business/award

### 请求方式
POST(application/json)

### 请求参数
****************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 是 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| keywords | String | 255 | 否 | 奖项关键词 |
| type | String | 255 | 否 | 荣誉类型：企业荣誉、工程荣誉、人员荣誉 |
| year | String | 100 | 否 | 发布年份 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "companyName": "中建三局集团有限公司",
  "keywords": "奖",
  "year": "2022" ,
  "pageIndex": 1,
  "pageSize": 1
}

```

### 响应参数
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| city | String | 255 | 否 | 颁奖机构所在市 |
| cityId | Integer | - | 是 | 颁奖机构所在市id |
| companyName | String | 255 | 否 | 企业名称 |
| companyRoles | String | 255 | 否 | 企业角色 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| district | String | 255 | 否 | 颁奖机构所在区县 |
| grade | String | 255 | 否 | 验收等级 |
| href | String | 255 | 否 | 原文链接 |
| id | String | 36 | 是 | 奖项id |
| level | String | 255 | 否 | 奖项级别 |
| name | String | 255 | 否 | 奖项名称 |
| org | String | 255 | 否 | 颁发机构 |
| pathAttachments | String | 255 | 否 | 附件下载地址 |
| projectDirector | String | 255 | 否 | 项目总监 |
| projectJoin | String | 65535 | 否 | 项目参与者 |
| projectManager | String | 255 | 否 | 项目经理 |
| projectName | String | 255 | 否 | 项目名称 |
| projectTech | String | 255 | 否 | 技术负责人 |
| projectType | String | 255 | 否 | 项目类型 |
| provinceCode | String | 255 | 否 | 颁奖机构所在省id |
| publishDate | String | 255 | 否 | 发布时间 |
| source | String | 255 | 否 | 来源网站 |
| type | String | 255 | 否 | 奖项类别 |
| year | String | 100 | 否 | 获奖年度 |
| totalCount | Integer | - | 是 | 总条数 |
| typeSection | String | 255 | 否 | 奖项小类 |
| province | String | 255 | 否 | 颁奖机构所在省 |


#### 返回结果示例

```
{
  "code": 200,
    "data": {
        "list": [
            {
                "city": "南京市",
                "cityId": 320100,
                "companyName": "中建三局集团有限公司",
                "companyRoles": "施工单位",
                "creditCode": "",
                "district": "",
                "grade": "",
                "href": "",
                "id": "dc0560c6-7475-11ed-881a-00163e041d2a",
                "level": "市级",
                "name": "优质结构工程奖",
                "org": "[\"南京建筑业协会\"]",
                "pathAttachments": "",
                "pathSnapshot": "",
                "projectDirector": "",
                "projectJoin": "",
                "projectManager": "[\"张先海\"]",
                "projectName": "南京颐养中心项目一期12#",
                "projectTech": "",
                "projectType": "",
                "province": "江苏省",
                "provinceCode": "320000",
                "publishDate": "2022-11-30",
                "source": "[{\"sourceName\": \"南京建筑业协会\", \"sourceUrl\": \"http://www.njjzyxh.com/article_info.php?n_id=2259\"}]",
                "type": "工程荣誉",
                "typeSection": "优质工程",
                "year": "2022"
            }
        ],
        "totalCount": 219
    },
    "msg": "查询成功"
}

```
