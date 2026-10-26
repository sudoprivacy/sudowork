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

  it('every code update reports the four required platform check names', () => {
    const jobs = readWorkflow('pr-checks.yml').jobs;
    const build = jobs['build-test'];
    expect(build.if).toBeUndefined();
    const windows = build.strategy?.matrix.include.map(({ platform }) => build.name.replace('${{ matrix.platform }}', platform)) ?? [];
    const macos = ['build-test-macos-arm64', 'build-test-macos-x64'].map((id) => jobs[id]);
    for (const job of macos) {
      // A skipped matrix job reports its unexpanded name, so a macOS job that can be
      // skipped must be a plain job with a literal name, or its required check never reports.
      expect(job.strategy).toBeUndefined();
      expect(job.name).not.toContain('${{');
      // Only pull requests into `dev` skip it: `dev` lands through the merge queue, which
      // runs it on the exact commit that becomes `dev`. `main` has no queue behind it.
      expect(job.if).toBe("${{ github.event_name != 'pull_request' || github.base_ref != 'dev' }}");
      expect(job.steps).toEqual(build.steps);
    }
    expect([...windows, ...macos.map((job) => job.name)]).toEqual(
      expect.arrayContaining(['Build Test (macos-arm64)', 'Build Test (macos-x64)', 'Build Test (windows-arm64)', 'Build Test (windows-x64)']),
    );
  });

  it.each([
    { name: 'pr-checks.yml', requiredJobs: ['build-test', 'release-script-test'] },
    { name: 'pr-integration-smoke.yml', requiredJobs: ['browser-port-isolation'] },
  ])('$name reports its required checks for each merge queue entry', ({ name, requiredJobs }) => {
    const workflow = readWorkflow(name);
    expect(Object.keys(workflow.on)).toContain('merge_group');
    // merge_group runs have no pull_request payload; without the ref fallback every queue entry shares one group and cancels the others.
    expect(workflow.concurrency.group).toContain('|| github.ref }}');
    for (const job of requiredJobs) expect(workflow.jobs[job].if).toBeUndefined();
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
