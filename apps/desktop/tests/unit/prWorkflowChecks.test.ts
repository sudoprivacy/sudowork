import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Workflow = {
  on: { pull_request: { types: string[]; branches: string[] } };
  concurrency: { group: string };
  jobs: Record<string, { name: string; if?: string; strategy?: { matrix: { include: { platform: string }[] } }; steps?: { run?: string }[] }>;
};

function readWorkflow(name: string): Workflow {
  return parse(readFileSync(resolve(__dirname, '../../../../.github/workflows', name), 'utf8')) as Workflow;
}

describe('required PR check reporting', () => {
  it.each(['pr-checks.yml', 'pr-webui-checks.yml'])('%s cannot replace current checks with a metadata-only skipped run', (name) => {
    const workflow = readWorkflow(name);
    expect(workflow.on.pull_request.types).not.toContain('edited');
    expect(workflow.on.pull_request.types).toEqual(expect.arrayContaining(['opened', 'synchronize', 'reopened']));
    expect(workflow.on.pull_request.branches).toEqual(expect.arrayContaining(['dev', 'main']));
  });

  it('every code update expands the four required platform check names', () => {
    const build = readWorkflow('pr-checks.yml').jobs['build-test'];
    expect(build.if).toBeUndefined();
    const names = build.strategy?.matrix.include.map(({ platform }) => build.name.replace('${{ matrix.platform }}', platform));
    expect(names).toEqual(expect.arrayContaining(['Build Test (macos-arm64)', 'Build Test (macos-x64)', 'Build Test (windows-arm64)', 'Build Test (windows-x64)']));
  });

  it('retargeting a PR still checks main in a workflow independent of build checks', () => {
    const guard = readWorkflow('pr-base-branch.yml');
    expect(guard.on.pull_request.types).toContain('edited');
    expect(guard.on.pull_request.branches).toEqual(expect.arrayContaining(['dev', 'main']));
    expect(guard.concurrency.group).not.toBe(readWorkflow('pr-checks.yml').concurrency.group);
    const check = guard.jobs['check-base-branch'];
    expect(check.if).toBe("github.event.pull_request.base.ref == 'main'");
    expect(check.steps?.some(({ run }) => run?.includes('exit 1'))).toBe(true);
    expect(Object.keys(guard.jobs)).toEqual(['check-base-branch']);
  });
});
