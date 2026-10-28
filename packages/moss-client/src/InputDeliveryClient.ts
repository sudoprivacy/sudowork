import {
  inputReceiptSchema,
  inputUpdateSchema,
  type InputAction,
  type InputReceipt,
  type InputState,
  type InputUpdate,
} from '@sudowork/contracts/input-delivery'

/** Transport correlation only. The agent owns pending input and delivery policy. */
export class InputDeliveryClient {
  private pending = new Map<
    string,
    {
      resolve: (receipt: InputReceipt | null) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private current: InputState | null = null

  constructor(
    private send: (requestId: string, action: InputAction) => boolean,
    private onUpdate: (update: InputUpdate) => void,
    private onReset: () => void = () => {},
  ) {}

  get state(): InputState | null {
    return this.current
  }

  request(requestId: string, action: InputAction): Promise<InputReceipt | null> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Input delivery outcome is unknown; inspect the queue before retrying'))
      }, 30_000)
      this.pending.set(requestId, { resolve, reject, timer })
      try {
        if (!this.send(requestId, action))
          throw new Error('Input was not sent: the connection is unavailable')
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  receive(frame: unknown): boolean {
    if (!frame || typeof frame !== 'object') return false
    const event = frame as Record<string, unknown>
    if (event.type === 'input_delivery_reset') {
      this.disconnect()
      this.onReset()
      return true
    }
    if (event.type === 'input_delivery_update') {
      const update = inputUpdateSchema.safeParse(event.update)
      if (update.success) this.project(update.data)
      return true
    }
    if (event.type !== 'input_delivery_reply') return false
    const requestId = typeof event.requestId === 'string' ? event.requestId : ''
    const pending = this.pending.get(requestId)
    if (!pending) return true
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    try {
      if (typeof event.error === 'string') throw new Error(event.error)
      const receipt = event.isSupported === false ? null : inputReceiptSchema.parse(event.receipt)
      if (receipt) this.project({ kind: 'state', state: receipt.state })
      pending.resolve(receipt)
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)))
    }
    return true
  }

  private project(update: InputUpdate): void {
    if (update.kind === 'state') {
      if (this.current && update.state.revision <= this.current.revision) return
      this.current = update.state
    }
    this.onUpdate(update)
  }

  disconnect(): void {
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('Connection closed; input delivery outcome is unknown'))
    }
    this.pending.clear()
    this.current = null
  }
}

export function buildInputControlMessage(requestId: string, action: InputAction) {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'input', action },
  }
}
