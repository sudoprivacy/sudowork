// node:sqlite rather than the project's better-sqlite3: the latter is compiled against
// Electron's ABI and cannot load under plain-node vitest (same constraint noted in
// tests/integration/workspaceQueries.test.ts). The migration is plain SQL, so either
// driver exercises it identically.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS } from '@process/database/migrations';
import { pluginScope, scopedChatId, pluginTypeFromId, defaultPluginId, generatePluginId } from '@/channels/types';

/**
 * A channel type may have several connections (e.g. two WeCom bots). These cover the two
 * properties that keeps safe: existing single-connection installs must be untouched by the
 * upgrade, and two bots must never share an authorization or a conversation.
 */

/** Rebuild the pre-v32 schema so the migration runs against a realistic old database. */
function seedLegacyDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE assistant_users (
      id TEXT PRIMARY KEY, platform_user_id TEXT NOT NULL, platform_type TEXT NOT NULL,
      display_name TEXT, authorized_at INTEGER NOT NULL, last_active INTEGER, session_id TEXT,
      UNIQUE(platform_user_id, platform_type)
    );
    CREATE TABLE assistant_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_type TEXT NOT NULL,
      conversation_id TEXT, workspace TEXT, chat_id TEXT,
      created_at INTEGER NOT NULL, last_activity INTEGER NOT NULL
    );
    CREATE TABLE assistant_pairing_codes (
      code TEXT PRIMARY KEY, platform_user_id TEXT NOT NULL, platform_type TEXT NOT NULL,
      display_name TEXT, requested_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO assistant_users VALUES (?,?,?,?,?,?,?)`).run('u1', 'zhang', 'wecom', 'Zhang', 100, null, null);
  db.prepare(`INSERT INTO assistant_pairing_codes VALUES (?,?,?,?,?,?,?)`).run('123456', 'li', 'lark', 'Li', 1, 999, 'pending');
  return db;
}

const v32 = ALL_MIGRATIONS.find((m) => m.version === 32);

describe('connection scoping', () => {
  it('registers migration v32', () => {
    expect(v32).toBeDefined();
  });

  describe('migration v32', () => {
    it('preserves existing rows and backfills the scope from the platform', () => {
      const db = seedLegacyDb();
      v32!.up(db);

      const user = db.prepare(`SELECT * FROM assistant_users WHERE id = 'u1'`).get() as Record<string, unknown>;
      expect(user.plugin_scope).toBe('wecom');
      expect(user.display_name).toBe('Zhang');
      expect(user.authorized_at).toBe(100);

      const pairing = db.prepare(`SELECT * FROM assistant_pairing_codes WHERE code = '123456'`).get() as Record<string, unknown>;
      expect(pairing.plugin_scope).toBe('lark');
    });

    it('keeps a pre-upgrade authorization resolvable under the bare platform', () => {
      const db = seedLegacyDb();
      v32!.up(db);
      const found = db.prepare(`SELECT * FROM assistant_users WHERE platform_user_id = ? AND plugin_scope = ?`).get('zhang', 'wecom');
      expect(found).toBeTruthy();
    });

    it('lets two bots of one type authorize the same person independently', () => {
      const db = seedLegacyDb();
      v32!.up(db);
      db.prepare(`INSERT INTO assistant_users (id, platform_user_id, platform_type, plugin_scope, authorized_at) VALUES (?,?,?,?,?)`).run('u2', 'zhang', 'wecom', 'wecom_a1b2c3d4', 200);

      const rows = db.prepare(`SELECT * FROM assistant_users WHERE platform_user_id = 'zhang' ORDER BY authorized_at`).all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.plugin_scope)).toEqual(['wecom', 'wecom_a1b2c3d4']);
    });

    it('still rejects a duplicate authorization on the same connection', () => {
      const db = seedLegacyDb();
      v32!.up(db);
      const insert = () => db.prepare(`INSERT INTO assistant_users (id, platform_user_id, platform_type, plugin_scope, authorized_at) VALUES (?,?,?,?,?)`).run('dup', 'zhang', 'wecom', 'wecom', 300);
      expect(insert).toThrow();
    });

    it('rolls back to one authorization per type', () => {
      const db = seedLegacyDb();
      v32!.up(db);
      db.prepare(`INSERT INTO assistant_users (id, platform_user_id, platform_type, plugin_scope, authorized_at) VALUES (?,?,?,?,?)`).run('u2', 'zhang', 'wecom', 'wecom_a1b2c3d4', 200);
      v32!.down(db);

      const cols = (db.prepare(`PRAGMA table_info(assistant_users)`).all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols).not.toContain('plugin_scope');
      const rows = db.prepare(`SELECT * FROM assistant_users WHERE platform_user_id = 'zhang'`).all();
      expect(rows).toHaveLength(1);
    });
  });

  describe('scope helpers', () => {
    it("treats a type's first connection as the bare platform, so legacy rows still resolve", () => {
      expect(pluginScope('wecom_default', 'wecom')).toBe('wecom');
      expect(pluginScope('wecom', 'wecom')).toBe('wecom');
      expect(pluginScope(undefined, 'wecom')).toBe('wecom');
      expect(scopedChatId('wecom_default', 'wecom', 'user:zhang')).toBe('user:zhang');
    });

    it('gives every additional connection its own scope', () => {
      expect(pluginScope('wecom_a1b2c3d4', 'wecom')).toBe('wecom_a1b2c3d4');
      expect(scopedChatId('wecom_a1b2c3d4', 'wecom', 'user:zhang')).toBe('wecom_a1b2c3d4#user:zhang');
    });

    it('never lets two bots share a chat key for the same person', () => {
      const botA = scopedChatId('wecom_default', 'wecom', 'user:zhang');
      const botB = scopedChatId('wecom_a1b2c3d4', 'wecom', 'user:zhang');
      expect(botA).not.toBe(botB);
    });

    it('round-trips the type out of a plugin id', () => {
      expect(pluginTypeFromId('wecom_a1b2c3d4')).toBe('wecom');
      expect(pluginTypeFromId('wecom_default')).toBe('wecom');
      expect(pluginTypeFromId('telegram')).toBe('telegram');
      expect(pluginTypeFromId('ext-feishu')).toBe('ext-feishu');
      expect(pluginTypeFromId(defaultPluginId('lark'))).toBe('lark');
      expect(pluginTypeFromId(generatePluginId('dingtalk'))).toBe('dingtalk');
    });

    it('generates distinct ids so a deleted connection is never reused', () => {
      expect(generatePluginId('wecom')).not.toBe(generatePluginId('wecom'));
    });
  });
});
