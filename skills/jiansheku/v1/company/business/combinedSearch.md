# 组合查询

**分类:** 经营信息
**路径:** `POST /v1/company/business/combinedSearch`
**Content-Type:** `application/json`

### **请求地址**
/v1/company/business/combinedSearch

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | String | 65535 | 是 | 分页对象 json |
| personnelCertificateQueryDto | String | 65535 | 否 | 人员证书专查对象json |
| composePersonnelQueryDto | String | 65535 | 否 | 项目负责人 人员对象json |
| enterpriseAchievementQueryDto | List | - | 否 | 四库业绩数组对象json |
| badBehaviorEname | string | 255 | 否 | 不良行为企业名称 |
| badBehaviors | List | - | 否 | 不良行为对象json |
| creditEvaluates | List | - | 否 | 信用评价数组对象json |
| creditEvaluateType | string | 20 | 否 | 信用评价 同时具备and、任意均可or |
| recentlyBidQueryDto | List | - | 否 | 最近中标数组对象 json |
| awardQueryDtos | List | - | 否 | 荣誉数组对象 |
| awardQueryType | string | 20 | 是 | 荣誉的同时具备and、任意均可or |
| achievementQueryType | string | 20 | 是 | 业绩的同时具备and、任意均可or |
| eid | string | 45 | 否 | 符合条件的业绩的企业id |
| basicAchievements | List | - | 否 | 全平台业绩筛选对象 |
| yitihuaAchievements | List | - | 否 | 一体化业绩 |
| jiangxiBidQueryDto | List | - | 否 | 江西中标业绩对象 |
| businessInfoDto | String | 65535 | 否 | 工商信息 businessInfoDto |
| shuiliAchievements | List | - | 否 | 水利业绩筛选实体 |
| yitihuaSource | String | 255 | 否 | 一体化来源 |
| exportSource | String | 255 | 否 | 导出来源 |
| exportCount | String | 255 | 是 | 导出条数 |
| exportExeclName | String | 255 | 是 | 导出表格名称 |
| goodBehaviorDto | String | 65535 | 是 | 良好行为对象 json |

 
businessInfoDto：工商信息
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| businessStatus | String | 200 | 否 | 登记状态 |
| companyType | String | 200 | 否 | 企业类型 |
| startInsuredNum | Integer | - | 否 | 参保人数 起 |
| endInsuredNum | Integer | - | 否 | 参保人数 止 |
| province | String | 255 | 否 | 注册地 省级code 多个逗号隔开 |
| city | String | 255 | 否 | 注册地 市级code 多个逗号隔开 |
| county | String | 255 | 否 | 注册地 区级code 多个逗号隔开 |
| registeredCapital | String | 255 | 否 | 注册资金 |
| startRegisteredDate | String | 255 | 否 | 成立日期 开始 |
| endRegisteredDate | String | 255 | 否 | 成立日期 结束 |
| aptitudeSource | String | 255 | 否 | old/new 资质查询范围 old旧表 new新表 |
| businessScope | String | 255 | 否 | 经营范围 多个关键词空格隔开 |
| businessScopeQueryType | String | 20 | 否 | 经营范围 and/or |

creditEvaluates：信用评价对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| type | String | 255 | 否 | 企业类型 |
| dataSource | String | 255 | 否 | 来源网站 |
| attribute | String | 255 | 否 | 评价类型 |
| rankOrLevel | String | 255 | 否 | 分值或者等级 |
| startYear | String | 20 | 否 | 开始年份 |
| endYear | String | 20 | 否 | 结束年份 |

badBehaviors：不良行为对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| type | String | 255 | 否 | 类别 |
| subclass | String | 255 | 否 | 小类 |
| punishType | String | 255 | 否 | 具体类型 |
| contentInfo | String | 65535 | 否 | 关键词 空格隔开 |
| startTime | String | 20 | 否 | 行为开始时间 |
| endTime | String | 20 | 否 | 行为结束时间 |

goodBehaviorDto：良好行为对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| systemType | String | 255 | 是 | [1,2,3,4]"1 质量管理体系认证（ISO9000）2 环境管理体系 3 职业安全管理体系 4建设施工行业质量管理体系认证 |
| systemTypeStr | String | 255 | 是 | 1,2,3,4 多个逗号隔开 1 质量管理体系认证（ISO9000）2 环境管理体系 3 职业安全管理体系 4建设施工行业质量管理体系认证 |
| systemQueryType | String | 255 | 是 | 三体系查询方式 同时具备and、任意均可or |
| taxYear | String | 255 | 是 | A级纳税人 年份 多个逗号隔开 |
| isHighTech | String | 20 | 是 | 是否高新技术企业 0否 1是 |
| taxYearQueryType | String | 20 | 是 | A级纳税人 同时具备and、任意均可or |

awardQueryDtos：人员荣誉集合
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| awardDtos | String | - | 否 | 分页对象 json |
| awardDtos.type | String | 255 | 否 | 荣誉类型 |
| awardDtos.level | String | 255 | 否 | 奖项级别 |
| awardDtos.provinceStr | String | 255 | 否 | 省份列表 |
| awardDtos.cityStr | String | 255 | 否 | 城市列表 |
| awardDtos.sectionType | String | 255 | 否 | 奖项小类 |
| awardDtos.industryTypeStr | String | 255 | 否 | 行业类型 |
| awardDtos.nameStr | String | 255 | 否 | 荣誉名称列表 |
| awardDtos.gradeStr | String | 255 | 否 | 验收等级 |
| awardDtos.organizationStr | String | 255 | 否 | 颁发机构 |
| awardDtos.companyRole | String | 255 | 否 | 企业角色 |
| awardDtos.startPublishDate | String | 255 | 否 | 开始发布时间 |
| awardDtos.endPublishDate | String | 255 | 否 | 结束时间 |
| awardDtos.yearBegin | Integer | - | 否 | 获奖起始年度 |
| awardDtos.yearOver | Integer | - | 否 | 获奖截止年度 |
| awardDtos.awardNum | Integer | - | 否 | 符合荣誉条件的数量 |
| awardDtoType | String | - | 是 | 荣誉的同时具备： and，任意均可or |

 
composePersonnelQueryDto：项目负责人人员对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| domicile | String | 200 | 否 | 企业注册地 |
| domicileNum | String | 255 | 否 | 备案地代码 单选示例 500000 多选示例: 500000,xxxx |
| domicileCity | String | 255 | 否 | 本地的注册市 |
| registerProvince | String | 255 | 否 | 外地企业注册省 |
| registerCity | String | 255 | 否 | 外地企业注册市 |
| registerQueryType | String | 20 | 否 | 注册证书 and/or |
| registers | List | - | 否 | 人员信息集合 |
| registers.personType | String | 255 | 否 | 来源 |
| registers.registerSpecialty | String | 255 | 否 | 注册专业 |
| registers.registerName | String | 255 | 否 | 类型名称 |
| awardQueryDtos | List | - |  | 荣誉集合 |
| personAwardQueryType | String | 20 | 否 | 荣誉的同时具备and、任意均可or |
| achievementQueryType | String | 20 | 否 | 人员业绩同时具备and 任意均可 or |
| enterpriseAchievementQueryDto | List | - | 否 | 四库业绩对象json集合 |
| recentlyBidQueryDto | List | - | 否 | 最新中标业绩对象json集合 |
| basicAchievements | List | - | 否 | 全平台业绩对象json集合 |
| yitihuaAchievements | List | - | 否 | 一体化业绩对象json集合 对应建设库福建和江西 |
| jiangxiBidQueryDto | List | - | 否 | 江西中标业绩对象json集合 |
| shuiliAchievements | List | - | 否 | 水利业绩对象json集合 |
| isSame | Boolean | - | 否 | 是否与企业业绩一致 是true 否false |
| achievementCount | Integer | - | 否 | 勾选与企业业绩一致后的数量 |
| yitihuaSource | String | 2 | 否 | 一体化来源 |

 
shuiliAchievements：水利业绩对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| ename | String | 255 | 否 | 参建单位 多个空格隔开 |
| buildCorpName | String | 255 | 否 | 建设单位 多个空格隔开 |
| achievementType | String | 255 | 否 | 项目类型 单个 |
| projectType | String | 255 | 否 | 工程类型 多个空格分隔 例：房屋建设 市政工程 |
| projectStatus | String | 255 | 否 | 项目状态 多个空格分隔 例：工业建筑 居住建筑 |
| grade | String | 255 | 否 | 工程等别 多个空格分隔 例：新建 改建 |
| level | String | 255 | 否 | 工程级别 多个空格分隔 |
| projectScale | String | 255 | 否 | 工程规模 多个空格分隔 |
| keywords | List | - | 否 | keyword对象集合 |
| keywordNot | String | 255 | 否 | 关键词(不包含) 多个空格分隔 |
| keywordNotType | String | 255 | 否 | 关键词(不包含)查询类型 projectName项目名称,keyIndex关键指标,contractContent主要内容 |
| endMoney | Double | (16,6) | 否 | 项目金额（最大） |
| startMoney | Double | (16,6) | 否 | 项目金额（最小） |
| moneyStr | String | 255 | 否 | 项目金额体现 多个空格分隔 bid(中标)/invest(总投资)/contract(合同)/settlement(结算) |
| moneyQueryType | String | 20 | 否 | 项目金额类型 and/or |
| startTimeFactBegin | String | 20 | 否 | 实际开工时间（开始） |
| startTimeFactEnd | String | 20 | 否 | 实际开工时间（结束） |
| overTimeFactBegin | String | 20 | 否 | 实际竣工时间(开始) |
| overTimeFactEnd | String | 20 | 否 | 实际竣工时间(结束) |
| startTimeBegin | String | 20 | 否 | 开工日期(开始)信用：开工日期/合同执行期/监理开始日期/检测开始日期 监管：合同期限的开始 |
| startTimeEnd | String | 20 | 否 | 开工日期(结束)信用：开工日期/合同执行期/监理开始日期/检测开始日期 监管：合同期限的开始 |
| overTimeBegin | String | 20 | 否 | 完工日期(开始)）信用：完工日期/合同执行期/监理结束日期/检测结束日期 监管：合同期限的结束 |
| overTimeEnd | String | 20 | 否 | 完工日期(结束)信用：完工日期/合同执行期/监理结束日期/检测结束日期 监管：合同期限的结束 |
| contractDateBegin | String | 20 | 否 | 合同签订日期(开始) |
| contractDateEnd | String | 20 | 否 | 合同签订日期(结束) |
| reportCommitDateBegin | String | 20 | 否 | 报告提交日期(开始) |
| reportCommitDateEnd | String | 20 | 否 | 报告提交日期(结束) |
| timeQueryType | String | 20 | 否 | 时间类型 and/or |
| screenshotShowNode | String | 255 | 否 | 截图体现节点 contractAmount(合同金额) settlementAmount(结算金额) startTime(开工日期) endTime(完工日期) contractDate(合同签订时间) reportCommitDate(提交报告日期) projectStatus(项目状态) engineeringType(工程类型) projectPrincipal(项目负责人) engineerPrincipal(技术负责人) |
| screenshotShowType | String | 20 | 否 | 截图体现类型 and/or |
| divisionStr | String | 255 | 否 | 省 |
| cityStr | String | 255 | 否 | 市 |
| countyStr | String | 255 | 否 | 区 |
| province | String | 255 | 否 | 注册地 省级code 多个逗号隔开 |
| city | String | 255 | 否 | 注册地 市级code 多个逗号隔开 |
| county | String | 255 | 否 | 注册地 区级code 多个逗号隔开 |
| achievementCount | Integer | - | 否 | 业绩数量 |

 
 
 
 
jiangxiBidQueryDto：江西中标业绩对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| ename | String | 255 | 否 | 参建单位 |
| buildCorpName | String | 255 | 否 | 建设单位 |
| startMoney | Double | (16,6) | 否 | 中标开始金额 |
| endMoney | Double | (16,6) | 否 | 中标结束金额 |
| hasMoney | String | 255 | 否 | 包含金额未公示 |
| startTenderTime | String | 20 | 否 | 中标开始时间 |
| endTenderTime | String | 20 | 否 | 中标结束时间 |
| startWorkDate | String | 20 | 否 | 开工日期开始 |
| endWorkDate | String | 20 | 否 | 开工日期结束 |
| startCheckDate | String | 20 | 否 | 竣工日期开始 |
| endCheckDate | String | 20 | 否 | 竣工日期结束 |
| startCheckCheckDate | String | 20 | 否 | 实际竣工开始日期 |
| endCheckCheckDate | String | 20 | 否 | 实际竣工结束日期 |
| startCheckWorkDate | String | 20 | 否 | 实际开工开始日期 |
| endCheckWorkDate | String | 20 | 否 | 实际开工结束日期 |
| timeQueryType | String | 20 | 否 | 业绩时间同时具备、任意均可 and/or |
| keywords | List | - | 否 | keyword对象集合 |
| keywordNot | String | 255 | 否 | 关键词(不包含) |
| keywordNotType | String | 255 | 否 | 关键词(不包含)查询类型 project项目名称 scale建设规模 projectOrScale项目名称或建设规模 |
| divisionStr | String | 255 | 否 | 项目属地 市 |
| cityStr | String | 255 | 否 | 城市 |
| countyStr | String | 255 | 否 | 区 |
| achievementCount | String | 255 | 否 | 业绩数量 |
| province | String | 255 | 否 | 注册地 省级code 多个逗号隔开 |
| city | String | 255 | 否 | 注册地 市级code 多个逗号隔开 |
| county | String | 255 | 否 | 注册地 区级code 多个逗号隔开 |

 
yitihuaAchievements:对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| ename | String | 255 | 否 | 参建单位 多个空格隔开 |
| buildCorpName | String | 255 | 否 | 建设单位 多个空格隔开 |
| achievementType | String | 255 | 否 | 业绩类型 多个空格隔开 例："施工 设计" |
| projectType | String | 255 | 否 | 项目分类 多个空格分隔 例："房屋建设 市政工程" |
| purposeStr | String | 255 | 否 | 工程用途 多个空格分隔 例： "工业建筑 居住建筑" |
| nature | String | 255 | 否 | 建设性质 多个空格分隔 例："新建 改建" |
| tenderWay | String | 255 | 否 | 招标方式 多个空格分隔 例： "公开招标 直接委托 邀请招标" |
| keywords | List | - | 否 | keyword对象集合 |
| keywordNot | String | 255 | 否 | 关键词(不包含) 多个空格分隔 |
| keywordNotType | String | 255 | 否 | 关键词(不包含)查询类型 project项目名称 |
| attributeStr | String | 255 | 否 | 项目节点 多个空格分隔 |
| attributeQueryType | String | 20 | 否 | 项目节点类型 and/or |
| endMoney | Double | (16,6) | 否 | 项目金额（最大） |
| startMoney | Double | (16,6) | 否 | 项目金额（最小） |
| moneyStr | String | 255 | 否 | 项目金额体现 多个空格分隔 |
| moneyQueryType | String | 20 | 否 | 项目金额类型 and/or |
| endArea | Double | (16,6) | 否 | 项目面积（最大） |
| startArea | Double | (16,6) | 否 | 项目面积（最小） |
| areaStr | String | 255 | 否 | 项目面积体现 多个空格分隔 |
| areaQueryType | String | 20 | 否 | 项目面积类型 and/or |
| moneyAndAreaQueryType | String | 20 | 否 | 金额和面积类型 and/or |
| pmStr | String | 255 | 否 | 项目经理节点 多个空格分隔 |
| pmQueryType | String | 20 | 否 | 项目经理类型 and/or |
| startTenderTime | String | 20 | 否 | 中标时间（开始） |
| endTenderTime | String | 20 | 否 | 中标时间（结束） |
| startLicenceDate | String | 20 | 否 | 许可时间（开始） |
| endLicenceDate | String | 20 | 否 | 许可时间（结束） |
| startWorkDate | String | 20 | 否 | 开工时间（开始） |
| endWorkDate | String | 20 | 否 | 开工时间（结束） |
| startCheckDate | String | 20 | 否 | 竣工验收时间（开始） |
| endCheckDate | String | 20 | 否 | 竣工验收时间（结束） |
| startCensorDate | String | 20 | 否 | 图审完成时间（开始） |
| endCensorDate | String | 20 | 否 | 图审完成时间（结束） |
| timeQueryType | String | 20 | 否 | 时间类型 and/or |
| divisionStr | String | 255 | 否 | 省 |
| cityStr | String | 255 | 否 | 市 |
| countyStr | String | 255 | 否 | 区 |
| achievementCount | Integer | - | 否 | 业绩数量 |
| dataLevel | String | 255 | 否 | 数据等级 |
| dataLevelStr | String | 255 | 否 | 数据等级查询节点 |
| dataLevelQueryType | String | 20 | 否 | 数据等级查询方式 同时具备and 任意均可or |
| structure | String | 255 | 否 | 结构体系 |
| startLength | Double | (16,6) | 否 | 长度起 |
| endLength | Double | (16,6) | 否 | 长度止 |
| lengthNode | String | 255 | 否 | 长度体现节点 例：licence施工许可 checkCompletion竣工验收 completion竣工验收备案 |
| lengthType | String | 20 | 否 | 长度筛选类型 or/and |
| startSpan | Double | (16,6) | 否 | 跨度起 |
| endSpan | Double | (16,6) | 否 | 跨度止 |
| spanNode | String | 255 | 否 | 跨度体现节点 例： licence施工许可 checkCompletion竣工验收 completion竣工验收备案 |
| spanType | String | 20 | 否 | 跨度筛选类型 or/and |
| province | String | 255 | 否 | 注册地 省级code 多个逗号隔开 |
| city | String | 255 | 否 | 注册地 市级code 多个逗号隔开 |
| county | String | 255 | 否 | 注册地 区级code 多个逗号隔开 |

 
 
DateQueryDto：时间筛选对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| type | String | 255 | 否 | 类型 多个空格隔开 例：中标时间 合同签订时间 |
| startDate | String | 20 | 否 | 开始时间 例：2020-11-12 |
| endDate | String | 20 | 否 | 结束时间 例：2020-11-12 |

 
basicAchievements：全平台业绩对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| ename | String | 255 | 否 | 参建单位 多个空格隔开 |
| buildCorpName | String | 255 | 否 | 建设单位 多个空格隔开 |
| achievementSource | String | 255 | 否 | 四库一平台 公共资源交易网及其他 |
| achievementType | String | 255 | 否 | 业绩类型 多个空格隔开 例："施工 设计" |
| projectMoney | Double | (16,6) | 否 | 项目金额 最小值 |
| isMoney | Integer | - | 否 | 包含金额未公示 0：不包含 1：包含 |
| dateDtos | List | - | 否 | DateQueryDto对象集合 |
| timeQueryType | String | 20 | 否 | 时间查询类型 and/or 默认任意均可 |
| keywords | List | - | 否 | keyword对象集合 |
| keywordNot | String | 255 | 否 | 关键词(不包含) 多个空格分隔 |
| keywordNotType | String | 255 | 否 | 关键词(不包含)查询类型 project/scale 多个空格隔开 例："project scale" |
| divisionStr | String | 255 | 否 | 省 多个空格隔开 |
| cityStr | String | 255 | 否 | 市 多个空格隔开 |
| achievementCount | Integer | - | 否 | 业绩数量 |
| province | String | 255 | 否 | 注册地 省级code 多个逗号隔开 |
| city | String | 255 | 否 | 注册地 市级code 多个逗号隔开 |
| county | String | 255 | 否 | 注册地 区级code 多个逗号隔开 |

 
 
 
 
recentlyBidQueryDto：最新中标业绩对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| ename | String | 255 | 否 | 中标单位 |
| buildCorpName | String | 255 | 否 | 建设单位 |
| startMoney | Double | 16,6 | 否 | 最小金额(万元) |
| endMoney | Double | 16,6 | 否 | 最大金额(万元) |
| hasMoney | String | 10 | 否 | 是否包含金额未公示 yes/no |
| keywords | List | - | 否 | keyword对象集合 |
| keywordNot | String | 255 | 否 | 关键词(不包含) |
| singleKeywordIn | String | 255 | 否 | 单项查询 关键词包含 |
| singleKeywordOut | String | 255 | 否 | 单项查询 关键词不包含 |
| startTenderTime | String | 255 | 否 | 中标开始时间 |
| endTenderTime | String | 255 | 否 | 中标结束时间 |
| startLowerRate | Double | 16,6 | 否 | 下浮率 起 |
| endLowerRate | Double | 16,6 | 否 | 下浮率 止 |
| hasLowerRate | String | 20 | 否 | 是否包含下浮率未公示 yes/no |
| projectName | String | 255 | 否 | 项目名称 |
| tenderType | String | 255 | 否 | 中标类型 |
| sourceName | String | 255 | 否 | 来源 |
| projectType | String | 255 | 否 | 项目类型 |
| province | String | 255 | 否 | 注册地 省级code 多个逗号隔开 |
| city | String | 255 | 否 | 注册地 市级code 多个逗号隔开 |
| county | String | 255 | 否 | 注册地 区级code 多个逗号隔开 |

 
 
enterpriseAchievementQueryDto：四库业绩对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| tenderWay | String | 255 | 否 | 方式类别：公开招标,直接委托,邀请招标,其他,空白 |
| pmStr | String | 255 | 否 | 项目经理种类：tender,licence,censor,completion |
| pmQueryType | String | 5 | 否 | 项目经理：同时具备and、任意均可 or |
| moneyQueryRange | String | 255 | 否 | 金额查询范围 处理前dealBefore 处理后dealAfter |
| startMoney | String | 255 | 否 | 最小金额 |
| endMoney | String | 255 | 否 | 最大金额 |
| moneyStr | String | 255 | 否 | 金额体现节点 tender,contract,licence,completion |
| moneyQueryType | String | 5 | 否 | or/and |
| moneyAndAreaQueryType | String | 5 | 否 | 金额或面积同时具备任意均可 or/and |
| timeQueryType | String | 5 | 否 | 业绩时间同时具备、任意均可 or/and |
| keywords | List | - | 否 | 关键词的集合 |
| keywordNot | String | 255 | 否 | 关键词(不包含) |
| keywordNotType | String | 255 | 否 | 关键词(不包含)查询类型 project项目名称 scale建设规模 projectOrScale项目名称或建设规模 |
| achievementType | String | 255 | 否 | 业绩类型 |
| divisionStr | String | 255 | 否 | 项目属地 |
| nature | String | 255 | 否 | 建设性质 多个用逗号隔开 例：新建,改建,扩建 |
| startArea | Double | (16,6) | 否 | 最小面积 |
| endArea | Double | (16,6) | 否 | 最大面积 |
| areaQueryType | String | 5 | 否 | 项目面积类型 or/and |
| areaStr | String | 255 | 否 | 项目面积体现节点 tender,licence,completion |
| projectType | String | 255 | 否 | 项目类别 多个用逗号隔开 例：房屋建筑工程,市政基础设施工程 |
| purposeStr | String | 255 | 否 | 工程用途 多个用逗号隔开 例： 公共建筑,办公建筑 |
| startTenderTime | String | 20 | 否 | 中标开始时间 例： 2023-10-23 |
| endTenderTime | String | 20 | 否 | 中标结束时间 例：2023-10-23 |
| startContractDate | String | 20 | 否 | 合同签订开始时间 例：2023-10-23 |
| endContractDate | String | 20 | 否 | 合同签订结束时间 例：2023-10-23 |
| checkDateQueryRange | String | 20 | 否 | 竣工备案时间查询范围 精准precise 全量full |
| startCheckDate | String | 20 | 否 | 竣工开始日期 例：2023-10-23 |
| endCheckDate | String | 20 | 否 | 竣工结束日期 例：2023-10-23 |
| startWorkDate | String | 20 | 否 | 开工开始日期 例：2023-10-23 |
| endWorkDate | String | 20 | 否 | 开工结束日期 例：2023-10-23 |
| startContractDate | String | 20 | 否 | 合同开始日期 例：2023-10-23 |
| endContractDate | String | 20 | 否 | 合同结束日期 例：2023-10-23 |
| startLicenceDate | String | 20 | 否 | 许可开始日期 例：2023-10-23 |
| endLicenceDate | String | 20 | 否 | 许可结束日期 例：2023-10-23 |
| startCensorDate | String | 20 | 否 | 图审开始日期 例：2023-10-23 |
| endCensorDate | String | 20 | 否 | 图审结束日期 例：2023-10-23 |
| checkCheckDateQueryRange | String | 20 | 否 | 竣工验收时间查询范围 精准precise 全量full |
| startCheckCheckDate | String | 20 | 否 | 竣工验收开始日期 2023-10-23 |
| endCheckCheckDate | String | 20 | 否 | 竣工验收结束日期 2023-10-23 |
| attributeStr | String | 255 | 否 | 业绩属性 多个逗号隔开 例：censor,contract |
| attributeQueryType | String | 5 | 否 | 业绩属性查询方式 or/and |
| startLength | Double | (16,6) | 否 | 最小长度 |
| endLength | Double | (16,6) | 否 | 最大长度 |
| lengthNode | String | 255 | 否 | 长度体现节点 licence施工许可 checkCompletion竣工验收 completion竣工验收备案 |
| lengthType | String | 5 | 否 | 长度筛选类型 or/and |
| startSpan | Double | (16,6) | 否 | 最小跨度 |
| endSpan | Double | (16,6) | 否 | 最大跨度 |
| spanNode | String | 255 | 否 | 跨度体现节点 licence施工许可 checkCompletion竣工验收 completion竣工验收备案 |
| spanType | String | 5 | 否 | 跨度筛选类型 or/and |
| structure | String | 255 | 否 | 结构体系 |
| fundSource | String | 255 | 否 | 资金来源 |
| dataLevel | String | 255 | 否 | 级别：D级及以上 |
| dataLevelStr | String | 255 | 否 | project项目主体,tender,contract,licence,censor,completion |
| dataLevelQueryType | String | 5 | 否 | 数据等级查询方式 同时具备 任意均可 and/or |
| achievementCount | Integer | (16,6) | 否 | 业绩个数 |
| province | String | 255 | 否 | 注册地 省级code 多个逗号隔开 |
| city | String | 255 | 否 | 注册地 市级code 多个逗号隔开 |
| county | String | 255 | 否 | 注册地 区级code 多个逗号隔开 |
| indexDtos | List | (16,6) | 否 | SkyProjectIndexDto对象集合 |
| indexPoint | String | 255 | 否 | 项目参数体现节点 多个逗号隔开 例project,tender,contract,censor,licence,check,completion |
| indexQueryType | String | 5 | 否 | 项目参数节点 同时具备、任意均可 or/and |

 
keyword：对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| keyword | String | 255 | 否 | 关键词 多个用逗号隔开 |
| keywordType | String | 255 | 否 | 关键词(包含)查询类型 project项目名称 scale建设规模 projectOrScale项目名称或建设规模 |
| isReflect | Boolean | - | 是 | 是否截图体现公司和规模 true/false (选了规模的时候出现，只选项目名称的时候隐藏) |
| keywordStr | String | 255 | 否 | 关键词体现节点 projectName项目名称,project项目主体（建设规模）,tender招投标（建设规模）,contract合同（建设规模）,censor图审（建设规模）,licence许可（建设规模）,checkCompletion竣工验收（建设规模）,completion竣工备案（建设规模） |

SkyProjectIndexDto:对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| descriptionType | String | - | 否 | 面积 |
| indexData | Double | - | 否 | 高度 |

 
personnelCertificateQueryDto：人员专查对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| queryType | String | 20 | 否 | 组内and/or |
| registers | List | - | 否 | ComposeRegisterDto集合 |
| registers.registerQueryType | String | 20 | 否 | 组内and/or |
| registers.registerCount | Integer | - | 否 | 注册人数 |
| registers.countType | Integer | - | 否 | 个数类型： 1大于等于，2 等于， 3小于等于 |
| registers.registerTypes | List | - | 否 | 注册类型集合 |
| registers.registerTypes.personType | String | 255 | 否 | 来源 |
| registers.registerTypes.registerSpecialty | String | 255 | 否 | 注册专业 |
| registers.registerTypes.registerName | String | 255 | 否 | 类型名称 |

 
page：对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Integer | - | 是 | 页数 |
| limit | Integer | - | 是 | 条数 |

 
aptitudeQueryDto：资质对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| aptitudeCertNo | String | 255 | 否 | 资质编号 |
| systemQueryType | String | 5 | 否 | 三体系查询方式 同时具备and、任意均可or |
| systemType | List | - | 否 | [1,2,3,4]-->1 质量管理体系认证(ISO9000),2 环境管理体系, 3 职业安全管理体系, 4建设施工行业质量管理体系认证" |
| systemTypeStr | String | 255 | 否 | 1,2,3,4 多个逗号隔开 1 质量管理体系认证(ISO9000),2 环境管理体系,3 职业安全管理体系 ,4建设施工行业质量管理体系认证 |
| aptitudeSource | String | 20 | 否 | old/new 资质查询范围 old旧表 new新表 |
| aptitudeQueryType | String | 20 | 否 | 各组之间同时具备任意均可or/and |
| aptitudeDtoList | List | - | 否 | 资质集合 |
| aptitudeDtoList.nameStr | String | 255 | 否 | 资质名称 |
| aptitudeDtoList.codeStr | String | 255 | 否 | 资质编号 |
| aptitudeDtoList.queryType | String | 5 | 否 | 组内and/or |
| aptitudeType | String | 255 | 否 | 资质查询类型： qualification 按资质项 level 按等级 |
| outCodeStr | String | 255 | 否 | 不包含的资质项code 多个逗号隔开 |
| outQueryType | String | 5 | 否 | 不包含的资质项关系： 同时具备and、任意均可or |
| registeredCapital | String | 255 | 否 | 注册资金 |
| leftRegisteredCapital | String | 255 | 否 | 注册资金 起 |
| rightRegisteredCapital | String | 255 | 否 | 注册资金 止 |
| leftActualCapi | String | 255 | 否 | 实缴资本 起 |
| rightActualCapi | String | 255 | 否 | 实缴资本 止 |
| domicile | String | 255 | 否 | 企业属地 |
| domicileNum | String | 255 | 否 | 备案地代码 单选示例 500000 多选示例: 500000,xxxx |
| domicileCity | String | 255 | 否 | 本地的注册市 |
| domicileCounty | String | 255 | 否 | 本地的注册区 |
| registerProvince | String | 255 | 否 | 外地企业注册省 |
| registerCity | String | 255 | 否 | 外地企业注册市 |
| registerCounty | String | 255 | 否 | 外地企业注册区 |
| ename | String | 255 | 否 | 企业名称 |
| resultEname | String | 255 | 否 | 企业结果搜索 |
| businessScope | String | 255 | 否 | 经营范围：多个关键词空格隔开 |
| businessStatus | String | 255 | 否 | 经营状态 ：多个关键词逗号隔开 |
| businessScopeQueryType | String | 255 | 否 | 经营范围查询方式 |
| startInsuredNum | Integer | - | 否 | 参保人数 起 |
| endInsuredNum | Integer | - | 否 | 参保人数 止 |
| hasPhone | Integer | - | 否 | 是否有电话: 0否 1是 |
| isHighTech | Integer | - | 否 | 是否高新技术企业 0否 1是 |
| taxLvl | Integer | - | 否 | 税务登记 1 A级 |
| taxYear | Integer | - | 否 | A级纳税人 年份 多个逗号隔开 |
| hasAptitude | Integer | - | 否 | 有无资质 1有 2无 查资质到期时写死1 |
| hasLiceCert | Integer | - | 否 | 有无安许证 1有 2无 |
| companyType | String | 255 | 否 | 企业类型 : 1 国有企业 ,2 集体企业 ,3 股份有限公司 ,4 有限责任公司,5 联营企业, 6 港、澳、台商投资企业 ,7 私营企业 ,8 外商投资企业, 9 个体工商户 ,10 股份制企业,11 事业单位,12 其他 |
| startAptitudeValidityDate | String | 20 | 否 | 资质到期日期参数 开始 |
| endAptitudeValidityDate | String | 20 | 否 | 资质到期日期参数 结束 |
| startLiceValidityDate | String | 20 | 否 | 安许证日期参数 开始 |
| endLiceValidityDate | String | 20 | 否 | 安许证日期参数 结束 |
| liceCertNo | String | 200 | 否 | 安许证编号 |
| startRegisteredDate | String | 20 | 否 | 成立日期 开始 |
| endRegisteredDate | String | 20 | 否 | 成立日期 结束 |
| filePlaceCode | String | 20 | 否 | 备案地code |
| filePlaceType | Integer | - | 否 | 备案地类型 :1本省企业或外地备案 ,2 外地备案 ,3 本省企业 |
| province | String | 255 | 否 | 注册地 省级code 多个逗号隔开 |
| city | String | 255 | 否 | 注册地 市级code 多个逗号隔开 |
| county | String | 255 | 否 | 注册地 区级code 多个逗号隔开 |

 
 
 

#### **请求示例**
{
  "achievementQueryType": "and",
  "aptitudeQueryDto": {
    "regionWeb": "上海市住房和城乡建设管理委员会,上海建设工程服务中心",
    "aptitudeQueryType": "and",
    "businessScopeQueryType": "or",
    "systemQueryType": "and",
    "aptitudeDtoList": [
      {
        "nameStr": "",
        "queryType": "and"
      }
    ],
    "aptitudeSource": "new",
    "domicile": "重庆,河南",
    "domicileNum": "",
    "domicileCity": "",
    "registerProvince": "",
    "registerCity": "",
    "registerCounty": "",
    "companyType": "",
    "hasAptitude": ""
  },
  "creditQueryDto": {},
  "yitihuaSource": "四库一平台",
  "enterpriseAchievementQueryDto": [
    {
      "achievementCount": "3",
      "pmQueryType": "or",
      "screenshotShowType": "or",
      "indexQueryType": "or",
      "moneyQueryType": "or",
      "timeQueryType": "or",
      "areaQueryType": "or",
      "dataLevelQueryType": "or",
      "attributeQueryType": "or",
      "moneyAndAreaQueryType": "and",
      "indexDtos": []
    }
  ],
  "basicAchievements": [],
  "jiangxiBidQueryDto": [],
  "yitihuaAchievements": [],
  "recentlyBidQueryDto": [],
  "shuiliAchievements": [],
  "awardQueryDtos": [],
  "awardQueryType": "and",
  "eid": "",
  "page": {
    "page": 1,
    "limit": "2",
    "field": "",
    "order": "desc"
  },
  "goodBehaviorDto": {
    "isHighTech": "1"
  },
  "businessInfoDto": {
    "businessStatus": "在业,不详"
  }
}

### **响应参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| projectCount | Integer | - | 否 | 业绩数量 |
| liceCertNo | String | 255 | 否 | 安许证编号 |
| id | Integer | - | 否 | 企业id |
| businessAddress | String | 255 | 否 | 企业地址 |
| legalPerson | String | 255 | 否 | 法人代表 |
| registeredCapitalStr | String | 255 | 否 | 注册资金 |
| registeredDate | String | 255 | 否 | 注册日期 |
| persionCount | Integer | - | 否 | 人员数量 |
| aptitudeCountNew | Integer | - | 否 | 资质数量 |
| businessStatus | String | 255 | 否 | 经营状态 |
| name | String | 255 | 否 | 企业名称 |
| logoUrl | String | 255 | 否 | 企业logo |
| businessScope | String | 255 | 否 | 经营范围 |
| liceIssueDate | String | 255 | 否 | 安许证颁发日期 |
| phone | String | 255 | 否 | 联系电话 |
| liceValidityDate | String | 255 | 否 | 安许证到期日期 |
| registeredDate | String | 255 | 否 | 注册日期 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| totalCount | Integer | - | 是 | 总条数 |


#### **返回结果示例**
{
    "code": 200,
    "data": {
        "list": [
            {
                "registerCity": null,
                "projectCount": 3420,
                "isISO": null,
                "county": null,
                "jdztzgCount": null,
                "cityId": null,
                "source": null,
                "zzSxbzxCount": null,
                "filePlaceType": null,
                "recentlyCount": null,
                "roadConservancy": null,
                "liceCertNo": "（豫）JZ安许证字【2005】000673",
                "province": null,
                "regionInfo": null,
                "threePersonnelCount": null,
                "zzRiskBidCount": null,
                "certData": null,
                "id": "4906",
                "supplierCount": null,
                "businessAddress": "郑州市经开第十五大街267号",
                "formerName": "中国建筑第七工程局",
                "jmzyCount": null,
                "actualCapi": null,
                "businessScope": "房屋建筑工程施工总承包，公路工程施工总承包，市政公用工程施工总承包，可承接房屋建筑、公路、铁路、市政公用、港口与航道、水利水电各类别工程的施工总承包、工程总承包和项目管理业务；机电安装工程施工总承包；地基与基础工程专业承包；公路路面工程专业承包；公路路基工程专业承包；桥梁工程专业承包；隧道工程专业承包；钢结构工程专业承包；建筑装修装饰工程专业承包；公路行业工程设计；市政行业工程设计；建筑行业工程设计；景观园林绿化设计、施工与维护；建筑产品构件、节能门窗、PVC建筑模板等的设计、咨询、生产、销售及安装；房地产开发；房屋租赁；设备租赁；对外工程承包；自营或代理货物和技术的进出口业务。（涉及许可经营项目，应取得相关部门许可后方可经营）",
                "registerProvince": null,
                "provinceId": null,
                "bidMaxAmount": null,
                "logoUrl": "https://qxb-logo-url.oss-cn-hangzhou.aliyuncs.com/OriginalUrl/9df86ddf134b3b87f0f0c236227b8799.jpg",
                "skyCount": null,
                "labels": null,
                "companyId": null,
                "domicileCity": null,
                "liceIssueDate": "2022-12-30",
                "aptitudeCountNew": 23,
                "phone": "18237852807,15036911058,0371-67171613,13838988281,010-59963360,0371-58630952,18643141100,18939157585,18568258588,15093313566,15638569000,4017850,15629688097,18523056051,67179212,13007858769,2999424,13343697532,0371-66350527,13526663561,18657198830,18600053971,13872064253,0871-65324338,4017848,3492023,18300606762,0371-58630980,0755-25112317,78857943,0371-66350532,0371-61772063,0371-63940338,15565449900,0371-23333091,0714-6557018,18237153368,3654006,71068880,15699912033,2300000,18912971550,15136260875,48000000,13307112730,18603854216,0371-67981480,13011286878,3016257,0312-5675633,0371-66357098,13678754316,15837590292,15882775296,0371-67126988,0391-6388660,15261559929,13949110372,15978441231,19939359937,8160000,13462106608,0377-63188069,18530862857,15671828581,13897964921,15538036880,0371-23801488,18539993639,0371-55199156,0371-60304380,15523232344,15036194097,18655155503,0714-6267358,15090101020,3563960,18838236053,0371-66350796,18223227202,42020202,42020000,18767052555,13717700157,0431-",
                "registrationType": null,
                "topSupplierId": null,
                "bidSumAmount": null,
                "name": "中国建筑第七工程局有限公司",
                "filePlaceCode": null,
                "jskBidCount": null,
                "zdsswfCount": null,
                "isEMS": null,
                "aptitudeCount": 22,
                "liceValidityDate": "2025-12-30",
                "registeredCapitalStr": "600000.0",
                "attn": null,
                "isLocalC": null,
                "no": null,
                "other": null,
                "registeredDate": "1984-10-23",
                "city": null,
                "topCustomerId": null,
                "yqblxwjlCount": null,
                "isCountryCredit": null,
                "zzZfcgsxCount": null,
                "nameSimple": "中国第七工程局",
                "creditCode": "91410000169954619U",
                "badCreditChinaCount": null,
                "rate": null,
                "registeredCapital": 600000.0,
                "countyId": null,
                "legalPerson": "郭建军",
                "zzJdcgsxCount": null,
                "domicileNum": null,
                "companyType": null,
                "regionList": [
                    "山东",
                    "福建",
                    "河北",
                    "重庆",
                    "湖北",
                    "湖南",
                    "江西",
                    "海南",
                    "黑龙江",
                    "天津",
                    "贵州",
                    "陕西",
                    "新疆",
                    "江苏",
                    "安徽",
                    "西藏",
                    "吉林",
                    "上海",
                    "山西",
                    "宁夏",
                    "甘肃",
                    "四川",
                    "广西",
                    "浙江",
                    "云南",
                    "辽宁",
                    "广东",
                    "青海",
                    "北京"
                ],
                "rateTime": null,
                "businessStatus": "在业",
                "seriousIllegalCount": null,
                "url": null,
                "waterConservancy": null,
                "isLocal": null,
                "isOHSMS": null,
                "persionCount": 7972,
                "regionId": null,
                "liceValidDay": 792,
                "registeredPersonnelCount": null,
                "domicile": "河南省-郑州市",
                "jskEid": 4906,
                "numPunish": null,
                "customerCount": null
            },
            {
                "registerCity": null,
                "projectCount": 3717,
                "isISO": null,
                "county": null,
                "jdztzgCount": null,
                "cityId": null,
                "source": null,
                "zzSxbzxCount": null,
                "filePlaceType": null,
                "recentlyCount": null,
                "roadConservancy": null,
                "liceCertNo": "（渝）JZ安许证字【2004】002201",
                "province": null,
                "regionInfo": null,
                "threePersonnelCount": null,
                "zzRiskBidCount": null,
                "certData": null,
                "id": "9296",
                "supplierCount": null,
                "businessAddress": "重庆市大渡口区西城大道1号",
                "formerName": "中冶建工有限公司",
                "jmzyCount": null,
                "actualCapi": null,
                "businessScope": "许可项目：各类工程建设活动，道路货物运输（不含危险货物），地质灾害治理工程施工，地质灾害治理工程勘查，建设工程勘察，建设工程设计，国土空间规划编制，公路管理与养护，特种设备安装改造修理，电力设施承装、承修、承试，建筑用钢筋产品生产，货物进出口，餐饮服务（依法须经批准的项目，经相关部门批准后方可开展经营活动，具体经营项目以相关部门批准文件或许可证件为准） 一般项目：水泥制品制造，金属结构制造，水环境污染防治服务，城市绿化管理，对外承包工程，建筑用石加工，木材加工，通用设备制造（不含特种设备制造），建筑工程机械与设备租赁，轻质建筑材料制造，工程和技术研究和试验发展，技术服务、技术开发、技术咨询、技术交流、技术转让、技术推广，工程管理服务，住房租赁，非居住房地产租赁，物业管理，停车场服务，餐饮管理（除依法须经批准的项目外，凭营业执照依法自主开展经营活动）",
                "registerProvince": null,
                "provinceId": null,
                "bidMaxAmount": null,
                "logoUrl": "https://qxb-logo-url.oss-cn-hangzhou.aliyuncs.com/OriginalUrl/4aef1c28cba90a77bd81f4c323d34270.jpg",
                "skyCount": null,
                "labels": null,
                "companyId": null,
                "domicileCity": null,
                "liceIssueDate": "2019-06-26",
                "aptitudeCountNew": 39,
                "phone": "18380179269,18696786653,13228200508,022-60125122,13527533980,023-68906697,15121179584,13883361937,13452330673,18323220859,13908382823,15823269713,15803008669,023-65150189,18680867363,18918181451,15823485411,0312-5620113,022-60125112,13640533051,0311-66696406,15023116460,023-68100655,15803007337,18983305955,023-68652168,18581059040,13983631990,86191358,13608357752,15223429053,023-68401461,15913154736,023-68417970,18716330220,023-68912114,023-68903644,13996202848,023-68400929,023-68935356,18375898824,15002223405,18523313995,15500801902,18580755686,15123165832,18996053518,15123166127,68856133,15141152107,13452781575,13883361292,18523160517,18809596558,15626291240,13640517684,023-68826421,18725906206,0311-66187855,13100605397,13667673592,18723465752,15111992616,023-68123057,13752989321,18002160802,021-51953530,15736096270,023-68833736,13260065205,13452912314,15923590798,023-68659563,028-66820476,13618278675,15123242322,15213133766,18908353576,15823350246,13618263158,13368066041,18302311572",
                "registrationType": null,
                "topSupplierId": null,
                "bidSumAmount": null,
                "name": "中冶建工集团有限公司",
                "filePlaceCode": null,
                "jskBidCount": null,
                "zdsswfCount": null,
                "isEMS": null,
                "aptitudeCount": 2,
                "liceValidityDate": "2022-06-25",
                "registeredCapitalStr": "210000.0",
                "attn": null,
                "isLocalC": null,
                "no": null,
                "other": null,
                "registeredDate": "2006-11-03",
                "city": null,
                "topCustomerId": null,
                "yqblxwjlCount": null,
                "isCountryCredit": null,
                "zzZfcgsxCount": null,
                "nameSimple": "中冶",
                "creditCode": "91500000795854690R",
                "badCreditChinaCount": null,
                "rate": null,
                "registeredCapital": 210000.0,
                "countyId": null,
                "legalPerson": "田贵祥",
                "zzJdcgsxCount": null,
                "domicileNum": null,
                "companyType": null,
                "regionList": [
                    "山东",
                    "福建",
                    "河南",
                    "河北",
                    "湖南",
                    "湖北",
                    "江西",
                    "海南",
                    "黑龙江",
                    "天津",
                    "陕西",
                    "贵州",
                    "新疆",
                    "江苏",
                    "安徽",
                    "西藏",
                    "吉林",
                    "上海",
                    "宁夏",
                    "山西",
                    "甘肃",
                    "四川",
                    "浙江",
                    "广西",
                    "云南",
                    "内蒙古",
                    "辽宁",
                    "广东",
                    "青海",
                    "北京"
                ],
                "rateTime": null,
                "businessStatus": "在业",
                "seriousIllegalCount": null,
                "url": null,
                "waterConservancy": null,
                "isLocal": null,
                "isOHSMS": null,
                "persionCount": 2831,
                "regionId": null,
                "liceValidDay": -492,
                "registeredPersonnelCount": null,
                "domicile": "重庆-重庆市-大渡口区",
                "jskEid": 9296,
                "numPunish": null,
                "customerCount": null
            }
        ],
        "totalCount": 154
    },
    "msg": "查询成功"
}
返回code码见 API 前置说明
