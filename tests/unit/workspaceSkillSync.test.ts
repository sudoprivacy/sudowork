import { describe, expect, it } from 'vitest';

import type { TChatConversation } from '@/common/storage';
import { shouldSyncWorkspaceSkills, isRemoteContainerPath } from '@/common/utils/workspaceSkillSync';

describe('workspace skill sync gating', () => {
  it('disables workspace skill sync for legacy openclaw conversations', () => {
    const conversation = {
      id: 'conv-openclaw',
      name: 'OpenClaw',
      type: 'openclaw-gateway',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/openclaw-workspace',
      },
      model: {
        id: 'default',
        platform: 'openclaw',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
  });

  it('enables workspace skill sync for acp preset conversations with enabled skills', () => {
    const conversation = {
      id: 'conv-acp',
      name: 'ACP',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/acp-workspace',
        backend: 'codex',
        enabledSkills: ['pptx'],
      },
      model: {
        id: 'default',
        platform: 'openai',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(true);
  });

  it('enables workspace skill sync for preset conversations even when skills are resolved later', () => {
    const conversation = {
      id: 'conv-acp-preset-assistant',
      name: 'ACP',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/acp-workspace',
        backend: 'codex',
        presetAssistantId: 'builtin-cowork',
      },
      model: {
        id: 'default',
        platform: 'openai',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(true);
  });

  it('enables workspace skill sync when the current message requests skills', () => {
    const conversation = {
      id: 'conv-acp-requested-skill',
      name: 'ACP',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/acp-workspace',
        backend: 'codex',
      },
      model: {
        id: 'default',
        platform: 'openai',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation, ['pptx'])).toBe(true);
  });

  it('disables workspace skill sync for acp conversations without assistant or message skills', () => {
    const conversation = {
      id: 'conv-acp',
      name: 'ACP',
      type: 'acp',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: '/tmp/acp-workspace',
        backend: 'codex',
      },
      model: {
        id: 'default',
        platform: 'openai',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
  });

  it('disables workspace skill sync when openclaw conversation has no workspace', () => {
    const conversation = {
      id: 'conv-openclaw-no-workspace',
      name: 'OpenClaw',
      type: 'openclaw-gateway',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {},
      model: {
        id: 'default',
        platform: 'openclaw',
        name: 'default',
        baseUrl: '',
        apiKey: '',
        useModel: 'default',
      },
    } as TChatConversation;

    expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
  });

  // New tests for remote-agent workspace path handling
  describe('remote-agent workspace path handling', () => {
    it('detects Moss container paths starting with /app/', () => {
      expect(isRemoteContainerPath('/app/data/runtime/sessions/abc123/workspace')).toBe(true);
      expect(isRemoteContainerPath('/app/workspace')).toBe(true);
      expect(isRemoteContainerPath('/tmp/local/workspace')).toBe(false);
    });

    it('detects Moss container paths containing /data/runtime/sessions/', () => {
      expect(isRemoteContainerPath('/var/data/runtime/sessions/xyz/workspace')).toBe(true);
      expect(isRemoteContainerPath('/home/user/data/runtime/sessions/test')).toBe(true);
      expect(isRemoteContainerPath('/home/user/workspace')).toBe(false);
    });

    it('returns false for undefined or empty workspace paths', () => {
      expect(isRemoteContainerPath(undefined)).toBe(false);
      expect(isRemoteContainerPath('')).toBe(false);
    });

    // Tests for remote-agent type (primary check)
    describe('remote-agent type conversations', () => {
      it('ALWAYS disables workspace skill sync for remote-agent type conversations', () => {
        const conversation = {
          id: 'conv-remote-agent',
          name: 'Remote Agent',
          type: 'remote-agent',
          createTime: Date.now(),
          modifyTime: Date.now(),
          extra: {
            workspace: '/tmp/local-workspace', // Even with local workspace
            backend: 'remote-agent',
            enabledSkills: ['pptx'],
          },
          model: {
            id: 'default',
            platform: 'openai',
            name: 'default',
            baseUrl: '',
            apiKey: '',
            useModel: 'default',
          },
        } as TChatConversation;

        // Should skip because type is remote-agent, regardless of workspace path
        expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
      });

      it('disables workspace skill sync for remote-agent with local workspace and enabled skills', () => {
        const conversation = {
          id: 'conv-remote-agent-skills',
          name: 'Remote Agent with Skills',
          type: 'remote-agent',
          createTime: Date.now(),
          modifyTime: Date.now(),
          extra: {
            workspace: '/home/user/project', // Local path
            backend: 'remote-agent',
            enabledSkills: ['pptx', 'xlsx', 'pdf'],
          },
          model: {
            id: 'default',
            platform: 'openai',
            name: 'default',
            baseUrl: '',
            apiKey: '',
            useModel: 'default',
          },
        } as TChatConversation;

        expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
      });

      it('disables workspace skill sync for remote-agent when requested skills are provided', () => {
        const conversation = {
          id: 'conv-remote-agent-requested',
          name: 'Remote Agent Requested Skills',
          type: 'remote-agent',
          createTime: Date.now(),
          modifyTime: Date.now(),
          extra: {
            workspace: '/home/user/project',
            backend: 'remote-agent',
          },
          model: {
            id: 'default',
            platform: 'openai',
            name: 'default',
            baseUrl: '',
            apiKey: '',
            useModel: 'default',
          },
        } as TChatConversation;

        // Should skip even when requested skills are passed
        expect(shouldSyncWorkspaceSkills(conversation, ['pptx', 'xlsx'])).toBe(false);
      });

      it('disables workspace skill sync for remote-agent with preset assistant', () => {
        const conversation = {
          id: 'conv-remote-agent-preset',
          name: 'Remote Agent Preset',
          type: 'remote-agent',
          createTime: Date.now(),
          modifyTime: Date.now(),
          extra: {
            workspace: '/home/user/project',
            backend: 'remote-agent',
            presetAssistantId: 'builtin-cowork',
          },
          model: {
            id: 'default',
            platform: 'openai',
            name: 'default',
            baseUrl: '',
            apiKey: '',
            useModel: 'default',
          },
        } as TChatConversation;

        expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
      });
    });

    // Defense-in-depth: remote container path detection
    describe('remote container path detection (defense-in-depth)', () => {
      it('disables workspace skill sync for acp conversations with Moss container paths', () => {
        const conversation = {
          id: 'conv-remote-path',
          name: 'Remote Path',
          type: 'acp',
          createTime: Date.now(),
          modifyTime: Date.now(),
          extra: {
            workspace: '/app/data/runtime/sessions/abc123/workspace',
            backend: 'scode',
            enabledSkills: ['pptx'],
          },
          model: {
            id: 'default',
            platform: 'openai',
            name: 'default',
            baseUrl: '',
            apiKey: '',
            useModel: 'default',
          },
        } as TChatConversation;

        // Should skip even with enabled skills because workspace is remote
        expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
      });

      it('disables workspace skill sync when mossWorkDir field is present', () => {
        const conversation = {
          id: 'conv-moss-workdir',
          name: 'Moss Conversation',
          type: 'acp',
          createTime: Date.now(),
          modifyTime: Date.now(),
          extra: {
            workspace: '/tmp/local-workspace', // Local path
            mossWorkDir: '/app/data/runtime/sessions/abc123/workspace', // Remote container path
            backend: 'scode',
            enabledSkills: ['pptx'],
          },
          model: {
            id: 'default',
            platform: 'openai',
            name: 'default',
            baseUrl: '',
            apiKey: '',
            useModel: 'default',
          },
        } as TChatConversation;

        // Should skip because mossWorkDir indicates remote-agent conversation
        expect(shouldSyncWorkspaceSkills(conversation)).toBe(false);
      });
    });

    // Positive case: local acp conversations should still work
    describe('local acp conversations', () => {
      it('enables workspace skill sync for local paths without mossWorkDir', () => {
        const conversation = {
          id: 'conv-local',
          name: 'Local Conversation',
          type: 'acp',
          createTime: Date.now(),
          modifyTime: Date.now(),
          extra: {
            workspace: '/tmp/local-workspace',
            backend: 'scode',
            enabledSkills: ['pptx'],
          },
          model: {
            id: 'default',
            platform: 'openai',
            name: 'default',
            baseUrl: '',
            apiKey: '',
            useModel: 'default',
          },
        } as TChatConversation;

        expect(shouldSyncWorkspaceSkills(conversation)).toBe(true);
      });
    });
  });
});
