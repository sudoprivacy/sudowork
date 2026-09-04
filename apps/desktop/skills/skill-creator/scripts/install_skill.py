#!/usr/bin/env python3
"""
Install a staged Sudowork custom skill into the personal custom-skill directory.

Usage:
    python scripts/install_skill.py <path/to/staged-skill-or-zip> [options]

Examples:
    python scripts/install_skill.py ./my-skill --move
    python scripts/install_skill.py ./skill-packages/my-skill.zip --replace
"""

import argparse
import json
import re
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from quick_validate import validate_skill


DEFAULT_INSTALL_ROOT = Path.home() / '.nexus' / 'skills' / '_my-custom-skill'
EXCLUDED_DIRS = {'__pycache__', '.git', '.svn', '.hg'}
EXCLUDED_FILE_NAMES = {'.DS_Store'}
EXCLUDED_FILE_SUFFIXES = {'.pyc', '.pyo'}
META_FILE_NAME = '_sudowork_meta.json'
SKILL_FILE_NAME = 'SKILL.md'


def iso_now():
    """Return an ISO timestamp compatible with Sudowork metadata."""
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def title_case_skill_name(skill_name):
    """Convert a hyphenated skill name to a readable display name."""
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


def is_relative_to(path, parent):
    """Return whether path is inside parent without requiring Python 3.9 Path.is_relative_to."""
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def should_include_file(file_path):
    """Return whether a file should be copied into the installed skill."""
    if file_path.name in EXCLUDED_FILE_NAMES:
        return False
    if file_path.suffix in EXCLUDED_FILE_SUFFIXES:
        return False
    if any(part in EXCLUDED_DIRS for part in file_path.parts):
        return False
    return True


def copy_skill_tree(source_dir, target_dir):
    """Copy a skill directory while excluding cache and VCS files."""
    for source_path in source_dir.rglob('*'):
        relative_path = source_path.relative_to(source_dir)
        if any(part in EXCLUDED_DIRS for part in relative_path.parts):
            continue

        target_path = target_dir / relative_path
        if source_path.is_dir():
            target_path.mkdir(parents=True, exist_ok=True)
            continue
        if not source_path.is_file() or not should_include_file(source_path):
            continue

        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target_path)


def read_skill_name(skill_dir):
    """Read the skill name from SKILL.md frontmatter."""
    skill_md = skill_dir / SKILL_FILE_NAME
    content = skill_md.read_text(encoding='utf-8')
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        raise ValueError('SKILL.md must start with YAML frontmatter')

    for line in match.group(1).splitlines():
        key_match = re.match(r'^name:\s*(.+?)\s*$', line)
        if not key_match:
            continue
        value = key_match.group(1).strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        return value.strip()

    raise ValueError('SKILL.md frontmatter is missing name')


def normalize_metadata(skill_dir, skill_name):
    """Ensure installed custom skills carry Sudowork local custom-skill metadata."""
    meta_path = skill_dir / META_FILE_NAME
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
        except json.JSONDecodeError as error:
            raise ValueError(f'Invalid JSON in {META_FILE_NAME}: {error}') from error
        if not isinstance(meta, dict):
            raise ValueError(f'{META_FILE_NAME} must contain a JSON object')
    else:
        meta = {}

    icon = meta.get('icon')
    if not icon and (skill_dir / 'icon.svg').exists():
        icon = 'icon.svg'

    meta.update(
        {
            'id': meta.get('id', ''),
            'name': skill_name,
            'display_name': meta.get('display_name') or title_case_skill_name(skill_name),
            'description': meta.get('description', ''),
            'icon': icon,
            'emoji': meta.get('emoji'),
            'category': meta.get('category', ''),
            'categories': meta.get('categories') if isinstance(meta.get('categories'), list) else [],
            'applicable_scenarios': meta.get('applicable_scenarios'),
            'core_features': meta.get('core_features'),
            'homepage': meta.get('homepage'),
            'author_id': meta.get('author_id', ''),
            'source_type': 'upload',
            'is_builtin': False,
            'enabled': True,
            'installed_version': meta.get('installed_version', '1.0.0'),
            'installed_at': iso_now(),
        }
    )

    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def remove_path(path):
    """Remove a file, symlink, or directory."""
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def extract_zip(zip_path):
    """Extract a skill zip into a temporary directory and return the staged skill folder."""
    extract_root = Path(tempfile.mkdtemp(prefix='sudowork-skill-zip-'))
    extract_root_resolved = extract_root.resolve()

    try:
        with zipfile.ZipFile(zip_path) as zip_file:
            for member in zip_file.infolist():
                member_target = (extract_root / member.filename).resolve()
                if not is_relative_to(member_target, extract_root_resolved):
                    raise ValueError(f'Unsafe zip entry path: {member.filename}')
            zip_file.extractall(extract_root)

        candidates = [path.parent for path in extract_root.rglob(SKILL_FILE_NAME)]
        if len(candidates) != 1:
            raise ValueError('Zip must contain exactly one skill folder with SKILL.md')
        return candidates[0], extract_root
    except Exception:
        remove_path(extract_root)
        raise


def resolve_source(input_path):
    """Return source skill dir and temp extraction root, if any."""
    source = Path(input_path).expanduser().resolve()
    if not source.exists():
        raise ValueError(f'Source path not found: {source}')
    if source.is_dir():
        if not (source / SKILL_FILE_NAME).exists():
            raise ValueError(f'SKILL.md not found in source directory: {source}')
        return source, None
    if source.is_file() and source.suffix.lower() == '.zip':
        return extract_zip(source)
    raise ValueError('Source must be a skill directory or .zip file')


def install_skill(source_path, install_root=DEFAULT_INSTALL_ROOT, replace=False, move=False):
    """
    Install a staged skill into ~/.nexus/skills/_my-custom-skill/<skill-name>.

    Args:
        source_path: Staged skill folder or package zip
        install_root: Root directory for personal custom skills
        replace: Whether to replace an existing installed skill with the same name
        move: Whether to remove the source directory after a successful folder install
    """
    extracted_root = None
    source_dir = None
    work_root = None
    try:
        source_dir, extracted_root = resolve_source(source_path)
        skill_name = read_skill_name(source_dir)
        name_error = validate_skill_name(skill_name)
        if name_error:
            raise ValueError(name_error)

        install_root = Path(install_root).expanduser().resolve()
        install_root.mkdir(parents=True, exist_ok=True)
        target_dir = install_root / skill_name

        if target_dir.exists() or target_dir.is_symlink():
            if not replace:
                raise ValueError(f'Installed skill already exists: {target_dir}. Use --replace to overwrite it.')

        work_root = Path(tempfile.mkdtemp(prefix=f'.{skill_name}-install-', dir=install_root))
        prepared_dir = work_root / skill_name
        copy_skill_tree(source_dir, prepared_dir)
        normalize_metadata(prepared_dir, skill_name)

        valid, message = validate_skill(prepared_dir)
        if not valid:
            raise ValueError(f'Validation failed: {message}')

        backup_dir = None
        if target_dir.exists() or target_dir.is_symlink():
            backup_dir = work_root / f'{skill_name}.previous'
            target_dir.rename(backup_dir)

        try:
            prepared_dir.rename(target_dir)
        except Exception:
            if backup_dir and backup_dir.exists() and not target_dir.exists():
                backup_dir.rename(target_dir)
            raise

        if backup_dir and backup_dir.exists():
            remove_path(backup_dir)

        remove_path(work_root)
        work_root = None

        source_path_resolved = Path(source_path).expanduser().resolve()
        if move and source_path_resolved.is_dir() and source_path_resolved != target_dir.resolve():
            remove_path(source_path_resolved)

        print(f"✅ Installed skill to: {target_dir}")
        if move and source_path_resolved.is_file():
            print("   Source zip was kept; --move only removes staged source directories.")
        print("   Reload or restart Sudowork so it can rescan custom skills.")
        return target_dir
    except Exception as error:
        if work_root and work_root.exists():
            remove_path(work_root)
        if extracted_root and extracted_root.exists():
            remove_path(extracted_root)
        print(f"❌ Error: {error}")
        return None
    finally:
        if extracted_root and extracted_root.exists():
            remove_path(extracted_root)


def main():
    parser = argparse.ArgumentParser(description="安装临时产出的 Sudowork 自定义技能。")
    parser.add_argument('source', help='临时技能目录或 package_skill.py 生成的 .zip')
    parser.add_argument(
        '--install-root',
        default=str(DEFAULT_INSTALL_ROOT),
        help='自定义技能安装根目录，默认 ~/.nexus/skills/_my-custom-skill',
    )
    parser.add_argument('--replace', action='store_true', help='覆盖同名已安装自定义技能')
    parser.add_argument('--move', action='store_true', help='安装成功后删除临时技能目录')
    args = parser.parse_args()

    result = install_skill(args.source, install_root=args.install_root, replace=args.replace, move=args.move)
    sys.exit(0 if result else 1)


if __name__ == '__main__':
    main()
