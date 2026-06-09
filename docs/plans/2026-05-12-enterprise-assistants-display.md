# Enterprise Mode Assistants Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Moss Server assistants from top AgentPillBar to bottom AssistantSelectionArea in enterprise mode, matching consumer mode behavior.

**Architecture:** Map Moss assistants to `customAgents` instead of `availableAgents`, reusing existing `AssistantSelectionArea` component for display. Keep "Remote Agent" as default in top `AgentPillBar`.

**Tech Stack:** React, TypeScript, SWR, Arco Design

---

## Task 1: Add Moss Assistant Mapping Function

**Files:**
- Modify: `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`

**Step 1: Add MossAssistant type and mapping function**

Add after the existing imports (around line 20):

```typescript
/**
 * Moss Server assistant from cloud API
 */
type MossAssistant = {
  key: string;
  name: string;
  avatar?: string;
  emoji?: string;
  description?: string;
};

/**
 * Map Moss Server assistant to AcpBackendConfig for display in AssistantSelectionArea
 */
function mapMossAssistantToConfig(assistant: MossAssistant): AcpBackendConfig {
  return {
    id: `moss:${assistant.key}`,
    name: assistant.name,
    avatar: assistant.emoji || assistant.avatar,
    description: assistant.description,
    isPreset: true,
    enabled: true,
    presetAgentType: 'remote-agent',
  };
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/yobach/Downloads/sudowork && npx tsc --noEmit --skipLibCheck src/renderer/pages/guid/hooks/useGuidAgentSelection.ts 2>&1 | head -20`

Expected: No errors related to the new code

**Step 3: Commit**

```bash
git add src/renderer/pages/guid/hooks/useGuidAgentSelection.ts
git commit -m "feat(guid): add Moss assistant mapping function

Add type definition and mapping function to convert Moss Server
assistants to AcpBackendConfig format for AssistantSelectionArea.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Modify SWR Data Processing for Enterprise Mode

**Files:**
- Modify: `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts:256-295`

**Step 1: Update the useEffect that processes availableAgentsData**

Replace the existing useEffect (lines 256-295) with:

```typescript
  useEffect(() => {
    if (availableAgentsData && Array.isArray(availableAgentsData)) {
      if (isEnterprise) {
        // Enterprise mode: Moss assistants go to customAgents, only Remote Agent in availableAgents
        const enterpriseAgents = availableAgentsData as unknown as MossAssistant[];

        // Map Moss assistants to customAgents for bottom display
        const mossCustomAgents: AcpBackendConfig[] = enterpriseAgents.map(mapMossAssistantToConfig);
        setCustomAgents(mossCustomAgents);

        // availableAgents only contains Remote Agent for top AgentPillBar
        const mapped: AvailableAgent[] = [
          {
            backend: 'remote-agent' as AcpBackend,
            name: 'Remote Agent',
            customAgentId: undefined,
          },
        ];
        setAvailableAgents(mapped);
        availableAgentsRef.current = mapped;
      } else {
        // Consumer mode: unchanged
        setAvailableAgents(availableAgentsData as AvailableAgent[]);
        availableAgentsRef.current = availableAgentsData as AvailableAgent[];
      }
    } else if (isEnterprise) {
      // Enterprise mode: even if API fails, provide a default remote-agent
      // 企业模式：即使 API 失败，也提供默认的 remote-agent
      const defaultAgent: AvailableAgent = {
        backend: 'remote-agent' as AcpBackend,
        name: 'Remote Agent',
        customAgentId: undefined,
      };
      setAvailableAgents([defaultAgent]);
      availableAgentsRef.current = [defaultAgent];
      setCustomAgents([]); // Clear customAgents on API failure
    }
  }, [availableAgentsData, isEnterprise]);
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/yobach/Downloads/sudowork && npx tsc --noEmit --skipLibCheck 2>&1 | head -30`

Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/renderer/pages/guid/hooks/useGuidAgentSelection.ts
git commit -m "feat(guid): map Moss assistants to customAgents in enterprise mode

Change enterprise mode data flow:
- availableAgents: only Remote Agent (for top AgentPillBar)
- customAgents: Moss Server assistants (for bottom AssistantSelectionArea)

This matches consumer mode behavior where assistants appear at the bottom.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Update AssistantSelectionArea for Moss Assistants

**Files:**
- Modify: `src/renderer/pages/guid/components/AssistantSelectionArea.tsx`

**Step 1: Update the component to handle Moss assistant IDs**

The component already handles `custom:` prefix. We need to ensure Moss assistants with `moss:` ID prefix are handled correctly.

Update line 62 to handle Moss assistant IDs:

```typescript
              <div key={assistant.id} className='h-28px group flex items-center gap-8px px-16px rd-100px cursor-pointer transition-all b-1 b-solid bg-fill-0 hover:bg-fill-1 select-none' style={{ borderWidth: '1px', borderColor: 'var(--bg-3)' }} onClick={() => onSelectAssistant(`custom:${assistant.id}`)}>
```

No changes needed - the existing code already uses `assistant.id` which will be `moss:{key}` format.

**Step 2: Verify the component renders correctly**

Run: `cd /Users/yobach/Downloads/sudowork && npx tsc --noEmit --skipLibCheck 2>&1 | head -20`

Expected: No TypeScript errors

**Step 3: Commit (if changes were made)**

```bash
git add src/renderer/pages/guid/components/AssistantSelectionArea.tsx
git commit -m "refactor(guid): ensure AssistantSelectionArea handles Moss IDs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Update Selection Validation Logic

**Files:**
- Modify: `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts:297-309`

**Step 1: Update the enterprise mode selection validation**

The existing validation needs to check both `availableAgents` and `customAgents` for enterprise mode.

Replace lines 297-309 with:

```typescript
  // Enterprise mode: keep current selection if valid
  useEffect(() => {
    if (isEnterprise && availableAgents && availableAgents.length > 0) {
      const currentKey = selectedAgentKeyRef.current;
      // 'remote-agent' is always valid
      if (currentKey === 'remote-agent') return;

      // Check if current selection is a valid Moss assistant
      const isValidMossAssistant = customAgents.some(
        (a) => `custom:${a.id}` === currentKey
      );

      if (!isValidMossAssistant) {
        _setSelectedAgentKey('remote-agent');
        selectedAgentKeyRef.current = 'remote-agent';
      }
    }
  }, [isEnterprise, availableAgents, customAgents]);
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/yobach/Downloads/sudowork && npx tsc --noEmit --skipLibCheck 2>&1 | head -20`

Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/renderer/pages/guid/hooks/useGuidAgentSelection.ts
git commit -m "fix(guid): validate enterprise mode selection against customAgents

Update selection validation to check both availableAgents and customAgents
for enterprise mode, ensuring Moss assistant selections are preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Update findAgentByKey for Moss Assistants

**Files:**
- Modify: `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts:215-234`

**Step 1: Update findAgentByKey to handle Moss assistants**

Replace lines 215-234 with:

```typescript
  /**
   * Find agent by key.
   * Supports both "custom:uuid" format and plain backend type.
   * For enterprise mode, also checks customAgents for Moss assistants.
   */
  const findAgentByKey = (key: string): AvailableAgent | undefined => {
    if (key.startsWith('custom:')) {
      const customAgentId = key.slice(7);

      // First check availableAgents (for non-enterprise custom agents)
      const foundInAvailable = availableAgents?.find((a) => a.customAgentId === customAgentId);
      if (foundInAvailable) return foundInAvailable;

      // For enterprise mode, check customAgents (Moss assistants)
      if (isEnterprise) {
        const mossAssistant = customAgents.find((a) => a.id === customAgentId);
        if (mossAssistant) {
          return {
            backend: 'remote-agent' as AcpBackend,
            name: mossAssistant.name,
            customAgentId: mossAssistant.id,
            isPreset: true,
            avatar: mossAssistant.avatar,
            context: mossAssistant.description,
          };
        }
      }

      // Fallback: check customAgents for non-enterprise
      const assistant = customAgents.find((a) => a.id === customAgentId);
      if (assistant) {
        return {
          backend: 'custom' as AcpBackend,
          name: assistant.name,
          customAgentId: assistant.id,
          isPreset: true,
          context: '',
          avatar: assistant.avatar,
        };
      }
    }
    return availableAgents?.find((a) => a.backend === key);
  };
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/yobach/Downloads/sudowork && npx tsc --noEmit --skipLibCheck 2>&1 | head -20`

Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/renderer/pages/guid/hooks/useGuidAgentSelection.ts
git commit -m "feat(guid): support Moss assistants in findAgentByKey

Update findAgentByKey to look up Moss assistants from customAgents
in enterprise mode, enabling proper agent info resolution.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Update resetSelection for Enterprise Mode

**Files:**
- Modify: `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts:849-888`

**Step 1: Update resetSelection to clear customAgents in enterprise mode**

The existing resetSelection function needs to also clear customAgents for enterprise mode.

Find the resetSelection function (around line 849) and update it:

```typescript
  // Reset agent selection to default state (no assistant selected)
  // In enterprise mode, directly select the first available agent (remote-agent)
  // 企业模式下直接选择第一个可用 agent
  const resetSelection = useCallback(() => {
    _setSelectedAgentKey(isEnterprise ? 'remote-agent' : DEFAULT_PRESET_AGENT_TYPE);
    selectedAgentKeyRef.current = isEnterprise ? 'remote-agent' : DEFAULT_PRESET_AGENT_TYPE;
    _setSelectedMode('default');
    _setSelectedAcpModel(null);
    hasAutoSelectedAgentRef.current = false;

    // Clear persisted agent key so it won't be restored on next mount
    ConfigStorage.set('guid.lastSelectedAgent', '').catch((error) => {
      console.error('Failed to clear saved agent:', error);
    });

    // Enterprise mode: clear customAgents and select remote-agent
    if (isEnterprise) {
      setCustomAgents([]);
      return;
    }

    // Consumer mode: check for scode/openclaw-gateway availability
    const agents = availableAgentsRef.current;
    const scodeAvailable = agents?.some((a) => a.backend === 'scode');
    const openclawAvailable = agents?.some((a) => a.backend === 'openclaw-gateway');
    if (scodeAvailable) {
      _setSelectedAgentKey('scode');
      selectedAgentKeyRef.current = 'scode';
    } else if (openclawAvailable) {
      _setSelectedAgentKey('openclaw-gateway');
      selectedAgentKeyRef.current = 'openclaw-gateway';
    } else if (agents && agents.length > 0) {
      const firstAgent = agents[0];
      const firstKey = firstAgent.backend === 'custom' && firstAgent.customAgentId ? `custom:${firstAgent.customAgentId}` : firstAgent.backend;
      _setSelectedAgentKey(firstKey);
      selectedAgentKeyRef.current = firstKey;
      ConfigStorage.set('guid.lastSelectedAgent', firstKey).catch((error) => {
        console.error('Failed to save auto-selected agent:', error);
      });
    } else {
      _setSelectedAgentKey(DEFAULT_PRESET_AGENT_TYPE);
      selectedAgentKeyRef.current = DEFAULT_PRESET_AGENT_TYPE;
    }
  }, [isEnterprise]);
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/yobach/Downloads/sudowork && npx tsc --noEmit --skipLibCheck 2>&1 | head -20`

Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/renderer/pages/guid/hooks/useGuidAgentSelection.ts
git commit -m "fix(guid): clear customAgents in resetSelection for enterprise mode

Ensure customAgents are cleared when resetting selection in enterprise mode,
preventing stale Moss assistants from persisting across sessions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Build and Test

**Files:**
- None (testing only)

**Step 1: Run full TypeScript check**

Run: `cd /Users/yobach/Downloads/sudowork && npx tsc --noEmit --skipLibCheck`

Expected: No errors

**Step 2: Run build**

Run: `cd /Users/yobach/Downloads/sudowork && npm run build`

Expected: Build succeeds

**Step 3: Manual testing checklist**

Test in enterprise mode:
- [ ] Moss assistants appear in bottom AssistantSelectionArea
- [ ] Remote Agent appears in top AgentPillBar
- [ ] Clicking a Moss assistant selects it correctly
- [ ] Sending message with Moss assistant creates correct conversation
- [ ] Moss API failure shows only Remote Agent

Test in consumer mode:
- [ ] Local assistants still appear in bottom AssistantSelectionArea
- [ ] Local agents appear in top AgentPillBar
- [ ] No regression in existing functionality

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(guid): address any issues found during testing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Files Modified |
|------|-------------|----------------|
| 1 | Add Moss assistant mapping function | `useGuidAgentSelection.ts` |
| 2 | Modify SWR data processing | `useGuidAgentSelection.ts` |
| 3 | Update AssistantSelectionArea | `AssistantSelectionArea.tsx` (minimal) |
| 4 | Update selection validation | `useGuidAgentSelection.ts` |
| 5 | Update findAgentByKey | `useGuidAgentSelection.ts` |
| 6 | Update resetSelection | `useGuidAgentSelection.ts` |
| 7 | Build and test | None |
