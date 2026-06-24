/**
 * Tests for CronCommandDetector — focused on the code-fence regression where a
 * model wraps its real `[CRON_CREATE]` block in a markdown fence (ignoring the
 * skill's "do not wrap in code blocks" instruction). Previously stripCodeBlocks
 * deleted the whole fence, so detectCronCommands returned [] and no task was
 * ever created even though the output clearly contained the command.
 */
import { describe, expect, it } from 'vitest';
import { detectCronCommands, hasCronCommands, stripCronCommands } from '@/process/task/CronCommandDetector';

describe('detectCronCommands — fenced commands', () => {
  it('detects a CRON_CREATE block wrapped in a code fence (real-world scode output)', () => {
    const content = [
      '现有任务里有一个"喝水"提醒，和你要的不同，所以我直接创建新任务。',
      '',
      '```',
      '[CRON_CREATE]',
      'name: 喝水提醒（5分钟后）',
      'schedule: 35 14 * * *',
      'schedule_description: 约5分钟后（14:35）提醒一次',
      'message: 该喝水啦！记得补充水分，保持健康 💧',
      '[/CRON_CREATE]',
      '```',
    ].join('\n');

    expect(hasCronCommands(content)).toBe(true);
    const commands = detectCronCommands(content);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      kind: 'create',
      name: '喝水提醒（5分钟后）',
      schedule: '35 14 * * *',
      scheduleDescription: '约5分钟后（14:35）提醒一次',
      message: '该喝水啦！记得补充水分，保持健康 💧',
    });
  });

  it('detects a fenced CRON_CREATE with a language tag', () => {
    const content = '```text\n[CRON_CREATE]\nname: T\nschedule: 0 9 * * *\nschedule_description: daily 9am\nmessage: hi\n[/CRON_CREATE]\n```';
    const commands = detectCronCommands(content);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ kind: 'create', name: 'T', schedule: '0 9 * * *' });
  });

  it('detects a fenced CRON_LIST', () => {
    const commands = detectCronCommands('好的，先查询：\n```\n[CRON_LIST]\n```');
    expect(commands).toEqual([{ kind: 'list' }]);
  });

  it('detects a fenced CRON_DELETE with a real id', () => {
    const commands = detectCronCommands('```\n[CRON_DELETE: cron_abc123]\n```');
    expect(commands).toEqual([{ kind: 'delete', jobId: 'cron_abc123' }]);
  });

  it('still detects a bare (non-fenced) CRON_CREATE — regression guard', () => {
    const content = '[CRON_CREATE]\nname: T\nschedule: 0 9 * * MON\nschedule_description: mondays\nmessage: hello\n[/CRON_CREATE]';
    const commands = detectCronCommands(content);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ kind: 'create', schedule: '0 9 * * MON' });
  });

  it('ignores fenced blocks that are prose and contain no cron markers', () => {
    const content = 'Here is some code:\n```js\nconst x = 1;\n```\nNothing scheduled.';
    expect(detectCronCommands(content)).toEqual([]);
  });
});

describe('stripCronCommands — fenced commands leave no empty code block', () => {
  it('removes a fenced CRON_CREATE without leaving a stray ``` ``` block', () => {
    const content = '好的，已创建：\n```\n[CRON_CREATE]\nname: T\nschedule: 0 9 * * *\nschedule_description: daily\nmessage: hi\n[/CRON_CREATE]\n```';
    const stripped = stripCronCommands(content);
    expect(stripped).not.toContain('```');
    expect(stripped).not.toContain('[CRON_CREATE]');
    expect(stripped).toContain('好的，已创建：');
  });

  it('removes a fenced CRON_LIST cleanly', () => {
    const stripped = stripCronCommands('查询中\n```\n[CRON_LIST]\n```');
    expect(stripped).not.toContain('```');
    expect(stripped).not.toContain('[CRON_LIST]');
  });
});
