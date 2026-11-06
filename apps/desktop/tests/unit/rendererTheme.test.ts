import { createGenerator } from 'unocss';
import { describe, expect, it } from 'vitest';
import desktop from '../../uno.config';
import webui from '../../../webui/uno.config';

describe('renderer theme utilities', () => {
  it('generates identical semantic styles in desktop and WebUI', async () => {
    const classes = 'bg-popup bg-elevated bg-subtle text-foreground text-secondary text-3 border-default bg-danger-soft border-danger-line category-chip category-chip-active';
    const [desktopGenerator, webGenerator] = await Promise.all([createGenerator(desktop), createGenerator(webui)]);
    const [local, remote] = await Promise.all([desktopGenerator.generate(classes), webGenerator.generate(classes)]);
    expect(local.css).toBe(remote.css);
    expect(local.css).toContain('color:var(--foreground)');
    expect(local.css).toContain('background-color:var(--color-bg-popup)');
    expect(local.css).toContain('color:var(--color-text-3)');
    expect([...local.matched].sort()).toEqual(classes.split(' ').sort());
  });
});
