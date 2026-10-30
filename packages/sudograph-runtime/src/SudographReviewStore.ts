export interface IReviewSubscription {
  id: string;
  workspaceId: string;
  conversationId: string;
  account: string;
  shareId: string;
}

export interface IReviewInboxItem {
  id: string;
  subscription: IReviewSubscription;
  event: { id: string; share_id: string; comment_id: string; parent_id: string | null; event_type: string; actor_role: string };
  status: string;
  messageId: string;
}

type Stored<T> = T | Promise<T>;

/** Host bookkeeping only. ShareOne owns comments; the compiler owns the model. */
export interface ISudographReviewStore {
  getHostValue<T>(key: string): Stored<T | null>;
  setHostValue(key: string, value: unknown): Stored<void>;
  subscribeReview(value: IReviewSubscription): Stored<void>;
  reviewSubscriptions(workspaceId: string, shareId: string): Stored<IReviewSubscription[]>;
  /** Atomically commit the batch, deduplicating event/subscription IDs, before resolving. */
  acceptReviewEvents(items: Array<{ id: string; subscription: IReviewSubscription; event: IReviewInboxItem['event']; messageId: string }>): Stored<void>;
  reviewInbox(account: string): Stored<IReviewInboxItem[]>;
  finishReviewEvent(id: string, status: 'running' | 'delivered' | 'error' | 'ignored', error?: string | null): Stored<void>;
  /** Atomically claim one human input digest per subscription. */
  claimReviewInput(id: string, digest: string): Stored<boolean>;
  reviewDeliverySummary(account: string, workspaceId: string, conversationId: string): Stored<Record<string, number>>;
}
