---
name: cron
description: Scheduled task management - create, query, delete scheduled tasks to automatically execute operations at specified times.
---

# Scheduled Task Skill

You can manage scheduled tasks to automatically execute operations at specified times.

## IMPORTANT RULES

1. **Tasks are user-global** - `[CRON_LIST]` returns ALL of the user's scheduled tasks, across every conversation. A new task delivers into the conversation that created it.
2. **NO duplicate tasks** - Before creating a task, output `[CRON_LIST]` and WAIT for the result. If a similar task already exists (even one created in another conversation), do NOT create another without asking the user.
3. **NEVER combine commands** - Do NOT output `[CRON_LIST]` and `[CRON_CREATE]` in the same message. Query first, wait for result, then decide.
4. **ASK before delete** - If a similar task exists, you MUST ask the user whether to replace it or keep it. NEVER delete without user's explicit confirmation.
5. **ALWAYS include closing tags** - `[CRON_CREATE]` MUST end with `[/CRON_CREATE]`
6. **Output commands directly** - Do NOT wrap commands in markdown code blocks

## Workflow for Creating a Task

**CRITICAL: This is a multi-turn workflow. Do NOT skip steps or combine them.**

**Step 1: Query existing tasks (STOP and wait)**
Output ONLY `[CRON_LIST]` and nothing else. The system will return the user's tasks across all conversations.
DO NOT proceed to Step 2 until you see the system response.

**Step 2: Review the result and ask user (STOP and wait for user response)**
After receiving the `[CRON_LIST]` result:

- If "No scheduled tasks" → proceed to Step 3
- If a similar task already exists (same purpose, possibly created in another conversation) → **You MUST ask the user** what they want to do:
  - Option A: Delete the existing task and create a new one
  - Option B: Keep the existing task and cancel creating a new one
  - Option C: Keep the existing task AND create this one too (only if the user explicitly wants both)
  - **NEVER delete the existing task without explicit user confirmation**
  - Wait for the user's response before proceeding
- If existing tasks are unrelated to the one being created → proceed to Step 3

**Step 3: Execute user's decision**

- If user chose to replace: First delete the old task with `[CRON_DELETE: <job-id>]`, wait for confirmation, then create new task
- If user chose to keep: Do NOT create a new task, inform user the existing task is retained

**Step 4: Create the new task (only if no similar task exists or user confirmed)**
Only after confirming no similar task exists (or after the user's explicit decision), output the `[CRON_CREATE]` block.

## Create Scheduled Task

When user requests a timed reminder or periodic task, output this format DIRECTLY (not in code blocks):

[CRON_CREATE]
name: Task name
schedule: Cron expression
schedule_description: Human-readable description of when the task runs
message: Message content to send when triggered
[/CRON_CREATE]

**Required fields:**

- `name`: Short descriptive name for the task
- `schedule`: Valid cron expression
- `schedule_description`: Human-readable explanation of the schedule (e.g., "Every Monday at 9:00 AM")
- `message`: The message to send when the task triggers

**Example output** (output EXACTLY like this, without code blocks):

[CRON_CREATE]
name: Weekly Meeting Reminder
schedule: 0 9 \* \* MON
schedule_description: Every Monday at 9:00 AM
message: Time for the weekly meeting!
[/CRON_CREATE]

## Query Scheduled Tasks

Output `[CRON_LIST]` directly (not in code blocks) to query scheduled tasks.
**The system will return the result in a follow-up message.** Wait for the response before taking further action.

## Delete Scheduled Task

Output `[CRON_DELETE: <actual-job-id>]` directly to delete a specific task.
Replace `<actual-job-id>` with the real job ID (e.g., `cron_abc123`).

## Cron Expression Reference

| Expression        | Meaning                          |
| ----------------- | -------------------------------- |
| `0 9 * * *`       | Every day at 9:00 AM             |
| `0 9 * * MON`     | Every Monday at 9:00 AM          |
| `0 9 * * MON-FRI` | Weekdays at 9:00 AM              |
| `*/30 * * * *`    | Every 30 minutes                 |
| `0 */2 * * *`     | Every 2 hours                    |
| `0 0 1 * *`       | 1st of every month at midnight   |
| `0 18 * * FRI`    | Every Friday at 6:00 PM          |
| `0 9,18 * * *`    | Every day at 9:00 AM and 6:00 PM |

### Cron Expression Format

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, SUN-SAT)
│ │ │ │ │
* * * * *
```

### Special Characters

- `*` - Any value
- `,` - List separator (e.g., `1,3,5`)
- `-` - Range (e.g., `MON-FRI`)
- `/` - Step (e.g., `*/15` for every 15)

## Notes

- `[CRON_LIST]` shows ALL of the user's scheduled tasks; entries created by the current conversation are marked `[created in this conversation]`
- When a task triggers, its message is delivered to the conversation that created it
- Scheduled tasks are subject to organization policy. If the system responds that scheduled tasks are disabled by the organization, relay that to the user and do NOT retry the command — only an administrator can enable the feature.
- **CRITICAL**: `[CRON_LIST]` is an async query. You MUST wait for the system response before proceeding with `[CRON_CREATE]` or `[CRON_DELETE]`. Never output multiple commands in one message.
