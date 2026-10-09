import { Interceptor } from '@mswjs/interceptors';
import process, { type ExecException } from 'node:child_process';
import { ProcessController, type ProcessEventMap } from './ProcessController';

export class ProcessInterceptor extends Interceptor<ProcessEventMap> {
  static symbol = Symbol('process-interceptor');

  constructor() {
    super(ProcessInterceptor.symbol);
  }

  protected setup() {
    const { execFile: originalExecFile } = process;

    process.execFile = new Proxy(process.execFile, {
      apply: async (target, thisArg, args: Parameters<typeof process.execFile>) => {
        const command = args[0];
        const commandArgs: string[] = Array.isArray(args[1]) ? args[1] : [];
        // @ts-ignore
        const callback: (error: ExecException | null, stdout: string, stderr: string) => void = args[3] || args[2] || args[1];
        const controller = new ProcessController(command, commandArgs, {
          passthrough: () => target.apply(thisArg, args),
          errorWith: (reason: string) =>
            callback(
              {
                name: '',
                message: reason,
                cmd: command,
                killed: false,
                code: 1,
              },
              '',
              reason
            ),
        });
        return await controller.control(this.emitter);
      },
    });

    this.subscriptions.push(() => {
      process.execFile = originalExecFile;
    });
  }
}
