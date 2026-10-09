import { describe, expect, test } from 'vitest'
import { hashTargetForLegacyPath } from '../../src/client/shared-renderer/legacyPaths'

/**
 * The failure this guards against is not a crash. An unmatched legacy path used
 * to resolve to '/#/guid', so a real settings URL opened the home screen and
 * looked like the page simply had nothing on it.
 *
 * The settings branch had listed four route names while the renderer registered
 * eighteen, so most of them were wrong. Enumerating routes in two places is what
 * caused that, which is why these assert the prefix behaviour rather than a list.
 */

describe('hashTargetForLegacyPath', () => {
  test('leaves the normal entry alone', () => {
    expect(hashTargetForLegacyPath('/')).toBeNull()
    expect(hashTargetForLegacyPath('')).toBeNull()
    expect(hashTargetForLegacyPath('///')).toBeNull()
  })

  test('carries every settings route through, not a chosen few', () => {
    for (const name of [
      'model',
      'profile',
      'enterprise',
      'mcp',
      'display',
      'channels',
      'system',
      'about',
      'recharge',
      'members',
      'skill',
      'security',
      'runtime',
      'tools',
    ]) {
      expect(hashTargetForLegacyPath(`/settings/${name}`), name).toBe(`/#/settings/${name}`)
    }
  })

  test('keeps nested settings paths whole', () => {
    expect(hashTargetForLegacyPath('/settings/ext/billing')).toBe('/#/settings/ext/billing')
  })

  test('forwards an unregistered settings path rather than swallowing it', () => {
    // The hash router sends this to /guid itself. Forwarding keeps that decision
    // in one place instead of duplicating the route table here.
    expect(hashTargetForLegacyPath('/settings/not-a-real-page')).toBe('/#/settings/not-a-real-page')
  })

  test('maps the remaining legacy console paths', () => {
    expect(hashTargetForLegacyPath('/agents')).toBe('/#/app/agent')
    expect(hashTargetForLegacyPath('/skills')).toBe('/#/app/skills')
    expect(hashTargetForLegacyPath('/cron')).toBe('/#/app/cron')
    expect(hashTargetForLegacyPath('/cron/job-42')).toBe('/#/app/cron/job-42')
    expect(hashTargetForLegacyPath('/conversation/abc-123')).toBe('/#/conversation/abc-123')
    expect(hashTargetForLegacyPath('/login')).toBe('/#/login')
    expect(hashTargetForLegacyPath('/guid')).toBe('/#/guid')
  })

  test('ignores a trailing slash', () => {
    expect(hashTargetForLegacyPath('/settings/recharge/')).toBe('/#/settings/recharge')
    expect(hashTargetForLegacyPath('/agents/')).toBe('/#/app/agent')
  })

  test('sends anything unrecognised to the home screen', () => {
    expect(hashTargetForLegacyPath('/nope')).toBe('/#/guid')
  })
})
