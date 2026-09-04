import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { DATA_DIR, SKILLS_DIR, ensureMock, isInstalledState } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const p = require('path');
  const base = p.join(require('os').tmpdir(), 'sudowork-ffmpeg-gate-unit');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { DATA_DIR: p.join(base, 'data'), SKILLS_DIR: p.join(base, 'skills'), ensureMock: vi.fn(async () => true), isInstalledState: { value: false } };
});

vi.mock('@process/utils', () => ({ getDataPath: () => DATA_DIR }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/ffmpeg/FfmpegRuntimeService', () => ({
  ensureFfmpegInstalled: ensureMock,
  isFfmpegInstalled: () => isInstalledState.value,
}));

import { skillDirNeedsFfmpeg, maybeProvisionFfmpegForSkill, reconcileFfmpegAtStartup } from '@process/services/ffmpeg/ffmpegSkillGate';

const markerPath = path.join(DATA_DIR, '.ffmpeg-required');

function makeSkill(name: string, files: Record<string, string>): string {
  const dir = path.join(SKILLS_DIR, name);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('ffmpegSkillGate', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(SKILLS_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ensureMock.mockClear();
    isInstalledState.value = false;
  });
  afterEach(() => {
    isInstalledState.value = false;
  });

  describe('skillDirNeedsFfmpeg', () => {
    it('detects ffmpeg in SKILL.md', () => {
      const dir = makeSkill('video', { 'SKILL.md': '# Video\nRun `ffmpeg -vf subtitles=...` to burn subs.' });
      expect(skillDirNeedsFfmpeg(dir)).toBe(true);
    });

    it('detects ffprobe in a nested script', () => {
      const dir = makeSkill('probe', { 'SKILL.md': '# Probe', 'scripts/run.sh': 'ffprobe -i input.mp4' });
      expect(skillDirNeedsFfmpeg(dir)).toBe(true);
    });

    it('returns false for a skill that never mentions ffmpeg', () => {
      const dir = makeSkill('notes', { 'SKILL.md': '# Notes\nJust some documentation about images.' });
      expect(skillDirNeedsFfmpeg(dir)).toBe(false);
    });

    it('ignores non-text files', () => {
      const dir = makeSkill('bin', { 'blob.png': 'ffmpeg-inside-a-binaryish-name-but-not-text-ext' });
      // .png is not a scanned text extension → no match
      expect(skillDirNeedsFfmpeg(dir)).toBe(false);
    });
  });

  describe('maybeProvisionFfmpegForSkill', () => {
    it('writes the marker and provisions when a skill needs ffmpeg and it is absent', () => {
      const dir = makeSkill('video', { 'SKILL.md': 'use ffmpeg' });
      maybeProvisionFfmpegForSkill(dir);
      expect(fs.existsSync(markerPath)).toBe(true);
      expect(ensureMock).toHaveBeenCalledOnce();
    });

    it('does nothing when the skill does not need ffmpeg', () => {
      const dir = makeSkill('notes', { 'SKILL.md': 'no media here' });
      maybeProvisionFfmpegForSkill(dir);
      expect(fs.existsSync(markerPath)).toBe(false);
      expect(ensureMock).not.toHaveBeenCalled();
    });

    it('marks required but skips provisioning when ffmpeg is already installed', () => {
      isInstalledState.value = true;
      const dir = makeSkill('video', { 'SKILL.md': 'use ffmpeg' });
      maybeProvisionFfmpegForSkill(dir);
      expect(fs.existsSync(markerPath)).toBe(true);
      expect(ensureMock).not.toHaveBeenCalled();
    });
  });

  describe('reconcileFfmpegAtStartup', () => {
    it('re-provisions when the marker exists but ffmpeg is missing', () => {
      fs.writeFileSync(markerPath, '');
      reconcileFfmpegAtStartup();
      expect(ensureMock).toHaveBeenCalledOnce();
    });

    it('does nothing without the marker', () => {
      reconcileFfmpegAtStartup();
      expect(ensureMock).not.toHaveBeenCalled();
    });

    it('does nothing when ffmpeg is already installed', () => {
      fs.writeFileSync(markerPath, '');
      isInstalledState.value = true;
      reconcileFfmpegAtStartup();
      expect(ensureMock).not.toHaveBeenCalled();
    });
  });
});
