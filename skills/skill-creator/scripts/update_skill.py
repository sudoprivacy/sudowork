#!/usr/bin/env python3
"""
Skill Updater - 更新已有 Sudowork 自定义技能的 metadata、name、description 和 icon。

Usage:
    update_skill.py <path/to/skill-folder> [options]

Examples:
    update_skill.py ./dist/my-skill --display-name "新的显示名称"
    update_skill.py ./dist/my-skill --name new-skill-name --description "新的技能描述"
    update_skill.py ./dist/my-skill --icon ./icon.svg --category "开发" --emoji "🛠️"
"""

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


META_FILE_NAME = '_sudowork_meta.json'
SKILL_FILE_NAME = 'SKILL.md'
IMAGE_SUFFIXES = {'.svg', '.png', '.jpg', '.jpeg', '.webp'}


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


def escape_yaml_string(value):
    """Escape a string for use in a double-quoted YAML scalar."""
    return value.replace('\\', '\\\\').replace('"', '\\"')


def read_skill_frontmatter(skill_md_path):
    """Return frontmatter dict and original body for a SKILL.md file."""
    content = skill_md_path.read_text(encoding='utf-8')
    match = re.match(r'^---\n(.*?)\n---\n?', content, re.DOTALL)
    if not match:
        raise ValueError('SKILL.md must start with YAML frontmatter')

    frontmatter_text = match.group(1)
    body = content[match.end():]

    frontmatter = {}
    for line in frontmatter_text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key_match = re.match(r'^([A-Za-z0-9_-]+):\s*(.*)$', line)
        if not key_match:
            continue
        key = key_match.group(1)
        value = key_match.group(2).strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        frontmatter[key] = value

    return frontmatter, body


def write_skill_frontmatter(skill_md_path, frontmatter, body):
    """Write SKILL.md with a compact, stable frontmatter block."""
    ordered_keys = ['name', 'description', 'license', 'allowed-tools', 'metadata']
    lines = []
    written = set()

    for key in ordered_keys:
        if key not in frontmatter:
            continue
        value = frontmatter[key]
        if key == 'description':
            lines.append(f'{key}: "{escape_yaml_string(str(value))}"')
        else:
            lines.append(f'{key}: {value}')
        written.add(key)

    for key in sorted(set(frontmatter.keys()) - written):
        value = frontmatter[key]
        lines.append(f'{key}: {value}')

    skill_md_path.write_text('---\n' + '\n'.join(lines) + '\n---\n' + body, encoding='utf-8')


def title_case_skill_name(skill_name):
    """Convert hyphenated skill name to Title Case for display."""
    return ' '.join(word.capitalize() for word in skill_name.split('-'))


def update_first_heading(body, title):
    """Update the first Markdown H1 heading, or insert one when missing."""
    if not title:
        return body
    replacement = f'# {title}'
    if re.search(r'^# .+$', body, re.MULTILINE):
        return re.sub(r'^# .+$', replacement, body, count=1, flags=re.MULTILINE)
    return replacement + '\n\n' + body.lstrip()


def load_meta(meta_path):
    """Load existing Sudowork metadata or return a custom-skill default."""
    if not meta_path.exists():
        return {}
    return json.loads(meta_path.read_text(encoding='utf-8'))


def save_meta(meta_path, meta):
    """Persist Sudowork metadata."""
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def copy_icon(icon_path, skill_dir):
    """Copy a new icon into the skill directory and return its relative filename."""
    source = Path(icon_path).expanduser().resolve()
    if not source.exists() or not source.is_file():
        raise ValueError(f'Icon file not found: {icon_path}')
    if source.suffix.lower() not in IMAGE_SUFFIXES:
        raise ValueError(f'Icon must be one of: {", ".join(sorted(IMAGE_SUFFIXES))}')

    target_name = f'icon{source.suffix.lower()}'
    target = skill_dir / target_name
    if source != target.resolve():
        shutil.copyfile(source, target)
    return target_name


def update_skill(skill_path, args):
    """Update a Sudowork custom skill in place."""
    skill_dir = Path(skill_path).expanduser().resolve()
    if not skill_dir.exists() or not skill_dir.is_dir():
        print(f"❌ Error: Skill directory not found: {skill_dir}")
        return None

    skill_md_path = skill_dir / SKILL_FILE_NAME
    if not skill_md_path.exists():
        print(f"❌ Error: SKILL.md not found in {skill_dir}")
        return None

    frontmatter, body = read_skill_frontmatter(skill_md_path)
    meta_path = skill_dir / META_FILE_NAME
    meta = load_meta(meta_path)

    current_name = (frontmatter.get('name') or meta.get('name') or skill_dir.name).strip()
    new_name = args.name.strip() if args.name else current_name
    name_error = validate_skill_name(new_name)
    if name_error:
        print(f"❌ Error: {name_error}")
        return None

    frontmatter['name'] = new_name
    if args.description is not None:
        frontmatter['description'] = args.description
    elif 'description' not in frontmatter:
        frontmatter['description'] = meta.get('description', '')

    if args.title is not None:
        body = update_first_heading(body, args.title)
    elif args.display_name is not None:
        body = update_first_heading(body, args.display_name)
    elif args.name is not None:
        body = update_first_heading(body, title_case_skill_name(new_name))

    icon_ref = None
    if args.icon:
        try:
            icon_ref = copy_icon(args.icon, skill_dir)
        except ValueError as error:
            print(f"❌ Error: {error}")
            return None

    meta.update(
        {
            'name': new_name,
            'display_name': args.display_name if args.display_name is not None else meta.get('display_name') or new_name,
            'description': args.description if args.description is not None else meta.get('description') or frontmatter.get('description', ''),
            'icon': icon_ref if icon_ref is not None else meta.get('icon', 'icon.svg'),
            'emoji': args.emoji if args.emoji is not None else meta.get('emoji'),
            'category': args.category if args.category is not None else meta.get('category', ''),
            'homepage': args.homepage if args.homepage is not None else meta.get('homepage'),
            'author_id': meta.get('author_id', ''),
            'source_type': 'upload',
            'is_builtin': False,
            'enabled': True,
            'installed_version': args.version if args.version is not None else meta.get('installed_version', '1.0.0'),
            'installed_at': meta.get('installed_at') or iso_now(),
        }
    )

    if args.categories:
        meta['categories'] = [item.strip() for item in args.categories.split(',') if item.strip()]
    elif args.category is not None:
        meta['categories'] = [args.category] if args.category else []
    else:
        meta['categories'] = meta.get('categories', [])

    if 'id' not in meta:
        meta['id'] = ''
    if 'applicable_scenarios' not in meta:
        meta['applicable_scenarios'] = None
    if 'core_features' not in meta:
        meta['core_features'] = None

    write_skill_frontmatter(skill_md_path, frontmatter, body)
    save_meta(meta_path, meta)

    final_dir = skill_dir
    if new_name != skill_dir.name:
        target_dir = skill_dir.parent / new_name
        if target_dir.exists():
            print(f"❌ Error: Target skill directory already exists: {target_dir}")
            return None
        skill_dir.rename(target_dir)
        final_dir = target_dir
        print(f"✅ Renamed skill directory: {skill_dir} -> {target_dir}")

    print(f"✅ Updated skill: {final_dir}")
    print("下一步:")
    print(f"1. 视需要继续手动更新 {SKILL_FILE_NAME}、scripts/、references/ 或 assets/")
    print(f"2. 运行 quick_validate.py {final_dir}")
    print(f"3. 运行 package_skill.py {final_dir} ./skill-packages")
    print(f"4. 运行 install_skill.py {final_dir} --replace 安装到 ~/.nexus/skills/_my-custom-skill")
    return final_dir


def main():
    parser = argparse.ArgumentParser(description="更新已有 Sudowork 自定义技能。")
    parser.add_argument('skill_path', help='技能目录路径')
    parser.add_argument('--name', help='新的 hyphen-case 技能 name；会同步目录名、SKILL.md 和 metadata')
    parser.add_argument('--display-name', help='新的 Sudowork 显示名称')
    parser.add_argument('--title', help='新的 SKILL.md 一级标题；默认跟随 display-name 或 name 更新')
    parser.add_argument('--description', help='新的技能描述；会同步 SKILL.md frontmatter 和 metadata')
    parser.add_argument('--icon', help='新的头像/icon 文件路径，会复制为技能目录下的 icon.<ext>')
    parser.add_argument('--category', help='新的主分类，例如 开发')
    parser.add_argument('--categories', help='逗号分隔分类列表，例如 开发,办公')
    parser.add_argument('--emoji', help='新的 emoji')
    parser.add_argument('--version', help='新的 installed_version，例如 1.1.0')
    parser.add_argument('--homepage', help='新的 homepage URL')
    args = parser.parse_args()

    result = update_skill(args.skill_path, args)
    sys.exit(0 if result else 1)


if __name__ == '__main__':
    main()
