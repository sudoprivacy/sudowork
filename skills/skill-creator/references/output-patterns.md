# Output Patterns

当 skill 需要产出稳定、高质量的结果时，使用这些模式。

## Template Pattern / 模板模式

为输出格式提供模板。严格程度取决于任务需要。

**严格要求场景（例如 API response 或数据格式）：**

```markdown
## Report structure

ALWAYS use this exact template structure:

# [Analysis Title]

## Executive summary

[One-paragraph overview of key findings]

## Key findings

- Finding 1 with supporting data
- Finding 2 with supporting data
- Finding 3 with supporting data

## Recommendations

1. Specific actionable recommendation
2. Specific actionable recommendation
```

**灵活指导场景（允许根据上下文调整）：**

```markdown
## Report structure

Here is a sensible default format, but use your best judgment:

# [Analysis Title]

## Executive summary

[Overview]

## Key findings

[Adapt sections based on what you discover]

## Recommendations

[Tailor to the specific context]

Adjust sections as needed for the specific analysis type.
```

## Examples Pattern / 示例模式

如果输出质量依赖风格和细节，可以提供输入/输出示例：

```markdown
## Commit message format

Generate commit messages following these examples:

**Example 1:**
Input: Added user authentication with JWT tokens
Output:
```

feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware

```

**Example 2:**
Input: Fixed bug where dates displayed incorrectly in reports
Output:
```

fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation

```

Follow this style: type(scope): brief description, then detailed explanation.
```

示例比抽象描述更能帮助 agent 理解期望风格和细节层级。
