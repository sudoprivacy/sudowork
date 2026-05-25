# Workflow Patterns

## Sequential Workflows / 顺序工作流

复杂任务应拆成清晰的连续步骤。通常可以在 `SKILL.md` 开头附近先给 agent 一个整体流程概览：

```markdown
填写 PDF 表单包含这些步骤：

1. 分析表单（运行 analyze_form.py）
2. 创建字段映射（编辑 fields.json）
3. 校验映射（运行 validate_fields.py）
4. 填写表单（运行 fill_form.py）
5. 验证输出（运行 verify_output.py）
```

## Conditional Workflows / 条件工作流

如果任务存在分支逻辑，应明确引导 agent 做决策：

```markdown
1. 判断修改类型：
   **创建新内容？** → 使用下面的“创建工作流”
   **编辑已有内容？** → 使用下面的“编辑工作流”

2. 创建工作流：[步骤]
3. 编辑工作流：[步骤]
```
