"""
政府采购合规审计辅助工具

功能：
1. 围标串标检测
2. 时间节点合规检查
3. 供应商关联关系识别
4. 评分异常检测

使用方式：
  python compliance_checker.py --projects "projects.json" --bidders "bidders.json" --output "audit_report.json"
"""

import argparse
import json
import os
from datetime import datetime, timedelta
from typing import Optional


# === 围标串标检测规则 ===

COLLUSION_RULES = [
    {
        'id': 'R001',
        'name': '联系方式雷同',
        'description': '不同投标人联系电话/邮箱/地址相同',
        'risk_level': 'high',
        'check': lambda b1, b2: (
            b1.get('phone') and b1['phone'] == b2.get('phone') or
            b1.get('email') and b1['email'] == b2.get('email') or
            b1.get('address') and b1['address'] == b2.get('address')
        ),
    },
    {
        'id': 'R002',
        'name': 'MAC地址相同',
        'description': '投标文件上传设备相同',
        'risk_level': 'high',
        'check': lambda b1, b2: (
            b1.get('mac_address') and b1['mac_address'] == b2.get('mac_address')
        ),
    },
    {
        'id': 'R003',
        'name': '文件相似度异常',
        'description': '投标文件技术方案内容雷同',
        'risk_level': 'high',
        'check': lambda b1, b2: (
            b1.get('file_hash') and b1['file_hash'] == b2.get('file_hash')
        ),
    },
    {
        'id': 'R004',
        'name': '关联企业投标',
        'description': '同一控制人/关联企业参加同一标段',
        'risk_level': 'high',
        'check': lambda b1, b2: (
            b1.get('controller') and b1['controller'] == b2.get('controller') or
            b1.get('parent_company') and b1['parent_company'] == b2.get('parent_company')
        ),
    },
    {
        'id': 'R005',
        'name': '报价规律性',
        'description': '多家投标人报价呈等差/等比数列',
        'risk_level': 'medium',
        'check': None,  # 需要多个投标人价格，单独处理
    },
    {
        'id': 'R006',
        'name': '投标代表同一人',
        'description': '投标授权委托书代表为同一人',
        'risk_level': 'high',
        'check': lambda b1, b2: (
            b1.get('representative') and b1['representative'] == b2.get('representative')
        ),
    },
    {
        'id': 'R007',
        'name': '同一IP下载',
        'description': '多个投标人同一IP下载招标文件',
        'risk_level': 'medium',
        'check': lambda b1, b2: (
            b1.get('download_ip') and b1['download_ip'] == b2.get('download_ip')
        ),
    },
    {
        'id': 'R008',
        'name': '混装包装',
        'description': '不同投标人文件混装或邮寄地址相同',
        'risk_level': 'high',
        'check': lambda b1, b2: (
            b1.get('mail_address') and b1['mail_address'] == b2.get('mail_address')
        ),
    },
]


# === 时间节点合规规则 ===

TIME_COMPLIANCE_RULES = [
    {
        'id': 'T001',
        'name': '招标文件发售期',
        'description': '招标文件发售期不得少于5日',
        'law': '《政府采购法实施条例》第31条',
        'min_days': 5,
        'check': lambda p: _check_period_days(p.get('sale_start'), p.get('sale_end'), 5),
    },
    {
        'id': 'T002',
        'name': '提交投标文件截止时间',
        'description': '自招标文件发出之日起至提交投标文件截止之日止，不得少于20日',
        'law': '《政府采购法》第35条',
        'min_days': 20,
        'check': lambda p: _check_period_days(p.get('notice_date'), p.get('bid_deadline'), 20),
    },
    {
        'id': 'T003',
        'name': '澄清修改时限',
        'description': '澄清或修改招标文件应在投标截止时间至少15日前发出',
        'law': '《政府采购法实施条例》第31条',
        'min_days': 15,
        'check': lambda p: _check_period_days(p.get('clarification_date'), p.get('bid_deadline'), 15),
    },
    {
        'id': 'T004',
        'name': '中标公示期',
        'description': '中标公告公示期不得少于1个工作日',
        'law': '《政府采购法实施条例》第43条',
        'min_days': 1,
        'check': lambda p: _check_period_days(p.get('result_date'), p.get('result_end_date'), 1),
    },
    {
        'id': 'T005',
        'name': '合同签订时限',
        'description': '采购合同应在中标通知书发出之日起30日内签订',
        'law': '《政府采购法》第46条',
        'max_days': 30,
        'check': lambda p: _check_max_days(p.get('notice_date'), p.get('contract_date'), 30),
    },
]


def _check_period_days(start_str: str, end_str: str, min_days: int) -> dict:
    """检查两个日期之间的天数是否满足最低要求"""
    if not start_str or not end_str:
        return {'compliant': None, 'message': '日期信息不完整，无法检查'}
    
    try:
        start = datetime.strptime(start_str[:10], '%Y-%m-%d')
        end = datetime.strptime(end_str[:10], '%Y-%m-%d')
        delta = (end - start).days
        
        return {
            'compliant': delta >= min_days,
            'actual_days': delta,
            'required_days': min_days,
            'message': f'实际 {delta} 天，要求 ≥{min_days} 天' + (' ✅' if delta >= min_days else ' ❌'),
        }
    except (ValueError, TypeError):
        return {'compliant': None, 'message': '日期格式错误'}


def _check_max_days(start_str: str, end_str: str, max_days: int) -> dict:
    """检查两个日期之间的天数是否超过最大限制"""
    if not start_str or not end_str:
        return {'compliant': None, 'message': '日期信息不完整，无法检查'}
    
    try:
        start = datetime.strptime(start_str[:10], '%Y-%m-%d')
        end = datetime.strptime(end_str[:10], '%Y-%m-%d')
        delta = (end - start).days
        
        return {
            'compliant': delta <= max_days,
            'actual_days': delta,
            'max_days': max_days,
            'message': f'实际 {delta} 天，要求 ≤{max_days} 天' + (' ✅' if delta <= max_days else ' ❌'),
        }
    except (ValueError, TypeError):
        return {'compliant': None, 'message': '日期格式错误'}


# === 评分异常检测 ===

def detect_score_anomaly(scores: list) -> dict:
    """
    检测专家评审打分中的异常值
    
    使用 Grubbs 检验（简化版）：
    - 计算每个专家打分与平均值的偏差
    - 偏差 >30% 视为异常
    """
    if not scores or len(scores) < 3:
        return {'has_anomaly': False, 'message': '评分数据不足，无法检测'}
    
    avg = sum(scores) / len(scores)
    if avg == 0:
        return {'has_anomaly': False, 'message': '平均分为0，无法检测'}
    
    anomalies = []
    for i, score in enumerate(scores):
        deviation = abs(score - avg) / avg
        if deviation > 0.3:
            anomalies.append({
                'expert_index': i + 1,
                'score': score,
                'average': round(avg, 2),
                'deviation': f'{deviation*100:.1f}%',
            })
    
    return {
        'has_anomaly': len(anomalies) > 0,
        'anomaly_count': len(anomalies),
        'anomalies': anomalies,
        'message': f'发现 {len(anomalies)} 个异常评分' if anomalies else '未发现异常评分',
    }


# === 报价规律性检测 ===

def detect_price_pattern(prices: list) -> dict:
    """
    检测报价是否呈规律性（等差/等比）
    
    等差：相邻报价差值相近
    等比：相邻报价比值相近
    """
    if not prices or len(prices) < 3:
        return {'has_pattern': False, 'message': '报价数据不足'}
    
    sorted_prices = sorted(prices)
    
    # 检查等差
    diffs = [sorted_prices[i+1] - sorted_prices[i] for i in range(len(sorted_prices)-1)]
    avg_diff = sum(diffs) / len(diffs)
    diff_variance = sum((d - avg_diff) ** 2 for d in diffs) / len(diffs)
    
    # 检查等比
    ratios = [sorted_prices[i+1] / max(sorted_prices[i], 0.01) for i in range(len(sorted_prices)-1)]
    avg_ratio = sum(ratios) / len(ratios)
    ratio_variance = sum((r - avg_ratio) ** 2 for r in ratios) / len(ratios)
    
    # 方差小 → 规律性强
    is_arithmetic = diff_variance < avg_diff * 0.1
    is_geometric = ratio_variance < 0.01
    
    if is_arithmetic or is_geometric:
        return {
            'has_pattern': True,
            'pattern_type': '等差' if is_arithmetic else '等比',
            'prices': sorted_prices,
            'message': f'⚠️ 报价呈{"等差" if is_arithmetic else "等比"}规律，疑似串通投标',
        }
    
    return {'has_pattern': False, 'message': '未发现明显报价规律'}


# === 主审计引擎 ===

class ComplianceAuditor:
    """合规审计引擎"""
    
    def __init__(self, projects: list, bidders: list = None):
        self.projects = projects
        self.bidders = bidders or []
    
    def audit_project(self, project: dict) -> dict:
        """审计单个项目"""
        results = {
            'project_id': project.get('id', ''),
            'project_name': project.get('title', project.get('project_name', '')),
            'collusion_alerts': [],
            'time_compliance': [],
            'score_anomaly': None,
            'price_pattern': None,
            'overall_risk': 'low',
        }
        
        # 1. 围标串标检测
        project_bidders = project.get('bidders', [])
        if len(project_bidders) >= 2:
            for i in range(len(project_bidders)):
                for j in range(i + 1, len(project_bidders)):
                    b1, b2 = project_bidders[i], project_bidders[j]
                    for rule in COLLUSION_RULES:
                        if rule['check'] and rule['check'](b1, b2):
                            results['collusion_alerts'].append({
                                'rule_id': rule['id'],
                                'rule_name': rule['name'],
                                'description': rule['description'],
                                'risk_level': rule['risk_level'],
                                'bidder_pair': [b1.get('name', f'投标人{i+1}'), b2.get('name', f'投标人{j+1}')],
                            })
        
        # 报价规律性检测
        prices = [b.get('bid_price', 0) for b in project_bidders if b.get('bid_price')]
        if len(prices) >= 3:
            results['price_pattern'] = detect_price_pattern(prices)
        
        # 2. 时间节点合规
        for rule in TIME_COMPLIANCE_RULES:
            check_result = rule['check'](project)
            results['time_compliance'].append({
                'rule_id': rule['id'],
                'rule_name': rule['name'],
                'law': rule['law'],
                'result': check_result,
            })
        
        # 3. 评分异常检测
        expert_scores = project.get('expert_scores', [])
        if expert_scores:
            results['score_anomaly'] = detect_score_anomaly(expert_scores)
        
        # 综合风险等级
        high_risks = sum(1 for a in results['collusion_alerts'] if a['risk_level'] == 'high')
        medium_risks = sum(1 for a in results['collusion_alerts'] if a['risk_level'] == 'medium')
        time_violations = sum(1 for t in results['time_compliance'] 
                             if t['result'].get('compliant') == False)
        
        if high_risks >= 2 or (high_risks >= 1 and time_violations >= 1):
            results['overall_risk'] = 'high'
        elif high_risks >= 1 or medium_risks >= 2 or time_violations >= 2:
            results['overall_risk'] = 'medium'
        else:
            results['overall_risk'] = 'low'
        
        return results
    
    def audit_all(self) -> list:
        """审计所有项目"""
        results = []
        for project in self.projects:
            try:
                result = self.audit_project(project)
                results.append(result)
            except Exception as e:
                print(f"[ERROR] 审计项目时出错: {e}")
                continue
        return results
    
    def generate_report(self, results: list) -> str:
        """生成审计报告"""
        lines = []
        lines.append("# 政府采购合规审计报告")
        lines.append(f"\n生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
        lines.append(f"审计项目数：{len(results)}")
        
        # 风险统计
        high_risk = sum(1 for r in results if r['overall_risk'] == 'high')
        medium_risk = sum(1 for r in results if r['overall_risk'] == 'medium')
        low_risk = sum(1 for r in results if r['overall_risk'] == 'low')
        
        lines.append(f"\n风险分布：🔴高 {high_risk} | 🟡中 {medium_risk} | 🟢低 {low_risk}")
        lines.append("\n---\n")
        
        # 详细结果
        for result in results:
            risk_icon = {'high': '🔴', 'medium': '🟡', 'low': '🟢'}.get(result['overall_risk'], '⚪')
            lines.append(f"## {risk_icon} {result['project_name']}")
            lines.append(f"风险等级：{result['overall_risk']}")
            
            if result['collusion_alerts']:
                lines.append("\n### ⚠️ 围标串标预警")
                for alert in result['collusion_alerts']:
                    lines.append(f"- [{alert['rule_id']}] {alert['rule_name']}：{alert['description']}")
                    lines.append(f"  涉及：{' vs '.join(alert['bidder_pair'])}")
            
            if result['price_pattern'] and result['price_pattern'].get('has_pattern'):
                lines.append(f"\n### ⚠️ 报价规律性：{result['price_pattern']['message']}")
            
            if result['time_compliance']:
                violations = [t for t in result['time_compliance'] if t['result'].get('compliant') == False]
                if violations:
                    lines.append("\n### ❌ 时间节点违规")
                    for v in violations:
                        lines.append(f"- [{v['rule_id']}] {v['rule_name']}（{v['law']}）")
                        lines.append(f"  {v['result']['message']}")
            
            if result['score_anomaly'] and result['score_anomaly'].get('has_anomaly'):
                lines.append(f"\n### ⚠️ 评分异常：{result['score_anomaly']['message']}")
                for a in result['score_anomaly'].get('anomalies', []):
                    lines.append(f"- 专家{a['expert_index']}：打分 {a['score']}，偏离均值 {a['deviation']}")
            
            lines.append("")
        
        # 免责声明
        lines.append("---\n")
        lines.append("> ⚠️ 本报告基于公开信息和规则引擎自动生成，仅供参考。")
        lines.append("> 围标串标等违法行为的最终认定由相关执法部门依法作出。")
        
        return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='政府采购合规审计工具')
    parser.add_argument('--projects', required=True, help='项目 JSON 文件')
    parser.add_argument('--bidders', help='投标人 JSON 文件（可选）')
    parser.add_argument('--output', default='compliance_audit.json', help='输出结果文件')
    parser.add_argument('--report', default='compliance_audit_report.md', help='输出 Markdown 报告')
    
    args = parser.parse_args()
    
    # 加载数据
    with open(args.projects, 'r', encoding='utf-8') as f:
        projects = json.load(f)
    
    bidders = []
    if args.bidders:
        with open(args.bidders, 'r', encoding='utf-8') as f:
            bidders = json.load(f)
    
    # 确保 projects 是列表
    if isinstance(projects, dict) and 'data' in projects:
        projects = projects['data']
    
    print(f"\n合规审计开始")
    print(f"审计项目数：{len(projects)}")
    print("-" * 40)
    
    # 执行审计
    auditor = ComplianceAuditor(projects, bidders)
    results = auditor.audit_all()
    
    # 统计
    high_risk = sum(1 for r in results if r['overall_risk'] == 'high')
    medium_risk = sum(1 for r in results if r['overall_risk'] == 'medium')
    
    print(f"\n审计完成")
    print(f"  🔴 高风险：{high_risk}")
    print(f"  🟡 中风险：{medium_risk}")
    print(f"  🟢 低风险：{len(results) - high_risk - medium_risk}")
    
    # 保存结果
    output_data = {
        'generated_at': datetime.now().isoformat(),
        'total_projects': len(results),
        'risk_summary': {
            'high': high_risk,
            'medium': medium_risk,
            'low': len(results) - high_risk - medium_risk,
        },
        'results': results,
    }
    
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print(f"\n结果已保存：{os.path.abspath(args.output)}")
    
    # 生成 Markdown 报告
    report = auditor.generate_report(results)
    with open(args.report, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"报告已保存：{os.path.abspath(args.report)}")
    
    return output_data


if __name__ == '__main__':
    main()
