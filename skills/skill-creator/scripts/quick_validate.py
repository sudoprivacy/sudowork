#!/usr/bin/env python3
"""Quick validation script for Sudowork custom skills."""

import json
import re
import sys
import yaml
from pathlib import Path


META_FILE_NAME = '_sudowork_meta.json'
META_SOURCE_TYPES = {'upload', 'custom', 'hub', 'tenant'}


def validate_skill(skill_path):
    """Basic validation of a Sudowork-compatible skill."""
    skill_path = Path(skill_path)

    # Check SKILL.md exists
    skill_md = skill_path / 'SKILL.md'
    if not skill_md.exists():
        return False, "SKILL.md not found"

    # Read and validate frontmatter
    content = skill_md.read_text()
    if not content.startswith('---'):
        return False, "No YAML frontmatter found"

    # Extract frontmatter
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return False, "Invalid frontmatter format"

    frontmatter_text = match.group(1)

    # Parse YAML frontmatter
    try:
        frontmatter = yaml.safe_load(frontmatter_text)
        if not isinstance(frontmatter, dict):
            return False, "Frontmatter must be a YAML dictionary"
    except yaml.YAMLError as e:
        return False, f"Invalid YAML in frontmatter: {e}"

    # Define allowed properties
    ALLOWED_PROPERTIES = {'name', 'description', 'license', 'allowed-tools', 'metadata'}

    # Check for unexpected properties (excluding nested keys under metadata)
    unexpected_keys = set(frontmatter.keys()) - ALLOWED_PROPERTIES
    if unexpected_keys:
        return False, (
            f"Unexpected key(s) in SKILL.md frontmatter: {', '.join(sorted(unexpected_keys))}. "
            f"Allowed properties are: {', '.join(sorted(ALLOWED_PROPERTIES))}"
        )

    # Check required fields
    if 'name' not in frontmatter:
        return False, "Missing 'name' in frontmatter"
    if 'description' not in frontmatter:
        return False, "Missing 'description' in frontmatter"

    # Extract name for validation
    name = frontmatter.get('name', '')
    if not isinstance(name, str):
        return False, f"Name must be a string, got {type(name).__name__}"
    name = name.strip()
    if name:
        # Check naming convention (hyphen-case: lowercase with hyphens)
        if not re.match(r'^[a-z0-9-]+$', name):
            return False, f"Name '{name}' should be hyphen-case (lowercase letters, digits, and hyphens only)"
        if name.startswith('-') or name.endswith('-') or '--' in name:
            return False, f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens"
        # Check name length (max 64 characters per spec)
        if len(name) > 64:
            return False, f"Name is too long ({len(name)} characters). Maximum is 64 characters."

    # Extract and validate description
    description = frontmatter.get('description', '')
    if not isinstance(description, str):
        return False, f"Description must be a string, got {type(description).__name__}"
    description = description.strip()
    if description:
        # Check for angle brackets
        if '<' in description or '>' in description:
            return False, "Description cannot contain angle brackets (< or >)"
        # Check description length (max 1024 characters per spec)
        if len(description) > 1024:
            return False, f"Description is too long ({len(description)} characters). Maximum is 1024 characters."

    meta_path = skill_path / META_FILE_NAME
    if meta_path.exists():
        valid, message = validate_sudowork_meta(meta_path, name, skill_path.name)
        if not valid:
            return False, message

    return True, "Skill is valid!"


def validate_sudowork_meta(meta_path, skill_name, dir_name):
    """Validate Sudowork UI metadata used by custom-skill import/display."""
    try:
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON in {META_FILE_NAME}: {e}"

    if not isinstance(meta, dict):
        return False, f"{META_FILE_NAME} must contain a JSON object"

    meta_name = str(meta.get('name', '')).strip()
    if not meta_name:
        return False, f"{META_FILE_NAME} missing required field: name"
    if skill_name and meta_name != skill_name:
        return False, f"{META_FILE_NAME} name '{meta_name}' must match SKILL.md name '{skill_name}'"
    if dir_name and meta_name != dir_name:
        return False, f"{META_FILE_NAME} name '{meta_name}' must match directory name '{dir_name}'"

    display_name = meta.get('display_name')
    if display_name is not None and not isinstance(display_name, str):
        return False, f"{META_FILE_NAME} display_name must be a string"

    meta_description = meta.get('description')
    if meta_description is not None and not isinstance(meta_description, str):
        return False, f"{META_FILE_NAME} description must be a string"

    categories = meta.get('categories')
    if categories is not None and not (isinstance(categories, list) and all(isinstance(item, str) for item in categories)):
        return False, f"{META_FILE_NAME} categories must be an array of strings"

    is_builtin = meta.get('is_builtin') is True
    source_type = meta.get('source_type')
    if source_type is not None and source_type not in META_SOURCE_TYPES:
        return False, f"{META_FILE_NAME} source_type must be one of: {', '.join(sorted(META_SOURCE_TYPES))}"

    if not is_builtin and source_type in (None, 'custom'):
        return False, f"{META_FILE_NAME} source_type should be 'upload' for Sudowork local custom skills"

    if not is_builtin and meta.get('is_builtin') is True:
        return False, f"{META_FILE_NAME} is_builtin must be false for custom skills"

    if not is_builtin and meta.get('enabled') is False:
        return False, f"{META_FILE_NAME} enabled should be true for newly created custom skills"

    icon = meta.get('icon')
    if isinstance(icon, str) and icon and not re.match(r'^(https?://|/|aion-asset://|data:|file://)', icon):
        icon_path = meta_path.parent / icon
        if not icon_path.exists():
            return False, f"{META_FILE_NAME} icon points to missing file: {icon}"

    return True, "Sudowork metadata is valid"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)

    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)
