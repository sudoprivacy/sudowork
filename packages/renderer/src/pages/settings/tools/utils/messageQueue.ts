/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Global message queue manager for MCP messages.
 */
class MessageQueue {
  private static instance: MessageQueue;
  private queue: Array<() => void> = [];
  private isProcessing = false;
  private readonly delay = 100;
  private readonly maxQueueSize = 50;

  private constructor() {}

  static getInstance(): MessageQueue {
    if (!MessageQueue.instance) {
      MessageQueue.instance = new MessageQueue();
    }
    return MessageQueue.instance;
  }

  async add(showMessageFn: () => void): Promise<void> {
    if (this.queue.length >= this.maxQueueSize) {
      console.warn(`Message queue size exceeded ${this.maxQueueSize}, dropping new message`);
      return;
    }

    this.queue.push(showMessageFn);
    if (!this.isProcessing) {
      await this.process();
    }
  }

  private async process(): Promise<void> {
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift();
      if (fn) {
        fn();
        await new Promise((resolve) => setTimeout(resolve, this.delay));
      }
    }
    this.isProcessing = false;
  }
}

export const globalMessageQueue = MessageQueue.getInstance();
