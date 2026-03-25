import { emitAsync } from './Utils';
import { DeferredPromise } from '@open-draft/deferred-promise';
import { until } from '@open-draft/until';
import { invariant } from 'outvariant';
import { Emitter } from 'strict-event-emitter';

export class InterceptorError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'InterceptorError';
    Object.setPrototypeOf(this, InterceptorError.prototype);
  }
}

export interface ControllerSource {
  passthrough(): void;
  errorWith(reason: string): void;
}

export type FileFlag = 'O_RDONLY' | 'O_WRONLY' | 'O_RDWR' | 'O_CREAT' | 'O_EXCL' | 'O_NOCTTY' | 'O_TRUNC' | 'O_APPEND' | 'O_DIRECTORY' | 'O_NOATIME' | 'O_NOFOLLOW' | 'O_SYNC' | 'O_DSYNC' | 'O_SYMLINK' | 'O_DIRECT' | 'O_NONBLOCK' | 'REMOVE';

export type FileEventMap = {
  file: [
    args: {
      path: string;
      flags: FileFlag[];
      controller: FileController;
    },
  ];
};

export class FileController {
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
    protected readonly path: string,
    protected readonly flags: FileFlag[],
    protected readonly source: ControllerSource
  ) {
    this.pending = true;
    this.handled = new DeferredPromise<void>();
  }

  public async control(emitter: Emitter<FileEventMap>) {
    const [err, _] = await until(async () => {
      const listenersPromise = emitAsync(emitter, 'file', {
        path: this.path,
        flags: this.flags,
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
    invariant.as(InterceptorError, this.pending, 'Failed to passthrough "%s": the file has already been handled', this.path);

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
    invariant.as(InterceptorError, this.pending, 'Failed to error the "%s": the file has already been handled', this.path);

    this.pending = false;
    this.source.errorWith(reason);
    this.#handled.resolve();
  }
}
