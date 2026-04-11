"""File a bug: create GitHub issue + notify Feishu Engineering.

This is a standalone CLI script. It does NOT use the browser — it runs
shell commands (gh, npx) directly.

Usage:
    python assistant/doctor/scripts/file_bug.py --title "Bug title" --body "Description"
    python assistant/doctor/scripts/file_bug.py --title "Test" --body "Test" --dry-run
"""

import argparse
import json
import os
import subprocess
import sys


def file_bug(title: str, body: str, screenshot: str = None,
             repo: str = "sudoprivacy/sudowork",
             feishu_chat: str = "oc_69746e233ba561ec748a6371e737501b",
             label: str = "bug",
             dry_run: bool = False) -> dict:
    """Create a GitHub issue and notify Feishu Engineering channel.

    Args:
        title: Issue title
        body: Issue body (markdown)
        screenshot: Optional screenshot path to reference in issue body
        repo: GitHub repo (owner/name)
        feishu_chat: Feishu chat ID for notifications
        label: GitHub issue label
        dry_run: If True, print commands without executing

    Returns:
        {"issue_url": str, "notified": bool} or {"error": str}
    """
    # Build issue body
    full_body = body
    if screenshot:
        full_body += f"\n\n**Screenshot**: `{screenshot}`"

    # 1. Create GitHub issue
    gh_cmd = [
        "gh", "issue", "create",
        "--repo", repo,
        "--title", title,
        "--body", full_body,
        "--label", label,
    ]

    if dry_run:
        return {"dry_run": True, "gh_cmd": " ".join(gh_cmd), "feishu_chat": feishu_chat}

    try:
        result = subprocess.run(
            gh_cmd, capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return {"error": f"gh issue create failed: {result.stderr.strip()}"}
        issue_url = result.stdout.strip()
    except FileNotFoundError:
        return {"error": "gh CLI not found. Install: https://cli.github.com/"}
    except subprocess.TimeoutExpired:
        return {"error": "gh issue create timed out"}

    # 2. Notify Feishu Engineering
    notified = False
    feishu_tool = os.path.expanduser("~/cursor-projects/feishu-automation/tools/message.ts")
    if os.path.exists(feishu_tool):
        feishu_msg = f"[Doctor] New bug filed: {title}\n{issue_url}"
        feishu_cmd = f'echo "{feishu_msg}" | npx tsx "{feishu_tool}" send {feishu_chat}'
        try:
            feishu_result = subprocess.run(
                feishu_cmd, shell=True, capture_output=True, text=True,
                timeout=30, cwd=os.path.dirname(feishu_tool)
            )
            notified = feishu_result.returncode == 0
        except Exception:
            pass  # Notification failure is non-fatal

    return {"issue_url": issue_url, "notified": notified}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="File a bug as a GitHub issue")
    parser.add_argument("--title", required=True, help="Issue title")
    parser.add_argument("--body", required=True, help="Issue body (markdown)")
    parser.add_argument("--screenshot", help="Screenshot path to reference")
    parser.add_argument("--repo", default="sudoprivacy/sudowork", help="GitHub repo")
    parser.add_argument("--label", default="bug", help="Issue label")
    parser.add_argument("--dry-run", action="store_true", help="Print commands without executing")

    args = parser.parse_args()
    result = file_bug(
        title=args.title,
        body=args.body,
        screenshot=args.screenshot,
        repo=args.repo,
        label=args.label,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2))
    if "error" in result:
        sys.exit(1)
