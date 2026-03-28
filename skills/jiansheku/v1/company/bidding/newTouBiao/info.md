# 项目开标情况详情查询

**分类:** 招投标信息
**路径:** `POST /v1/company/bidding/newTouBiao/info`
**Content-Type:** `application/json`

### **接口描述**
查询此企业投标详情

### **字符编码**
UTF-8

### **请求地址**
/v1/company/bidding/newTouBiao/info

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名称 | 数据类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Integer | - | 是 | 项目id |


#### **请求示例**
{
  "id": "543405"
}

### **响应参数**
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| publishTime | String | 20 | 否 | 发布时间 |
| province | String | 50 | 否 | 省份 |
| name | String | 500 | 否 | 项目名称 |
| source | String | 255 | 否 | 来源 |
| id | Integer | - | 是 | 项目id |
| url | String | 255 | 否 | 来源链接 |
| content | String | 2000 | 否 | 正文 |
| companys | String | 2000 | 否 | 所有企业json |
| company_id | Integer | - | 否 | 投标企业id |
| project_limittime | String | 500 | 否 | 工期 |
| tender_offer | String | 50 | 否 | 投标报价（万元） |
| company_name | String | 255 | 否 | 投标企业名 |
| project_leader | String | 50 | 否 | 项目负责人 |


#### **返回结果示例**
{
  "code": 200,
  "msg": "请求成功",
  "data": {
    "province": "湖南省",
    "publishTime": "2023-03-17",
    "companys": "[{"company_id": 131471, "company_name": "天韵建设集团有限公司", "project_leader": "刘湘", "project_limittime": null, "tender_offer": null},{"company_id": 60273, "company_name": "长沙广大建筑装饰有限公司", "project_leader": "徐望德", "project_limittime": null, "tender_offer": null},{"company_id": 69201, "company_name": "湖南新宇建筑科技集团有限公司", "project_leader": "李颖鑫", "project_limittime": null, "tender_offer": null},{"company_id": 139140, "company_name": "湖南昌驰建设工程有限公司", "project_leader": "张丽明", "project_limittime": null, "tender_offer": null},{"company_id": 138376, "company_name": "湖南轩达项目管理有限公司", "project_leader": "颜春华", "project_limittime": null, "tender_offer": null},{"company_id": 34034, "company_name": "中南水务工程有限公司", "project_leader": "肖华平", "project_limittime": null, "tender_offer": null},{"company_id": 4402063, "company_name": "湖南铂尚建设工程有限公司", "project_leader": "蒋正旺", "project_limittime": null, "tender_offer": null},{"company_id": 66798, "company_name": "潇湘建工集团有限公司", "project_leader": "全丽娟", "project_limittime": null, "tender_offer": null},{"company_id": 68694, "company_name": "湖南擎天建设工程有限公司", "project_leader": "彭建良", "project_limittime": null, "tender_offer": null},{"company_id": 138765, "company_name": "大象装饰集团有限公司", "project_leader": "袁旭", "project_limittime": null, "tender_offer": null},{"company_id": 131897, "company_name": "湖南省云阳建设工程有限公司", "project_leader": "陈珍艳", "project_limittime": null, "tender_offer": null},{"company_id": 268234, "company_name": "深圳新艺华建筑装饰工程有限公司", "project_leader": "鄢忠", "project_limittime": null, "tender_offer": null},{"company_id": 86373039, "company_name": "湖南新亿建设工程有限公司", "project_leader": "郭艳明", "project_limittime": null, "tender_offer": null},{"company_id": 8442, "company_name": "湖南金马装饰工程有限公司", "project_leader": "刘京", "project_limittime": null, "tender_offer": null},{"company_id": 561518, "company_name": "新卓为（湖南）装饰设计工程有限公司", "project_leader": "祖亚萍", "project_limittime": null, "tender_offer": null},{"company_id": 68808, "company_name": "湖南新城建设工程有限公司", "project_leader": "刘志明", "project_limittime": null, "tender_offer": null},{"company_id": 66662, "company_name": "湖南益阳工程有限公司", "project_leader": "杨志敏", "project_limittime": null, "tender_offer": null},{"company_id": 69212, "company_name": "湖南艺松园建设有限责任公司", "project_leader": "周泉", "project_limittime": null, "tender_offer": null},{"company_id": 66751, "company_name": "湖南华意建筑装修装饰有限公司", "project_leader": "刘林翔", "project_limittime": null, "tender_offer": null},{"company_id": 68851, "company_name": "湖南金辉建设集团有限公司", "project_leader": "彭理", "project_limittime": null, "tender_offer": null},{"company_id": 8645479, "company_name": "湖南立昌建设有限公司", "project_leader": "罗淼斌", "project_limittime": null, "tender_offer": null},{"company_id": 60249, "company_name": "承运建工集团有限公司", "project_leader": "陈赞", "project_limittime": null, "tender_offer": null},{"company_id": 131040, "company_name": "湖南盈通园林工程有限公司", "project_leader": "王小平", "project_limittime": null, "tender_offer": null},{"company_id": 21490, "company_name": "福建省禹澄建设工程有限公司", "project_leader": "黄跃平", "project_limittime": null, "tender_offer": null},{"company_id": 60343, "company_name": "湖南省中南建设装饰有限公司", "project_leader": "戴建国", "project_limittime": null, "tender_offer": null},{"company_id": 38827, "company_name": "湖南省一建园林建设有限公司", "project_leader": "阳凌峰", "project_limittime": null, "tender_offer": null},{"company_id": 68752, "company_name": "湖南良林建设工程有限公司", "project_leader": "曾满红", "project_limittime": null, "tender_offer": null},{"company_id": 60206, "company_name": "湖南东远建设有限公司", "project_leader": "徐哈米", "project_limittime": null, "tender_offer": null},{"company_id": 6689, "company_name": "宏盛建业投资集团有限公司", "project_leader": "陶骏", "project_limittime": null, "tender_offer": null},{"company_id": 392619, "company_name": "中浒尚建工有限公司", "project_leader": "刘卧红", "project_limittime": null, "tender_offer": null},{"company_id": 1258661, "company_name": "湖南凯成建设工程有限公司", "project_leader": "张自军", "project_limittime": null, "tender_offer": null},{"company_id": 39193, "company_name": "深圳市万德建设集团有限公司", "project_leader": "焦东", "project_limittime": null, "tender_offer": null},{"company_id": 56133, "company_name": "美华建设有限公司", "project_leader": "龙飞", "project_limittime": null, "tender_offer": null},{"company_id": 135803, "company_name": "湖南有方建设有限公司", "project_leader": "刘勤", "project_limittime": null, "tender_offer": null},{"company_id": 67096, "company_name": "湖南中巨建设工程有限公司", "project_leader": "李晓丹", "project_limittime": null, "tender_offer": null},{"company_id": 43646, "company_name": "河南颍淮建工有限公司", "project_leader": "孙斌", "project_limittime": null, "tender_offer": null},{"company_id": 135832, "company_name": "湖南弘运建筑有限公司", "project_leader": "刘涛", "project_limittime": null, "tender_offer": null},{"company_id": 69059, "company_name": "湖南诚达建设工程有限公司", "project_leader": "刘静", "project_limittime": null, "tender_offer": null},{"company_id": 135793, "company_name": "湖南百事恒兴建设工程有限公司", "project_leader": "杨焱", "project_limittime": null, "tender_offer": null},{"company_id": 60276, "company_name": "湖南建工集团装饰工程有限公司", "project_leader": "李黎", "project_limittime": null, "tender_offer": null},{"company_id": 69027, "company_name": "湖南速晖建设工程有限公司", "project_leader": "郑锥颖", "project_limittime": null, "tender_offer": null},{"company_id": 1057109, "company_name": "深圳市博大建设集团有限公司", "project_leader": "刘时伟", "project_limittime": null, "tender_offer": null},{"company_id": 10137833, "company_name": "上东国际建设集团有限公司", "project_leader": "张洁", "project_limittime": null, "tender_offer": null},{"company_id": 1077019, "company_name": "中孚泰文化建筑股份有限公司", "project_leader": "胡石君", "project_limittime": null, "tender_offer": null},{"company_id": 66817, "company_name": "湖南六建装饰设计工程有限责任公司", "project_leader": "黄震", "project_limittime": null, "tender_offer": null},{"company_id": 42785, "company_name": "深圳市冠泰装饰集团有限公司", "project_leader": "杨耿光", "project_limittime": null, "tender_offer": null},{"company_id": 4010081, "company_name": "湖南南庭建筑工程有限责任公司", "project_leader": "刘亮华", "project_limittime": null, "tender_offer": null},{"company_id": 1061079, "company_name": "浩天建工集团有限公司", "project_leader": "张银银", "project_limittime": null, "tender_offer": null},{"company_id": 407067, "company_name": "腾鑫建设集团有限公司", "project_leader": "郭增超", "project_limittime": null, "tender_offer": null},{"company_id": 230100, "company_name": "湖南省中翰建设工程有限公司", "project_leader": "龙焱", "project_limittime": null, "tender_offer": null},{"company_id": 68871, "company_name": "湖南兴旺建设有限公司", "project_leader": "陈建", "project_limittime": null, "tender_offer": null},{"company_id": 131300, "company_name": "湖南友盛建设有限公司", "project_leader": "吴星", "project_limittime": null, "tender_offer": null},{"company_id": 137038, "company_name": "湖南金榆佳源园林建设工程有限公司", "project_leader": "刘炳胜", "project_limittime": null, "tender_offer": null},{"company_id": 50383, "company_name": "湖南奉天建设集团有限公司", "project_leader": "夏奇峰", "project_limittime": null, "tender_offer": null},{"company_id": 66876, "company_name": "湖南华天装饰有限公司", "project_leader": "刘琛", "project_limittime": null, "tender_offer": null},{"company_id": 68965, "company_name": "湖南省红日园林建设有限公司", "project_leader": "谢星明", "project_limittime": null, "tender_offer": null},{"company_id": 1258821, "company_name": "湖南军城工程有限公司", "project_leader": "童丽", "project_limittime": null, "tender_offer": null},{"company_id": 21098, "company_name": "深圳市聚豪装饰工程有限公司", "project_leader": "翁鸿杰", "project_limittime": null, "tender_offer": null},{"company_id": 12172, "company_name": "绿椰建设工程集团有限公司", "project_leader": "简书娥", "project_limittime": null, "tender_offer": null},{"company_id": 60239, "company_name": "湖南沙坪装饰有限公司", "project_leader": "李芳", "project_limittime": null, "tender_offer": null},{"company_id": 46532, "company_name": "深圳市金鑫华建设集团有限公司", "project_leader": "沈翀", "project_limittime": null, "tender_offer": null},{"company_id": 68762, "company_name": "湖南省宏星建筑工程有限公司", "project_leader": "周峰", "project_limittime": null, "tender_offer": null}]",
    "id": 543405,
    "source": "全国公共资源交易平台",
    "content": "",
    "url": "http://www.ggzy.gov.cn/information/html/a/430000/0102/202303/17/0043b9646ae90ad24012a5f4b0a83fd44a06.shtml",
    "name": "中岭景苑大楼装修改造项目施工开标记录"
  }
}
