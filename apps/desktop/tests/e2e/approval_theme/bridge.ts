import type { IConfirmation } from '@sudowork/common/chatTypes';

const listeners = new Map<string, (data: IConfirmation<string> & { conversation_id: string }) => void>();

// Only the host boundary is a fixture; the shared approval component, Arco,
// generated utilities, theme CSS and browser layout are production code.
export const conversation = {
  confirmation: {
    list: { invoke: async () => [] },
    confirm: {
      invoke: async (payload: { data: string }) => {
        window.dispatchEvent(new CustomEvent('approval-decided', { detail: payload.data }));
      },
    },
    ...Object.fromEntries(
      ['add', 'remove', 'update'].map((name) => [
        name,
        {
          on: (listener: (data: IConfirmation<string> & { conversation_id: string }) => void) => {
            listeners.set(name, listener);
            return () => listeners.delete(name);
          },
        },
      ])
    ),
  },
};

export function requestApproval() {
  listeners.get('add')?.({
    id: 'approval-theme',
    callId: 'bash-theme',
    conversation_id: 'theme-acceptance',
    title: 'Allow this command?',
    description: 'Bash · git status --short\nRead the current working tree before continuing.',
    options: [
      { label: 'Allow once', value: 'proceed_once' },
      { label: 'Always allow this command', value: 'proceed_always' },
      { label: 'Reject', value: 'cancel' },
    ],
  });
}
