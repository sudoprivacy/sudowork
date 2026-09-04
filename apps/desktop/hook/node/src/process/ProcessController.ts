import { type ControllerSource, InterceptorError } from '../file/FileController';
import { DeferredPromise } from '@open-draft/deferred-promise';
import type { Emitter } from 'strict-event-emitter';
import { until } from '@open-draft/until';
import { emitAsync } from '../file/Utils';
import { invariant } from 'outvariant';

export type ProcessEventMap = {
  process: [
    args: {
      command: string;
      args: string[];
      controller: ProcessController;
    },
  ];
};

export class ProcessController {
  public pending: boolean;

  /**
   * A Promise that resolves when this controller handles a request.
   * See `controller.readyState` for more information on the handling result.
   */
  public handled: Promise<void>;

  get #handled() {
    return this.handled as DeferredPromise<void>;
  }

  constructor(
    protected readonly command: string,
    protected readonly args: string[],
    protected readonly source: ControllerSource
  ) {
    this.pending = true;
    this.handled = new DeferredPromise<void>();
  }

  public async control(emitter: Emitter<ProcessEventMap>) {
    const [err, _] = await until(async () => {
      const listenersPromise = emitAsync(emitter, 'process', {
        command: this.command,
        args: this.args,
        controller: this,
      });
      await Promise.race([listenersPromise, this.handled]);
    });

    if (err) {
      throw err;
    }

    if (this.pending) {
      return await this.passthrough();
    }
    return this.handled;
  }

  /**
   * Perform this request as-is.
   */
  public async passthrough(): Promise<void> {
    invariant.as(InterceptorError, this.pending, 'Failed to passthrough "%s": the process has already been handled', this.command);

    this.pending = false;
    this.source.passthrough();
    this.#handled.resolve();
  }

  /**
   * Error this request with the given reason.
   *
   * @example
   * controller.errorWith()
   * controller.errorWith(new Error('Oops!'))
   * controller.errorWith({ message: 'Oops!'})
   */
  public errorWith(reason: string): void {
    invariant.as(InterceptorError, this.pending, 'Failed to error the "%s": the process has already been handled', this.command);

    this.pending = false;
    this.source.errorWith(reason);
    this.#handled.resolve();
  }
}
