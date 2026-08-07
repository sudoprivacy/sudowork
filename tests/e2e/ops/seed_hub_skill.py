"""Seed a stale installed_version onto an already-installed hub skill.

SkillUpdateService runs on startup and bumps any installed hub skill whose
on-disk installed_version trails the hub's latest. To exercise that path a
test needs an installed skill that LOOKS out of date, so this op rewrites the
skill's `_sudowork_meta.json` installed_version to an old value. That field is
the version SSOT — SkillManager.readSkillInfo lets installed_version override
the legacy version files (src/process/services/skill/SkillManager.ts).

It patches an EXISTING install; it does not download/install a skill (that
needs a live hub token + network). If the skill isn't installed it fails
loudly, so the case never silently asserts against a skill that was never
there.
"""

import json
from pathlib import Path

# Personal-mode hub skills live under <dataDir>/skills/_hub/<name>/ with a
# `_sudowork_meta.json` (SKILL_HUB_META_FILE). dataDir is ~/.nexus.
_HUB_META_FILE = "_sudowork_meta.json"


def _hub_skill_dir(name: str) -> Path:
    return Path.home() / ".nexus" / "skills" / "_hub" / name


async def seed_hub_skill(tab, name: str = "", installed_version: str = "") -> dict:
    """Rewrite an installed hub skill's installed_version to a stale value.

    Args:
        tab: unused (kept for op-signature parity).
        name: hub skill name/dir (e.g. "shareone-skill").
        installed_version: the stale version to seed (e.g. "1.2.0").

    Returns:
        {"pass": True, ...} after patching the meta file.
        {"pass": False, "reason": ...} if the skill is not installed.
    """
    _ = tab
    if not name or not installed_version:
        return {"pass": False, "error": "seed_hub_skill requires `name` and `installed_version`"}

    skill_dir = _hub_skill_dir(name)
    meta_path = skill_dir / _HUB_META_FILE
    if not meta_path.exists():
        return {
            "pass": False,
            "reason": (
                f"{name} is not installed at {skill_dir} — seed patches an installed skill's "
                "version; install it (hub token + network) before running this case"
            ),
        }

    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    meta["installed_version"] = installed_version
    # Keep the fields SkillUpdateService keys off: source_type gates
    # isHubInstalled; id (falls back to name) is the hub lookup id.
    meta.setdefault("source_type", "hub")
    meta.setdefault("name", name)

    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return {"pass": True, "name": name, "installed_version": installed_version, "meta_path": str(meta_path)}
