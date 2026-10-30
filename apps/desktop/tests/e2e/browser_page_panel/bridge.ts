import type { BrowserSessionAction } from '@sudowork/contracts/browser-session';

/** Authenticated fixture host boundary; browser state and input stay real. */
export const browserSession = {
  invoke: {
    invoke: async (payload: { conversationId: string; action: BrowserSessionAction }) => {
      const response = await fetch('/api/browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`Browser host rejected operation (${response.status})`);
      const data = await response.json();
      if (payload.action.kind === 'input') {
        // Observe actual checked HTTP completion; source pointer-up is earlier.
        window.dispatchEvent(new CustomEvent('fixture-input-acknowledged', { detail: payload.action.input }));
      }
      return { success: true, data };
    },
  },
};

// This component fixture has no model process. Interrupt/continuation is
// accepted separately through the application's existing live task journeys.
export const conversation = {
  stop: {
    invoke: async () => {
      throw new Error('No running agent in this browser component fixture');
    },
  },
};
