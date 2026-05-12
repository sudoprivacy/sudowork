# Enterprise Mode Assistants Display Design

## Problem Statement

In enterprise mode, assistants returned from Moss Server are currently displayed in the top `AgentPillBar` alongside the "Remote Agent" option. This is inconsistent with consumer mode, where local custom assistants are displayed at the bottom via `AssistantSelectionArea` component.

**Current behavior:**
- Enterprise mode: Moss assistants → `availableAgents` → displayed in top `AgentPillBar`
- Consumer mode: Local assistants → `customAgents` → displayed in bottom `AssistantSelectionArea`

**Expected behavior:**
- Enterprise mode: Moss assistants should be displayed at the bottom, similar to consumer mode
- Keep "Remote Agent" as the default option in the top `AgentPillBar`

## Solution Overview

Map Moss Server assistants to `customAgents` instead of `availableAgents`, enabling them to be displayed via `AssistantSelectionArea` component at the bottom of the Guid page.

## Data Flow

### Before (Current)

```
Enterprise Mode:
Moss API → availableAgents: [Remote Agent, Assistant1, Assistant2, ...]
           customAgents: [] (skipped)

Consumer Mode:
Local detection → availableAgents: [gemini, claude, scode, ...]
Local config → customAgents: [builtin assistants, user assistants]
```

### After (Proposed)

```
Enterprise Mode:
Moss API → availableAgents: [Remote Agent] (default option only)
        → customAgents: [Moss Assistant1, Moss Assistant2, ...]

Consumer Mode: (unchanged)
Local detection → availableAgents: [gemini, claude, scode, ...]
Local config → customAgents: [builtin assistants, user assistants]
```

## Implementation Details

### 1. Moss Assistant Data Mapping

**File:** `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`

Map Moss Server assistant to `AcpBackendConfig`:

```typescript
interface MossAssistant {
  key: string;
  name: string;
  avatar?: string;
  emoji?: string;
  description?: string;
}

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

### 2. Hook Changes

**File:** `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts`

Modify the SWR data processing for enterprise mode:

```typescript
// In the SWR effect for availableAgentsData
useEffect(() => {
  if (availableAgentsData && Array.isArray(availableAgentsData)) {
    if (isEnterprise) {
      const enterpriseAgents = availableAgentsData as unknown as MossAssistant[];

      // Map Moss assistants to customAgents
      const mossCustomAgents: AcpBackendConfig[] = enterpriseAgents.map(mapMossAssistantToConfig);
      setCustomAgents(mossCustomAgents);

      // availableAgents only contains Remote Agent
      const mapped: AvailableAgent[] = [
        {
          backend: 'remote-agent' as AcpBackend,
          name: 'Remote Agent',
          customAgentId: undefined,
        },
      ];
      setAvailableAgents(mapped);
    } else {
      // Consumer mode: unchanged
      setAvailableAgents(availableAgentsData as AvailableAgent[]);
    }
  }
}, [availableAgentsData, isEnterprise]);
```

### 3. Selection Key Format

When user selects a Moss assistant:
- Selection key: `custom:moss:{assistant.key}`
- Backend type: `remote-agent`
- Custom agent ID: `moss:{assistant.key}`

### 4. Send Logic

**File:** `src/renderer/pages/guid/hooks/useGuidSend.ts`

The existing logic already handles `remote-agent` type. When `selectedAgentKey` starts with `custom:moss:`, the conversation will be created with:
- `type: 'remote-agent'`
- `presetAssistantId: moss:{key}` (for Moss Server to identify the assistant)

### 5. UI Layout

**File:** `src/renderer/pages/guid/GuidPage.tsx`

No changes needed. The existing layout already renders `AssistantSelectionArea` at the bottom when not in assistant mode.

```
┌────────────────────────────────────────────────┐
│  [Title]                                       │
│  [AgentPillBar: Remote Agent]                  │  ← Top: default option
│  [PromptTemplates]                             │
├────────────────────────────────────────────────┤
│  [Input Card]                                  │
│  [Action Row: Send button, etc.]               │
├────────────────────────────────────────────────┤
│  [AssistantSelectionArea: Moss assistants]     │  ← Bottom: specific assistants
│  [Assistant 1] [Assistant 2] [Assistant 3] ... │
└────────────────────────────────────────────────┘
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts` | Map Moss assistants to `customAgents` in enterprise mode |
| `src/renderer/pages/guid/components/AssistantSelectionArea.tsx` | May need minor adjustments for Moss assistant rendering |

## Safety Considerations

1. **Consumer mode isolation:** The enterprise mode logic is gated by `isEnterprise` check. Consumer mode code path remains unchanged.

2. **Fallback handling:** If Moss API fails, provide default Remote Agent option.

3. **Backward compatibility:** Existing conversations with `remote-agent` type continue to work.

## Testing Plan

1. **Enterprise mode:**
   - Verify Moss assistants appear in bottom `AssistantSelectionArea`
   - Verify Remote Agent appears in top `AgentPillBar`
   - Verify selecting a Moss assistant creates correct conversation type
   - Verify Moss API failure shows only Remote Agent

2. **Consumer mode:**
   - Verify local assistants still appear in bottom `AssistantSelectionArea`
   - Verify local agents appear in top `AgentPillBar`
   - Verify no regression in existing functionality

## Success Criteria

- Enterprise mode assistants display at the bottom, consistent with consumer mode
- Remote Agent remains as default option in enterprise mode
- Consumer mode functionality unchanged
- No visual or functional regressions
