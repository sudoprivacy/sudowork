import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { conversation } from '@sudowork/host-bridge/ipcBridge';
import { inputReceiptSchema, inputStateSchema, type InputAction, type InputState } from '@sudowork/contracts/input-delivery';

/** Project the agent's queue; admission and scheduling stay in the engine. */
export function useInputDelivery(conversationId: string, isEnabled: boolean) {
  const { t } = useTranslation();
  const [state, setState] = useState<InputState | null>(null);
  const ownerRef = useRef<{ generation: number } | null>(null);

  const onState = useCallback((next: InputState) => {
    setState((previous) => (previous && previous.revision >= next.revision ? previous : next));
  }, []);

  useEffect(() => {
    const owner = { generation: 0 };
    ownerRef.current = owner;
    setState(null);
    if (!isEnabled) return;
    const unsubscribe = conversation.inputQueueUpdate.on((event) => {
      if (event.conversation_id !== conversationId) return;
      if (event.isReset) {
        owner.generation += 1;
        setState(null);
        return;
      }
      if (!event.state) return;
      const parsed = inputStateSchema.safeParse(event.state);
      if (parsed.success) onState(parsed.data);
    });
    void conversation.inputControl
      .invoke({ conversation_id: conversationId, action: { action: 'snapshot' } })
      .then((result) => {
        if (ownerRef.current !== owner || owner.generation !== 0 || !result?.success || !result.data?.receipt) return;
        onState(inputReceiptSchema.parse(result.data.receipt).state);
      })
      .catch(() => {
        // Older and foreign agents retain their existing input controls.
      });
    return () => {
      ownerRef.current = null;
      unsubscribe();
    };
  }, [conversationId, isEnabled, onState]);

  const onControl = useCallback(
    async (action: InputAction) => {
      const owner = ownerRef.current;
      const generation = owner?.generation;
      const result = await conversation.inputControl.invoke({ conversation_id: conversationId, action });
      if (!result?.success || !result.data?.isSupported || !result.data.receipt) {
        throw new Error(result?.msg || t('messages.inputDelivery.failed'));
      }
      const receipt = inputReceiptSchema.parse(result.data.receipt);
      if (ownerRef.current === owner && owner?.generation === generation) onState(receipt.state);
      return receipt;
    },
    [conversationId, onState, t]
  );

  return { isSupported: state !== null, state, onControl };
}
