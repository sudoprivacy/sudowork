import { FileController, type FileEventMap, type FileFlag } from './FileController';
import { newError, resolveAbsolutePath, resolveFileFlags } from './Utils';
import { Interceptor } from '@mswjs/interceptors';
import fs, { type OpenMode, type PathOrFileDescriptor } from 'node:fs';
import path from 'node:path';

const mainEntryPath = path.resolve(process.argv[1] as string);

export class FileInterceptor extends Interceptor<FileEventMap> {
  static symbol = Symbol('file-io-interceptor');

  constructor() {
    super(FileInterceptor.symbol);
  }

  protected setup() {
    const { writeFile: originalWriteFile, readFile: originalReadFile, open: originalOpen, rm: originalRm, unlink: originalUnlink } = fs;

    fs.writeFile = new Proxy(fs.writeFile, {
      apply: async (target, thisArg, args: Parameters<typeof fs.writeFile>) =>
        await this.proxyApply(target, thisArg, args, {
          path: args[0],
          // @ts-ignore
          flags: typeof args[2] !== 'object' ? 'w' : args[2]?.flag,
          // @ts-ignore
          callback: args[3] || args[2],
        }),
    });

    fs.readFile = new Proxy(fs.readFile, {
      apply: async (target, thisArg, args: Parameters<typeof fs.readFile>) =>
        this.proxyApply(target, thisArg, args, {
          path: args[0],
          // @ts-ignore
          flags: typeof args[1] !== 'object' ? 'r' : args[1]?.flag,
          // @ts-ignore
          callback: args[2] || args[1],
        }),
    });

    fs.open = new Proxy(fs.open, {
      apply: async (target, thisArg, args: Parameters<typeof fs.open>) =>
        this.proxyApply(target, thisArg, args, {
          path: args[0],
          // @ts-ignore
          flags: args.length < 3 ? 'r' : args[1],
          // @ts-ignore
          callback: args[3] || args[2] || args[1],
        }),
    });

    fs.rm = new Proxy(fs.rm, {
      apply: async (target, thisArg, args: Parameters<typeof fs.rm>) =>
        this.proxyApply(target, thisArg, args, {
          path: args[0],
          flags: ['REMOVE'],
          // @ts-ignore
          callback: args[2] || args[1],
        }),
    });

    fs.unlink = new Proxy(fs.unlink, {
      apply: async (target, thisArg, args: Parameters<typeof fs.unlink>) =>
        this.proxyApply(target, thisArg, args, {
          path: args[0],
          flags: ['REMOVE'],
          // @ts-ignore
          callback: args[1],
        }),
    });

    this.subscriptions.push(() => {
      fs.writeFile = originalWriteFile;
      fs.readFile = originalReadFile;
      fs.open = originalOpen;
      fs.rm = originalRm;
      fs.unlink = originalUnlink;
    });
  }

  private async proxyApply(
    target: any,
    thisArg: any,
    args: any[],
    parsedArgs: {
      path: PathOrFileDescriptor;
      flags: OpenMode | FileFlag[];
      callback: (err?: NodeJS.ErrnoException) => void;
    }
  ) {
    if (typeof parsedArgs.path === 'number') {
      return target.apply(thisArg, args);
    }
    const realPath = resolveAbsolutePath(parsedArgs.path);
    if (realPath === mainEntryPath) {
      return target.apply(thisArg, args);
    }
    const fileFlags = Array.isArray(parsedArgs.flags) ? parsedArgs.flags : resolveFileFlags(parsedArgs.flags);
    const controller = new FileController(realPath, fileFlags, {
      passthrough: () => target.apply(thisArg, args),
      errorWith: (reason: string) => parsedArgs.callback(newError(realPath, 'open', reason)),
    });
    return await controller.control(this.emitter);
  }
}
