#!/usr/bin/env python3
"""
Skill Initializer - 创建新的 Sudowork 自定义技能模板

Usage:
    init_skill.py <skill-name> [options]

Examples:
    init_skill.py my-new-skill
    init_skill.py my-api-helper --display-name "API Helper"
    init_skill.py custom-skill --path ./skill-staging --category "开发"
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


SKILL_TEMPLATE = """---
name: {skill_name}
description: "{skill_description}"
---

# {skill_title}

## 概览

[TODO: 用 1-2 句话说明这个技能让 agent 具备什么能力]

## 组织这个技能

[TODO: 选择最适合该技能目标的结构。常见模式：

**1. Workflow-Based / 工作流型**（适合连续步骤）
- 适用于有清晰步骤顺序的任务
- 示例：DOCX 技能使用“工作流决策树”→“读取”→“创建”→“编辑”
- 结构：## 概览 → ## 工作流决策树 → ## 步骤 1 → ## 步骤 2...

**2. Task-Based / 任务型**（适合工具集合）
- 适用于技能提供多个操作或能力
- 示例：PDF 技能使用“快速开始”→“合并 PDF”→“拆分 PDF”→“提取文本”
- 结构：## 概览 → ## 快速开始 → ## 任务类别 1 → ## 任务类别 2...

**3. Reference/Guidelines / 规范型**（适合标准或规格）
- 适用于品牌规范、编码标准或需求规则
- 示例：品牌样式技能使用“品牌规范”→“颜色”→“字体”→“功能”
- 结构：## 概览 → ## 规范 → ## 规格 → ## 使用方式...

**4. Capabilities-Based / 能力型**（适合集成系统）
- 适用于技能提供多个相互关联的能力
- 示例：产品管理技能使用“核心能力”→ 编号能力列表
- 结构：## 概览 → ## 核心能力 → ### 1. 能力 → ### 2. 能力...

可以按需混合这些模式。多数技能会组合使用，例如先按任务组织，再为复杂操作补充工作流。

完成后删除整个“组织这个技能”章节；它只是模板指导。]

## [TODO: 根据所选结构替换为第一个主要章节]

[TODO: 在这里添加内容。可参考现有技能中的写法：
- 技术技能使用代码示例
- 复杂流程使用决策树
- 使用真实用户请求作为具体例子
- 按需引用 scripts/templates/references]

## Resources

本技能包含示例资源目录，用于展示 bundled resources 的组织方式：

### scripts/
可直接运行的代码（Python/Bash 等），用于执行特定操作。

**其他技能示例：**
- PDF skill：`fill_fillable_fields.py`、`extract_form_field_info.py`，用于 PDF 处理
- DOCX skill：`document.py`、`utilities.py`，用于文档处理

**适合放入：** Python 脚本、shell 脚本，或任何执行自动化、数据处理、特定操作的可执行代码。

**注意：** 脚本可以不加载进上下文就执行，但 agent 仍可在需要修改或适配环境时读取它们。

### references/
按需加载进上下文的文档和参考材料，用来支持 agent 的执行过程。

**其他技能示例：**
- 产品管理：`communication.md`、`context_building.md`，详细工作流指南
- BigQuery：API 参考文档和查询示例
- 财务：schema 文档、公司政策

**适合放入：** 深入文档、API 参考、数据库 schema、完整指南，或 agent 工作时需要引用的详细信息。

### assets/
不打算加载进上下文、但会在最终输出中使用的文件。

**其他技能示例：**
- 品牌样式：PowerPoint 模板（.pptx）、logo 文件
- 前端构建：HTML/React boilerplate 项目目录
- 字体：字体文件（.ttf、.woff2）

**适合放入：** 模板、boilerplate 代码、文档模板、图片、图标、字体，或任何需要复制到最终输出中的文件。

---

**删除不需要的目录。** 不是每个技能都需要这三类资源。
"""

ICON_TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="{skill_title} icon">
  <defs>
    <linearGradient id="g" x1="18" y1="18" x2="110" y2="110" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2563eb"/>
      <stop offset="1" stop-color="#14b8a6"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <path d="M38 67.5 57.5 87 92 42.5" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""
{skill_name} 的示例辅助脚本

这是一个可直接执行的占位脚本。
请替换为真实实现，或在不需要时删除。

Example real scripts from other skills:
- pdf/scripts/fill_fillable_fields.py - Fills PDF form fields
- pdf/scripts/convert_pdf_to_images.py - Converts PDF pages to images
"""

def main():
    print("This is an example script for {skill_name}")
    # TODO: 在这里添加真实脚本逻辑
    # 例如数据处理、文件转换、API 调用等

if __name__ == "__main__":
    main()
'''

EXAMPLE_REFERENCE = """# {skill_title} 参考文档

这是详细参考文档的占位文件。
请替换为真实参考内容，或在不需要时删除。

Example real reference docs from other skills:
- product-management/references/communication.md - Comprehensive guide for status updates
- product-management/references/context_building.md - Deep-dive on gathering context
- bigquery/references/ - API references and query examples

## 什么时候适合使用 Reference Docs

Reference docs 适合：
- 完整 API 文档
- 详细工作流指南
- 复杂多步骤流程
- 不适合放进主 `SKILL.md` 的长内容
- 只在特定场景需要的内容

## 结构建议

### API Reference 示例
- 概览
- 鉴权
- 带示例的 endpoints
- 错误码
- 频率限制

### Workflow Guide 示例
- 前置条件
- 分步说明
- 常见模式
- 故障排查
- 最佳实践
"""

EXAMPLE_ASSET = """# 示例 Asset 文件

这里用于表示 asset 文件的存放位置。
请替换为真实 asset 文件（模板、图片、字体等），或在不需要时删除。

Asset 文件通常不加载进上下文，而是在 agent 产出的最终结果中使用。

其他技能中的 asset 示例：
- 品牌规范：logo.png、slides_template.pptx
- 前端构建：包含 HTML/React boilerplate 的 hello-world/ 目录
- 字体：custom-font.ttf、font-family.woff2
- 数据：sample_data.csv、test_dataset.json

## 常见 Asset 类型

- 模板：.pptx、.docx、boilerplate 目录
- 图片：.png、.jpg、.svg、.gif
- 字体：.ttf、.otf、.woff、.woff2
- Boilerplate 代码：项目目录、starter 文件
- 图标：.ico、.svg
- 数据文件：.csv、.json、.xml、.yaml

注意：这是文本占位文件；真实 assets 可以是任意文件类型。
"""


def title_case_skill_name(skill_name):
    """Convert hyphenated skill name to Title Case for display."""
    return ' '.join(word.capitalize() for word in skill_name.split('-'))


def validate_skill_name(skill_name):
    """Validate Sudowork/Codex skill names."""
    if not re.match(r'^[a-z0-9-]+$', skill_name):
        return "Skill name must use lowercase letters, digits, and hyphens only"
    if skill_name.startswith('-') or skill_name.endswith('-') or '--' in skill_name:
        return "Skill name cannot start/end with hyphen or contain consecutive hyphens"
    if len(skill_name) > 64:
        return "Skill name must be 64 characters or fewer"
    return None


def iso_now():
    """Return an ISO timestamp compatible with Sudowork metadata."""
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def build_sudowork_meta(skill_name, display_name, description, category, emoji, version):
    """Build Sudowork UI metadata for a locally created custom skill."""
    categories = [category] if category else []
    return {
        "id": "",
        "name": skill_name,
        "display_name": display_name,
        "description": description,
        "icon": "icon.svg",
        "emoji": emoji or None,
        "category": category or "",
        "categories": categories,
        "applicable_scenarios": None,
        "core_features": None,
        "homepage": None,
        "author_id": "",
        "source_type": "upload",
        "is_builtin": False,
        "enabled": True,
        "installed_version": version,
        "installed_at": iso_now(),
    }


def escape_yaml_string(value):
    """Escape a string for use in a double-quoted YAML scalar."""
    return value.replace('\\', '\\\\').replace('"', '\\"')


def default_staging_root():
    """Return the current workspace as the default staging root."""
    return Path.cwd()


def init_skill(skill_name, path, display_name=None, description='', category='', emoji=None, version='1.0.0'):
    """
    Initialize a new Sudowork custom skill directory with template files.

    Args:
        skill_name: Name of the skill
        path: Path where the skill directory should be created
        display_name: Human-facing display name for Sudowork
        description: Human-facing description for Sudowork

    Returns:
        Path to created skill directory, or None if error
    """
    name_error = validate_skill_name(skill_name)
    if name_error:
        print(f"❌ Error: {name_error}")
        return None

    # Determine skill directory path
    skill_dir = Path(path).resolve() / skill_name

    # Check if directory already exists
    if skill_dir.exists():
        print(f"❌ Error: Skill directory already exists: {skill_dir}")
        return None

    # Create skill directory
    try:
        skill_dir.mkdir(parents=True, exist_ok=False)
        print(f"✅ Created skill directory: {skill_dir}")
    except Exception as e:
        print(f"❌ Error creating directory: {e}")
        return None

    # Create SKILL.md from template
    skill_title = title_case_skill_name(skill_name)
    skill_description = description or 'TODO: 清晰说明这个技能做什么，以及什么时候使用它；包含具体触发场景、文件类型或任务。'
    skill_content = SKILL_TEMPLATE.format(
        skill_name=skill_name,
        skill_title=skill_title,
        skill_description=escape_yaml_string(skill_description),
    )

    skill_md_path = skill_dir / 'SKILL.md'
    try:
        skill_md_path.write_text(skill_content, encoding='utf-8')
        print("✅ Created SKILL.md")
    except Exception as e:
        print(f"❌ Error creating SKILL.md: {e}")
        return None

    # Create Sudowork UI metadata
    meta_path = skill_dir / '_sudowork_meta.json'
    try:
        meta = build_sudowork_meta(
            skill_name=skill_name,
            display_name=display_name or skill_title,
            description=description,
            category=category,
            emoji=emoji,
            version=version,
        )
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print("✅ Created _sudowork_meta.json")
    except Exception as e:
        print(f"❌ Error creating _sudowork_meta.json: {e}")
        return None

    # Create a default local icon so Sudowork can render a stable custom-skill card
    icon_path = skill_dir / 'icon.svg'
    try:
        icon_path.write_text(ICON_TEMPLATE.format(skill_title=skill_title), encoding='utf-8')
        print("✅ Created icon.svg")
    except Exception as e:
        print(f"❌ Error creating icon.svg: {e}")
        return None

    # Create resource directories with example files
    try:
        # Create scripts/ directory with example script
        scripts_dir = skill_dir / 'scripts'
        scripts_dir.mkdir(exist_ok=True)
        example_script = scripts_dir / 'example.py'
        example_script.write_text(EXAMPLE_SCRIPT.format(skill_name=skill_name), encoding='utf-8')
        example_script.chmod(0o755)
        print("✅ Created scripts/example.py")

        # Create references/ directory with example reference doc
        references_dir = skill_dir / 'references'
        references_dir.mkdir(exist_ok=True)
        example_reference = references_dir / 'api_reference.md'
        example_reference.write_text(EXAMPLE_REFERENCE.format(skill_title=skill_title), encoding='utf-8')
        print("✅ Created references/api_reference.md")

        # Create assets/ directory with example asset placeholder
        assets_dir = skill_dir / 'assets'
        assets_dir.mkdir(exist_ok=True)
        example_asset = assets_dir / 'example_asset.txt'
        example_asset.write_text(EXAMPLE_ASSET, encoding='utf-8')
        print("✅ Created assets/example_asset.txt")
    except Exception as e:
        print(f"❌ Error creating resource directories: {e}")
        return None

    # Print next steps
    print(f"\n✅ Skill '{skill_name}' initialized successfully at {skill_dir}")
    print("\n下一步:")
    print("1. 编辑 SKILL.md，完成 TODO 并更新 description")
    print("2. 按需更新 _sudowork_meta.json 展示字段")
    print("3. 自定义或删除 scripts/、references/、assets/ 中的示例文件")
    print("4. 准备好后运行 quick_validate.py、package_skill.py 和 install_skill.py")

    return skill_dir


def main():
    parser = argparse.ArgumentParser(description="创建 Sudowork 自定义技能模板。")
    parser.add_argument("skill_name", help="Hyphen-case 技能名，例如 data-analyzer")
    parser.add_argument(
        "--path",
        default=str(default_staging_root()),
        help="创建技能文件夹的临时空间目录；默认使用当前工作目录，也就是 Sudowork 会话右侧的临时空间",
    )
    parser.add_argument("--display-name", help="Sudowork 中显示给用户看的名称")
    parser.add_argument("--description", default="", help="Sudowork 中显示给用户看的描述")
    parser.add_argument("--category", default="", help="Sudowork 展示分类，例如 开发")
    parser.add_argument("--emoji", help="写入 Sudowork 元数据的可选 emoji")
    parser.add_argument("--version", default="1.0.0", help="初始 installed_version 元数据值")
    args = parser.parse_args()

    skill_name = args.skill_name
    path = args.path

    print(f"🚀 Initializing skill: {skill_name}")
    print(f"   Location: {path}")
    print()

    result = init_skill(
        skill_name=skill_name,
        path=path,
        display_name=args.display_name,
        description=args.description,
        category=args.category,
        emoji=args.emoji,
        version=args.version,
    )

    if result:
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
