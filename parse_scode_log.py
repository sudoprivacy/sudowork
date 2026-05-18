#!/usr/bin/env python3
# @final
"""
Scode 日志解析器 - 按会话和请求链路展示日志
"""

import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path


def parse_timestamp(ts_str: str) -> datetime | str:
    """解析时间戳字符串"""
    try:
        return datetime.fromisoformat(ts_str)
    except:
        return ts_str


def format_duration(start: str, end: str) -> str:
    """计算并格式化持续时间"""
    try:
        start_dt = parse_timestamp(start)
        end_dt = parse_timestamp(end)
        delta = end_dt - start_dt
        total_ms = delta.total_seconds() * 1000
        if total_ms < 1000:
            return f"{int(total_ms)}ms"
        elif total_ms < 60000:
            return f"{total_ms/1000:.2f}s"
        else:
            return f"{total_ms/60000:.2f}m"
    except:
        return "N/A"


def parse_log_file(log_path: str) -> dict[str, list[dict]]:
    """解析日志文件，按会话分组"""
    sessions = defaultdict(list)

    with open(log_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                session_id = entry.get("session_id", "unknown")
                sessions[session_id].append(entry)
            except json.JSONDecodeError as e:
                print(f"解析错误: {e}")
                continue

    return sessions


def extract_user_message(content: str) -> str:
    """从消息内容中提取用户实际输入"""
    if "[User Request]" in content:
        match = re.search(r"\[User Request\]\s*(.*?)(?:\n\n|\Z)", content, re.DOTALL)
        if match:
            return match.group(1).strip()
    elif "</system-reminder>" in content:
        parts = content.split("</system-reminder>")
        after_tags = parts[-1].strip()
        if after_tags:
            return after_tags
    return content.strip()


def find_session_file(cwd: str, session_id: str) -> Path | None:
    """根据工作目录和会话ID找到会话文件"""
    sessions_dir = Path(cwd) / ".scode" / "sessions"
    if not sessions_dir.exists():
        return None

    # 遍历所有子目录查找会话文件
    for subdir in sessions_dir.iterdir():
        if subdir.is_dir():
            session_file = subdir / f"{session_id}.jsonl"
            if session_file.exists():
                return session_file

    return None


def load_session_responses(cwd: str, session_id: str) -> list[dict]:
    """从会话文件加载响应内容"""
    session_file = find_session_file(cwd, session_id)
    if not session_file:
        return []

    responses = []
    try:
        with open(session_file) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                data = json.loads(line)
                if data.get("type") == "message":
                    msg = data.get("message", {})
                    role = msg.get("role")
                    blocks = msg.get("blocks", [])

                    # 提取文本内容
                    text_parts = []
                    for block in blocks:
                        if isinstance(block, dict) and block.get("type") == "text":
                            text_parts.append(block.get("text", ""))

                    responses.append({
                        "role": role,
                        "content": "\n".join(text_parts),
                        "usage": msg.get("usage"),
                    })
    except Exception as e:
        print(f"  警告: 无法读取会话文件: {e}")

    return responses


def print_session(session_id: str, events: list[dict]) -> None:
    """打印单个会话的完整信息"""
    print(f"\n{'='*80}")
    print(f"📋 会话: {session_id}")
    print(f"{'='*80}")

    # 会话基本信息
    session_info = {}
    for event in events:
        if event.get("event") == "session_started":
            session_info = event.get("attributes", {})
            break

    cwd = session_info.get("cwd", "")

    if session_info:
        print(f"\n📌 会话信息:")
        print(f"   模型: {session_info.get('model', 'N/A')}")
        print(f"   版本: {session_info.get('version', 'N/A')}")
        print(f"   模式: {session_info.get('mode', 'N/A')}")
        print(f"   工作目录: {cwd}")

    # 加载会话响应
    session_responses = load_session_responses(cwd, session_id)

    # 按时间排序事件
    sorted_events = sorted(events, key=lambda e: e.get("timestamp", ""))

    # 事件图标映射
    event_icons = {
        "session_started": "🚀",
        "session_ended": "🏁",
        "request_started": "📤",
        "request_succeeded": "✅",
        "request_failed": "❌",
        "http_request_started": "🌐",
        "http_request_succeeded": "✅",
        "http_request_failed": "❌",
        "request_debug": "🐛",
        "response_usage": "📊",
        "tool_call": "🔧",
        "tool_result": "📥",
    }

    # 打印事件链路
    print(f"\n🔗 事件链路 ({len(sorted_events)} 个事件):")
    print("-" * 60)

    for event in sorted_events:
        event_type = event.get("event", "")
        timestamp = event.get("timestamp", "")
        attrs = event.get("attributes", {})
        icon = event_icons.get(event_type, "•")

        # 格式化时间
        time_str = timestamp.split("T")[-1] if "T" in timestamp else timestamp

        # 构建属性摘要
        attr_parts = []
        if event_type == "session_started":
            attr_parts.append(f"model={attrs.get('model', 'N/A')}")
        elif event_type in ("request_started", "http_request_started"):
            attr_parts.append(f"{attrs.get('method', 'POST')} {attrs.get('path', '/')}")
        elif event_type in ("request_succeeded", "http_request_succeeded"):
            attr_parts.append(f"status={attrs.get('status', 'N/A')}")
        elif event_type == "response_usage":
            input_t = attrs.get("input_tokens", 0)
            output_t = attrs.get("output_tokens", 0)
            attr_parts.append(f"input={input_t:,}, output={output_t:,}")

        attr_str = f" [{', '.join(attr_parts)}]" if attr_parts else ""
        print(f"   {icon} {time_str} | {event_type}{attr_str}")

    # 构建请求链路（用于显示详细信息）
    chains = build_request_chains(sorted_events)

    if not chains:
        print("\n   (无请求记录)")
        return

    # 将响应内容匹配到请求链路
    response_idx = 0
    for chain in chains:
        # 找到对应的 assistant 响应
        while response_idx < len(session_responses):
            resp = session_responses[response_idx]
            if resp["role"] == "assistant":
                chain["response_content"] = resp["content"]
                response_idx += 1
                break
            response_idx += 1

    # 打印每个请求的详细信息
    print(f"\n📝 请求详情 ({len(chains)} 个请求):")
    print("-" * 60)

    total_input = 0
    total_output = 0

    for i, chain in enumerate(chains, 1):
        print(f"\n   ┌─ 请求 #{i} ─────────────────────────────────────")

        # 时间和状态
        start_str = (
            chain["start_time"].split("T")[-1]
            if "T" in chain["start_time"]
            else chain["start_time"]
        )
        status_icon = "✅" if chain["status"] == 200 else "❌"
        print(f"   │ ⏱️  开始: {start_str}")
        print(f"   │ {status_icon} 状态: {chain['status'] or 'N/A'}, 耗时: {chain['duration'] or 'N/A'}")

        # Token 用量
        if chain["usage"]:
            usage = chain["usage"]
            input_t = usage["input_tokens"]
            output_t = usage["output_tokens"]
            cache_read = usage["cache_read_input_tokens"]
            cache_create = usage["cache_creation_input_tokens"]

            total_input += input_t
            total_output += output_t

            print(f"   │ 📊 Token 用量:")
            print(f"   │    输入: {input_t:,} | 输出: {output_t:,}")
            if cache_read > 0:
                print(f"   │    缓存读取: {cache_read:,}")
            if cache_create > 0:
                print(f"   │    缓存创建: {cache_create:,}")
        else:
            print(f"   │ 📊 Token 用量: (无记录)")

        # 请求详情
        if chain["request_debug"]:
            debug = chain["request_debug"]
            body = debug.get("body", {})

            # 用户消息
            messages = body.get("messages", [])
            if messages:
                print(f"   │ 💬 消息内容:")
                for msg in messages:
                    role = msg.get("role", "")
                    content = msg.get("content", "")

                    if role == "user":
                        user_input = extract_user_message(content or "")
                        if user_input:
                            # 截断显示
                            display = (
                                user_input[:100] + "..."
                                if len(user_input) > 100
                                else user_input
                            )
                            print(f"   │    👤 用户: {display}")
                    elif role == "assistant":
                        # 显示上一次回复
                        if content:
                            display = content[:100] + "..." if len(content) > 100 else content
                            print(f"   │    🤖 回复: {display}")

        # 响应内容（如果有）
        if chain.get("response_content"):
            print(f"   │ 📥 响应:")
            resp = chain["response_content"]
            display = resp[:200] + "..." if len(resp) > 200 else resp
            for line in display.split("\n"):
                print(f"   │    {line}")
        else:
            print(f"   │ 📥 响应: (未记录)")

        print(f"   └────────────────────────────────────────────────")

    # 会话总计
    if total_input > 0 or total_output > 0:
        print(f"\n   📈 会话总计:")
        print(f"      总输入: {total_input:,} tokens")
        print(f"      总输出: {total_output:,} tokens")
        print(f"      总计: {total_input + total_output:,} tokens")


def build_request_chains(events: list[dict]) -> list[dict]:
    """
    将事件组织成请求链路
    每个请求链路包含: request_started -> request_debug -> request_succeeded -> response_usage
    """
    chains = []
    current_chain = None

    for event in events:
        event_type = event.get("event", "")
        timestamp = event.get("timestamp", "")
        attrs = event.get("attributes", {})

        if event_type == "request_started":
            # 开始新的请求链路
            current_chain = {
                "start_time": timestamp,
                "request_debug": None,
                "end_time": None,
                "status": None,
                "usage": None,
                "duration": None,
                "response_content": None,
            }
            chains.append(current_chain)

        elif event_type == "request_debug" and current_chain:
            current_chain["request_debug"] = {
                "timestamp": timestamp,
                "url": attrs.get("url", "N/A"),
                "method": attrs.get("method", "N/A"),
                "body": attrs.get("body", {}),
                "headers": attrs.get("headers", {}),
            }
            # 检查是否有响应内容
            if "response" in attrs:
                current_chain["response_content"] = attrs["response"]

        elif event_type == "request_succeeded" and current_chain:
            current_chain["end_time"] = timestamp
            current_chain["status"] = attrs.get("status", "N/A")
            if current_chain["start_time"] and current_chain["end_time"]:
                current_chain["duration"] = format_duration(
                    current_chain["start_time"], current_chain["end_time"]
                )

        elif event_type == "response_usage" and current_chain:
            current_chain["usage"] = {
                "input_tokens": attrs.get("input_tokens", 0),
                "output_tokens": attrs.get("output_tokens", 0),
                "cache_read_input_tokens": attrs.get("cache_read_input_tokens", 0),
                "cache_creation_input_tokens": attrs.get(
                    "cache_creation_input_tokens", 0
                ),
            }

    return chains


def main():
    log_path = sys.argv[1] if len(sys.argv) > 1 else "scode.log"

    if not Path(log_path).exists():
        print(f"错误: 日志文件不存在: {log_path}")
        sys.exit(1)

    print(f"📂 解析日志文件: {log_path}")

    sessions = parse_log_file(log_path)

    print(f"\n找到 {len(sessions)} 个会话")

    # 按会话 ID 排序
    for session_id in sorted(sessions.keys()):
        print_session(session_id, sessions[session_id])

    # 总体统计
    print(f"\n{'='*80}")
    print(f"📈 总体统计")
    print(f"{'='*80}")
    print(f"   总会话数: {len(sessions)}")
    total_events = sum(len(e) for e in sessions.values())
    print(f"   总事件数: {total_events}")


if __name__ == "__main__":
    main()
