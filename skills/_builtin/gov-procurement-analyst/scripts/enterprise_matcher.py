"""
企业画像匹配与商机评分系统

使用方式：
  python enterprise_matcher.py --projects "projects.json" --enterprise "my_company.json" --output "match_results.json"

其中：
  - projects.json: 采集到的采购项目列表
  - my_company.json: 企业画像 JSON（用户填写）
  - match_results.json: 输出匹配结果（按分数降序）

匹配算法总分 100 分 = 行业30 + 资质25 + 业绩20 + 地区15 + 金额10
"""

import argparse
import json
import os
from datetime import datetime
from typing import Optional


# === 政府采购品目分类（简化版） ===
# 完整版见《政府采购品目分类目录》（财库〔2013〕189号）
CATEGORY_TREE = {
    'A': {'name': '货物', 'weight': 1.0, 'children': {
        'A01': '土地、房屋及构筑物',
        'A02': '通用设备',
        'A03': '专用设备',
        'A04': '文物和陈列品',
        'A05': '图书和档案',
        'A06': '家具、用具、装具及动植物',
        'A07': '纺织原料、毛皮、被服装具',
        'A08': '纸、纸制品及印刷品',
        'A09': '食品、饮料和农副产品',
        'A10': '药物、医疗器材及医用耗材',
        'A11': '物资',
        'A99': '其他货物',
    }},
    'B': {'name': '工程', 'weight': 1.0, 'children': {
        'B01': '房屋建筑业',
        'B02': '土木工程建筑业',
        'B03': '建筑安装业',
        'B04': '建筑装饰、装修和其他建筑业',
        'B99': '其他工程',
    }},
    'C': {'name': '服务', 'weight': 1.0, 'children': {
        'C01': '科学研究和技术服务',
        'C02': '交通运输和仓储服务',
        'C03': '批发和零售服务',
        'C04': '住宿和餐饮服务',
        'C05': '信息技术服务',
        'C06': '租赁和商务服务',
        'C07': '会议、展览及相关服务',
        'C08': '专业咨询服务',
        'C09': '水利、环境和公共设施管理服务',
        'C10': '居民服务和其他服务',
        'C11': '教育服务',
        'C12': '医疗卫生服务',
        'C13': '社会保障服务',
        'C14': '社会福利服务',
        'C15': '文化、体育和娱乐服务',
        'C16': '金融服务',
        'C17': '农、林、牧、渔服务',
        'C18': '市政公用设施管理服务',
        'C19': '供电、供水、供气服务',
        'C20': '住宿和餐饮服务',
        'C21': '电信和其他传输服务',
        'C99': '其他服务',
    }},
}

# 相邻省份映射（用于地区评分）
ADJACENT_PROVINCES = {
    '北京': ['河北', '天津'],
    '天津': ['北京', '河北'],
    '河北': ['北京', '天津', '山东', '河南', '山西', '内蒙古', '辽宁'],
    '山西': ['河北', '河南', '陕西', '内蒙古'],
    '内蒙古': ['山西', '陕西', '宁夏', '甘肃', '黑龙江', '吉林', '辽宁', '河北'],
    '辽宁': ['河北', '内蒙古', '吉林'],
    '吉林': ['辽宁', '内蒙古', '黑龙江'],
    '黑龙江': ['吉林', '内蒙古'],
    '上海': ['江苏', '浙江'],
    '江苏': ['上海', '浙江', '安徽', '山东'],
    '浙江': ['上海', '江苏', '安徽', '江西', '福建'],
    '安徽': ['江苏', '浙江', '江西', '湖北', '河南', '山东'],
    '福建': ['浙江', '江西', '广东'],
    '江西': ['安徽', '浙江', '福建', '广东', '湖南', '湖北'],
    '山东': ['河北', '河南', '江苏', '安徽'],
    '河南': ['河北', '山西', '陕西', '湖北', '安徽', '山东'],
    '湖北': ['河南', '安徽', '江西', '湖南', '重庆', '陕西'],
    '湖南': ['湖北', '江西', '广东', '广西', '贵州', '重庆'],
    '广东': ['福建', '江西', '湖南', '广西', '海南'],
    '广西': ['广东', '湖南', '贵州', '云南'],
    '海南': ['广东'],
    '重庆': ['四川', '贵州', '湖北', '陕西', '湖南'],
    '四川': ['重庆', '贵州', '云南', '西藏', '陕西', '甘肃', '青海'],
    '贵州': ['四川', '重庆', '湖南', '广西', '云南'],
    '云南': ['四川', '贵州', '广西', '西藏'],
    '西藏': ['四川', '云南', '青海', '新疆'],
    '陕西': ['内蒙古', '宁夏', '甘肃', '四川', '重庆', '湖北', '河南', '山西'],
    '甘肃': ['内蒙古', '宁夏', '陕西', '四川', '青海', '新疆'],
    '青海': ['甘肃', '四川', '西藏', '新疆'],
    '宁夏': ['内蒙古', '陕西', '甘肃'],
    '新疆': ['甘肃', '青海', '西藏'],
}


class EnterpriseMatcher:
    """企业画像 - 采购项目匹配引擎"""
    
    def __init__(self, enterprise: dict):
        """初始化企业画像"""
        self.enterprise = enterprise
        self.required_fields = ['name', 'credit_code', 'industry', 'location']
        self._validate_enterprise()
    
    def _validate_enterprise(self):
        """验证企业画像必填字段"""
        missing = []
        for field in self.required_fields:
            if field not in self.enterprise or not self.enterprise[field]:
                missing.append(field)
        
        if missing:
            print(f"[WARNING] 企业画像缺少字段: {', '.join(missing)}")
            print("[提示] 为了更精准的匹配，建议在对话中补充以下信息：")
            for field in missing:
                print(f"  - {field}")
    
    def calculate_match(self, project: dict) -> dict:
        """
        计算单个项目与企业的匹配度
        
        参数:
            project: 采购项目字典，至少包含 category, location, budget, required_certs等字段
        
        返回:
            匹配结果字典，包含总分、各维度分数、建议
        """
        scores = {}
        details = {}
        
        # 维度1：行业匹配（30分）
        scores['industry'] = self._match_industry(project) * 30
        details['industry'] = {
            'max': 30,
            'score': round(scores['industry'], 1),
            'detail': self._match_industry_detail(project),
        }
        
        # 维度2：资质匹配（25分）
        scores['certification'] = self._match_certification(project) * 25
        details['certification'] = {
            'max': 25,
            'score': round(scores['certification'], 1),
            'detail': self._match_certification_detail(project),
        }
        
        # 维度3：业绩匹配（20分）
        scores['performance'] = self._match_performance(project) * 20
        details['performance'] = {
            'max': 20,
            'score': round(scores['performance'], 1),
            'detail': self._match_performance_detail(project),
        }
        
        # 维度4：地区便利性（15分）
        scores['location'] = self._match_location(project) * 15
        details['location'] = {
            'max': 15,
            'score': round(scores['location'], 1),
            'detail': self._match_location_detail(project),
        }
        
        # 维度5：金额匹配（10分）
        scores['amount'] = self._match_amount(project) * 10
        details['amount'] = {
            'max': 10,
            'score': round(scores['amount'], 1),
            'detail': self._match_amount_detail(project),
        }
        
        # 总分
        total = sum(scores.values())
        
        # 匹配度等级
        level = self._get_match_level(total)
        
        # 风险标记
        risk_flags = self._identify_risks(project)
        
        return {
            'project_id': project.get('id', ''),
            'project_name': project.get('title', project.get('project_name', '')),
            'total_score': round(total, 1),
            'level': level,
            'scores': details,
            'risk_flags': risk_flags,
            'ai_suggestion': self._generate_suggestion(total, details, risk_flags),
        }
    
    def _match_industry(self, project: dict) -> float:
        """行业匹配：返回 0.0 ~ 1.0"""
        project_category = project.get('category', '')
        enterprise_industries = self.enterprise.get('industries', [])
        
        if not project_category or not enterprise_industries:
            return 0.3  # 无信息时给中性分
        
        # 精确匹配
        for industry in enterprise_industries:
            if industry == project_category:
                return 1.0
        
        # 分类匹配（二级）
        for industry in enterprise_industries:
            if len(industry) >= 3 and len(project_category) >= 3:
                if industry[:3] == project_category[:3]:
                    return 0.85
        
        # 顶级分类匹配
        for industry in enterprise_industries:
            if industry and project_category and industry[0] == project_category[0]:
                return 0.5
        
        return 0.1
    
    def _match_industry_detail(self, project: dict) -> str:
        """行业匹配细节说明"""
        project_category = project.get('category', '')
        enterprise_industries = self.enterprise.get('industries', [])
        
        if not enterprise_industries:
            return "企业行业信息未提供"
        
        if project_category in enterprise_industries:
            return f"完全匹配：企业主营含「{project_category}」"
        
        for industry in enterprise_industries:
            if len(industry) >= 3 and len(project_category) >= 3:
                if industry[:3] == project_category[:3]:
                    return f"高度相关：{industry} vs {project_category}"
        
        for industry in enterprise_industries:
            if industry and project_category and industry[0] == project_category[0]:
                return f"相关分类：同属{CATEGORY_TREE.get(industry[0], {}).get('name', '其他')}"
        
        return f"行业差异较大：企业主营{enterprise_industries[0] if enterprise_industries else '?'} vs 项目{project_category}"
    
    def _match_certification(self, project: dict) -> float:
        """资质匹配：返回 0.0 ~ 1.0"""
        required = set(project.get('required_certifications', []))
        owned = set(self.enterprise.get('certifications', []))
        
        if not required:
            return 1.0  # 无资质要求
        
        matched = 0
        unmatched = []
        
        for cert in required:
            # 默认具备：营业执照等
            if '营业执照' in cert or '法人证书' in cert or '身份证明' in cert:
                matched += 1
                continue
            
            if cert in owned:
                matched += 1
            else:
                unmatched.append(cert)
        
        return matched / len(required) if required else 1.0
    
    def _match_certification_detail(self, project: dict) -> str:
        """资质匹配细节"""
        required = set(project.get('required_certifications', []))
        owned = set(self.enterprise.get('certifications', []))
        
        if not required:
            return "无特殊资质要求"
        
        matched = required & owned
        unmatched = required - owned
        
        detail = f"满足 {len(matched)}/{len(required)}"
        if matched:
            detail += f" ✅ {', '.join(list(matched)[:3])}"
        if unmatched:
            detail += f" ❌ 缺 {', '.join(list(unmatched)[:3])}"
        
        return detail
    
    def _match_performance(self, project: dict) -> float:
        """业绩匹配：基于历史项目经验"""
        history = self.enterprise.get('history_projects', [])
        project_desc = project.get('description', '') + project.get('title', '')
        
        if not history or not project_desc:
            return 0.1
        
        # 简化版：关键词匹配
        similar_count = 0
        project_keywords = set(project_desc)
        
        for past_project in history:
            past_keywords = set(past_project.get('description', '') + past_project.get('name', ''))
            # Jaccard 相似度
            intersection = len(project_keywords & past_keywords)
            union = len(project_keywords | past_keywords)
            if union > 0 and intersection / union > 0.3:
                similar_count += 1
        
        # 分级评分
        if similar_count >= 3:
            return 1.0
        elif similar_count == 2:
            return 0.7
        elif similar_count == 1:
            return 0.4
        else:
            return 0.15
    
    def _match_performance_detail(self, project: dict) -> str:
        """业绩匹配细节"""
        history = self.enterprise.get('history_projects', [])
        
        if not history:
            return "未提供历史业绩"
        
        count = len(history)
        return f"已有 {count} 个历史项目记录（需人工核实相似度）"
    
    def _match_location(self, project: dict) -> float:
        """地区便利性匹配"""
        project_loc = project.get('location', '')
        enterprise_loc = self.enterprise.get('location', '')
        
        if not project_loc or not enterprise_loc:
            return 0.5
        
        # 精确匹配
        if project_loc == enterprise_loc:
            return 1.0
        
        # 同省（简化为前两个字匹配）
        if project_loc[:2] == enterprise_loc[:2]:
            return 0.8
        
        # 相邻省份
        project_province = project_loc[:2]
        enterprise_province = enterprise_loc[:2]
        
        if project_province in ADJACENT_PROVINCES.get(enterprise_province, []):
            return 0.5
        
        return 0.3
    
    def _match_location_detail(self, project: dict) -> str:
        """地区匹配细节"""
        project_loc = project.get('location', '')
        enterprise_loc = self.enterprise.get('location', '')
        
        if project_loc == enterprise_loc:
            return f"✅ 同地：{project_loc}"
        
        if project_loc[:2] == enterprise_loc[:2]:
            return f"✅ 同省：{enterprise_loc} → {project_loc}"
        
        project_province = project_loc[:2] if project_loc else '?'
        enterprise_province = enterprise_loc[:2] if enterprise_loc else '?'
        
        if project_province in ADJACENT_PROVINCES.get(enterprise_province, []):
            return f"🔶 邻省：{enterprise_loc} → {project_loc}"
        
        return f"❌ 跨省：{enterprise_loc} → {project_loc}（需设项目组）"
    
    def _match_amount(self, project: dict) -> float:
        """金额匹配"""
        budget = project.get('budget', 0)
        avg_amount = self.enterprise.get('avg_bid_amount', 0)
        
        if not budget:
            return 0.5
        
        if not avg_amount:
            return 0.5
        
        ratio = budget / avg_amount
        
        if 0.5 <= ratio <= 1.5:
            return 1.0
        elif 0.3 <= ratio <= 2.0:
            return 0.7
        elif 0.2 <= ratio <= 3.0:
            return 0.4
        else:
            return 0.2
    
    def _match_amount_detail(self, project: dict) -> str:
        """金额匹配细节"""
        budget = project.get('budget', 0)
        avg_amount = self.enterprise.get('avg_bid_amount', 0)
        
        if not avg_amount:
            return f"项目预算 ¥{budget}万（企业历史投标金额未知）"
        
        if budget > 0 and avg_amount > 0:
            ratio = budget / avg_amount
            if 0.5 <= ratio <= 1.5:
                return f"✅ 金额匹配：¥{budget}万 ≈ 企业平均 ¥{avg_amount}万"
            elif ratio > 1.5:
                return f"⚠️ 金额偏高：¥{budget}万 > 企业平均 ¥{avg_amount}万"
            else:
                return f"🔶 金额偏低：¥{budget}万 < 企业平均 ¥{avg_amount}万"
        
        return "无法评估金额匹配度"
    
    def _get_match_level(self, total: float) -> str:
        """获取匹配度等级"""
        if total >= 80:
            return 'high'      # 🔥 高匹配
        elif total >= 60:
            return 'medium'    # ⭐ 中匹配
        elif total >= 40:
            return 'normal'    # 📋 一般
        else:
            return 'low'       # ❌ 低匹配
    
    def _identify_risks(self, project: dict) -> list:
        """识别项目风险点"""
        risks = []
        
        # 资质缺失风险
        required = set(project.get('required_certifications', []))
        owned = set(self.enterprise.get('certifications', []))
        missing = required - owned - {'营业执照', '法人证书'}
        if len(missing) / max(len(required), 1) > 0.5:
            risks.append(f"资质缺失较多（缺{len(missing)}项）")
        
        # 金额超预算风险
        budget = project.get('budget', 0)
        avg_amount = self.enterprise.get('avg_bid_amount', 0)
        if avg_amount > 0 and budget > avg_amount * 3:
            risks.append(f"项目金额远超企业历史平均（¥{budget}万 vs ¥{avg_amount}万）")
        
        # 地区偏远风险
        project_loc = project.get('location', '')
        enterprise_loc = self.enterprise.get('location', '')
        if project_loc and enterprise_loc:
            project_province = project_loc[:2]
            enterprise_province = enterprise_loc[:2]
            if project_province != enterprise_province:
                if project_province not in ADJACENT_PROVINCES.get(enterprise_province, []):
                    risks.append(f"跨远地区（{enterprise_loc} → {project_loc}）")
        
        # 时间紧迫风险
        deadline = project.get('bid_deadline', '')
        if deadline:
            try:
                deadline_date = datetime.strptime(deadline[:10], '%Y-%m-%d')
                days_left = (deadline_date - datetime.now()).days
                if days_left < 5:
                    risks.append(f"投标截止时间仅剩 {days_left} 天")
            except (ValueError, TypeError):
                pass
        
        return risks
    
    def _generate_suggestion(self, total: float, details: dict, risks: list) -> str:
        """生成 AI 建议（简化版）"""
        if total >= 80:
            return "竞争优势明显，强烈建议投标。重点准备技术方案和业绩证明材料。"
        elif total >= 60:
            return "匹配度良好，建议参与。需补齐缺失资质或准备替代方案。"
        elif total >= 40:
            return "有一定匹配度但需审慎评估。分析主要短板，考虑能否补强。"
        else:
            return "匹配度较低，建议投入前仔细权衡。可作为业绩积累机会但不建议大量投入。"
    
    def batch_match(self, projects: list) -> list:
        """批量匹配，返回按分数排序的结果"""
        results = []
        
        for project in projects:
            try:
                result = self.calculate_match(project)
                results.append(result)
            except Exception as e:
                print(f"[ERROR] 匹配项目时出错: {e}")
                continue
        
        # 按总分降序排序
        results.sort(key=lambda x: x['total_score'], reverse=True)
        
        return results
    
    def generate_report(self, results: list, top_n: int = 10) -> str:
        """生成 Markdown 格式的报告"""
        report = []
        report.append("# 政府采购项目匹配分析报告")
        report.append(f"\n生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
        report.append(f"\n扫描项目数：{len(results)}")
        
        # 分级统计
        high = sum(1 for r in results if r['level'] == 'high')
        medium = sum(1 for r in results if r['level'] == 'medium')
        normal = sum(1 for r in results if r['level'] == 'normal')
        low = sum(1 for r in results if r['level'] == 'low')
        
        report.append(f"匹配分布：🔥高匹配 {high} | ⭐中匹配 {medium} | 📋一般 {normal} | ❌低匹配 {low}")
        report.append(f"\n---\n")
        
        # TOP N 推荐
        high_results = [r for r in results if r['level'] in ('high', 'medium')][:top_n]
        
        if high_results:
            report.append(f"## 🔥 TOP {min(top_n, len(high_results))} 推荐项目\n")
            
            for i, result in enumerate(high_results, 1):
                report.append(f"### {i}. {result['project_name']}")
                report.append(f"- **匹配度**：{result['total_score']}分 ({result['level']})")
                
                scores = result['scores']
                report.append(f"- 行业匹配：{scores['industry']['score']}/{scores['industry']['max']}")
                report.append(f"- 资质匹配：{scores['certification']['score']}/{scores['certification']['max']} ({scores['certification']['detail']})")
                report.append(f"- 地区便利：{scores['location']['score']}/{scores['location']['max']} ({scores['location']['detail']})")
                
                if result.get('risk_flags'):
                    report.append(f"- ⚠️ 风险：{'；'.join(result['risk_flags'])}")
                
                report.append(f"- 💡 建议：{result['ai_suggestion']}")
                report.append("")
        
        # 完整结果表格
        if results:
            report.append("## 完整匹配结果\n")
            report.append("| 序号 | 项目名称 | 总分 | 行业 | 资质 | 地区 | 金额 | 等级 |")
            report.append("|------|----------|------|------|------|------|------|------|")
            
            for i, r in enumerate(results[:50], 1):  # 最多显示前50
                level_icon = {'high': '🔥', 'medium': '⭐', 'normal': '📋', 'low': '❌'}.get(r['level'], '?')
                report.append(
                    f"| {i} | {r['project_name'][:30]}... | {r['total_score']} | "
                    f"{r['scores']['industry']['score']} | {r['scores']['certification']['score']} | "
                    f"{r['scores']['location']['score']} | {r['scores']['amount']['score']} | "
                    f"{level_icon} |"
                )
        
        return '\n'.join(report)


def main():
    parser = argparse.ArgumentParser(description='企业画像匹配工具')
    parser.add_argument('--projects', required=True, help='采购项目 JSON 文件路径')
    parser.add_argument('--enterprise', required=True, help='企业画像 JSON 文件路径')
    parser.add_argument('--output', default='match_results.json', help='输出结果 JSON 文件')
    parser.add_argument('--report', default='match_report.md', help='输出 Markdown 报告文件')
    parser.add_argument('--min-score', type=float, default=40, help='最低匹配分数过滤')
    
    args = parser.parse_args()
    
    # 加载数据
    with open(args.projects, 'r', encoding='utf-8') as f:
        projects = json.load(f)
    
    with open(args.enterprise, 'r', encoding='utf-8') as f:
        enterprise = json.load(f)
    
    # 确保 projects 是列表
    if isinstance(projects, dict) and 'data' in projects:
        projects = projects['data']
    
    print(f"\n企业画像：{enterprise.get('name', 'Unknown')}")
    print(f"扫描项目：{len(projects)} 个")
    print(f"最低匹配分数：{args.min_score}")
    print("-" * 40)
    
    # 执行匹配
    matcher = EnterpriseMatcher(enterprise)
    results = matcher.batch_match(projects)
    
    # 过滤低分
    filtered = [r for r in results if r['total_score'] >= args.min_score]
    
    print(f"\n匹配结果：{len(filtered)} 个项目达到最低分数")
    print(f"  🔥 高匹配（≥80）：{sum(1 for r in filtered if r['level'] == 'high')}")
    print(f"  ⭐ 中匹配（60-79）：{sum(1 for r in filtered if r['level'] == 'medium')}")
    print(f"  📋 一般（40-59）：{sum(1 for r in filtered if r['level'] == 'normal')}")
    
    # 保存结果
    output_data = {
        'enterprise': enterprise.get('name', ''),
        'generated_at': datetime.now().isoformat(),
        'filter_min_score': args.min_score,
        'total_matched': len(filtered),
        'results': filtered,
    }
    
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print(f"\n结果已保存：{os.path.abspath(args.output)}")
    
    # 生成 Markdown 报告
    report = matcher.generate_report(filtered)
    with open(args.report, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"报告已保存：{os.path.abspath(args.report)}")
    
    return output_data


if __name__ == '__main__':
    main()
