import { FileController, type FileEventMap, type FileFlag } from './FileController';
import { newError, resolveAbsolutePath, resolveFileFlags } from './Utils';
import { Interceptor } from '@mswjs/interceptors';
import fs, { type OpenMode, type PathOrFileDescriptor, promises as fsPromises } from 'node:fs';
import path from 'node:path';

const mainEntryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

export class FileInterceptor extends Interceptor<FileEventMap> {
  static symbol = Symbol('file-io-interceptor');

  constructor() {
    super(FileInterceptor.symbol);
  }

  protected setup() {
    const {
      writeFile: originalWriteFile,
      readFile: originalReadFile,
      open: originalOpen,
      rm: originalRm,
      unlink: originalUnlink,
      rename: originalRename,
      renameSync: originalRenameSync,
      mkdir: originalMkdir,
      readdir: originalReaddir,
      stat: originalStat,
      access: originalAccess,
      existsSync: originalExistsSync,
      copyFile: originalCopyFile,
    } = fs;

    const {
      writeFile: originalPromisesWriteFile,
      readFile: originalPromisesReadFile,
      open: originalPromisesOpen,
      rm: originalPromisesRm,
      unlink: originalPromisesUnlink,
      rename: originalPromisesRename,
      mkdir: originalPromisesMkdir,
      readdir: originalPromisesReaddir,
      stat: originalPromisesStat,
      access: originalPromisesAccess,
      copyFile: originalPromisesCopyFile,
    } = fsPromises;

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

    // Intercept fs.rename (callback style)
    fs.rename = new Proxy(fs.rename, {
      apply: async (target, thisArg, args: Parameters<typeof fs.rename>) => {
        const oldPath = args[0];
        const newPath = args[1];
        // @ts-ignore
        const callback = args[2];

        // Check both old path and new path
        const oldResult = await this.checkPath(oldPath, ['RENAME']);
        if (oldResult.blocked) {
          return callback(newError(String(oldPath), 'rename', oldResult.reason || 'Blocked'));
        }

        const newResult = await this.checkPath(newPath, ['RENAME']);
        if (newResult.blocked) {
          return callback(newError(String(newPath), 'rename', newResult.reason || 'Blocked'));
        }

        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.renameSync (sync)
    fs.renameSync = new Proxy(fs.renameSync, {
      apply: (target, thisArg, args: Parameters<typeof fs.renameSync>) => {
        // For sync operations, we can't await the check
        // This is a limitation - sync operations will not be intercepted
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.rename
    fsPromises.rename = new Proxy(fsPromises.rename, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.rename>) => {
        const oldPath = args[0];
        const newPath = args[1];

        // Check both old path and new path
        const oldResult = await this.checkPath(oldPath, ['RENAME']);
        if (oldResult.blocked) {
          throw newError(String(oldPath), 'rename', oldResult.reason || 'Blocked');
        }

        const newResult = await this.checkPath(newPath, ['RENAME']);
        if (newResult.blocked) {
          throw newError(String(newPath), 'rename', newResult.reason || 'Blocked');
        }

        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.writeFile
    fsPromises.writeFile = new Proxy(fsPromises.writeFile, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.writeFile>) => {
        const filePath = args[0];
        const result = await this.checkPath(filePath, ['O_WRONLY', 'O_CREAT', 'O_TRUNC']);
        if (result.blocked) {
          throw newError(String(filePath), 'writeFile', result.reason || 'Blocked');
        }
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.readFile
    fsPromises.readFile = new Proxy(fsPromises.readFile, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.readFile>) => {
        const filePath = args[0];
        const result = await this.checkPath(filePath, ['O_RDONLY']);
        if (result.blocked) {
          throw newError(String(filePath), 'readFile', result.reason || 'Blocked');
        }
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.open
    fsPromises.open = new Proxy(fsPromises.open, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.open>) => {
        const filePath = args[0];
        const flags = args[1] || 'r';
        const fileFlags = Array.isArray(flags) ? flags : resolveFileFlags(flags);
        const result = await this.checkPath(filePath, fileFlags);
        if (result.blocked) {
          throw newError(String(filePath), 'open', result.reason || 'Blocked');
        }
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.rm
    fsPromises.rm = new Proxy(fsPromises.rm, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.rm>) => {
        const filePath = args[0];
        const result = await this.checkPath(filePath, ['REMOVE']);
        if (result.blocked) {
          throw newError(String(filePath), 'rm', result.reason || 'Blocked');
        }
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.unlink
    fsPromises.unlink = new Proxy(fsPromises.unlink, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.unlink>) => {
        const filePath = args[0];
        const result = await this.checkPath(filePath, ['REMOVE']);
        if (result.blocked) {
          throw newError(String(filePath), 'unlink', result.reason || 'Blocked');
        }
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.mkdir (callback style)
    fs.mkdir = new Proxy(fs.mkdir, {
      apply: async (target, thisArg, args: Parameters<typeof fs.mkdir>) =>
        await this.proxyApply(target, thisArg, args, {
          path: args[0],
          flags: ['O_CREAT', 'O_DIRECTORY'],
          // @ts-ignore
          callback: args[2] || args[1],
        }),
    });

    // Intercept fs.readdir (callback style)
    fs.readdir = new Proxy(fs.readdir, {
      apply: async (target, thisArg, args: Parameters<typeof fs.readdir>) =>
        await this.proxyApply(target, thisArg, args, {
          path: args[0],
          flags: ['O_RDONLY', 'O_DIRECTORY'],
          // @ts-ignore
          callback: args[2] || args[1],
        }),
    });

    // Intercept fs.stat (callback style)
    fs.stat = new Proxy(fs.stat, {
      apply: async (target, thisArg, args: Parameters<typeof fs.stat>) =>
        await this.proxyApply(target, thisArg, args, {
          path: args[0],
          flags: ['STAT'],
          // @ts-ignore
          callback: args[1],
        }),
    });

    // Intercept fs.access (callback style)
    fs.access = new Proxy(fs.access, {
      apply: async (target, thisArg, args: Parameters<typeof fs.access>) =>
        await this.proxyApply(target, thisArg, args, {
          path: args[0],
          flags: ['ACCESS'],
          // @ts-ignore
          callback: args[2] || args[1],
        }),
    });

    // Intercept fs.existsSync (sync)
    fs.existsSync = new Proxy(fs.existsSync, {
      apply: (target, thisArg, args: Parameters<typeof fs.existsSync>) => {
        // For sync operations, we can't await the check
        // This is a limitation - sync operations will not be intercepted
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.copyFile (callback style)
    fs.copyFile = new Proxy(fs.copyFile, {
      apply: async (target, thisArg, args: Parameters<typeof fs.copyFile>) => {
        const srcPath = args[0];
        const destPath = args[1];
        // @ts-ignore
        const callback = args[2];

        // Check both source and destination
        const srcResult = await this.checkPath(srcPath, ['O_RDONLY']);
        if (srcResult.blocked) {
          return callback(newError(String(srcPath), 'copyFile', srcResult.reason || 'Blocked'));
        }

        const destResult = await this.checkPath(destPath, ['O_WRONLY', 'O_CREAT']);
        if (destResult.blocked) {
          return callback(newError(String(destPath), 'copyFile', destResult.reason || 'Blocked'));
        }

        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.mkdir
    fsPromises.mkdir = new Proxy(fsPromises.mkdir, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.mkdir>) => {
        const filePath = args[0];
        const result = await this.checkPath(filePath, ['O_CREAT', 'O_DIRECTORY']);
        if (result.blocked) {
          throw newError(String(filePath), 'mkdir', result.reason || 'Blocked');
        }
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.readdir
    fsPromises.readdir = new Proxy(fsPromises.readdir, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.readdir>) => {
        const filePath = args[0];
        const result = await this.checkPath(filePath, ['O_RDONLY', 'O_DIRECTORY']);
        if (result.blocked) {
          throw newError(String(filePath), 'readdir', result.reason || 'Blocked');
        }
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.stat
    fsPromises.stat = new Proxy(fsPromises.stat, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.stat>) => {
        const filePath = args[0];
        const result = await this.checkPath(filePath, ['STAT']);
        if (result.blocked) {
          throw newError(String(filePath), 'stat', result.reason || 'Blocked');
        }
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.access
    fsPromises.access = new Proxy(fsPromises.access, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.access>) => {
        const filePath = args[0];
        const result = await this.checkPath(filePath, ['ACCESS']);
        if (result.blocked) {
          throw newError(String(filePath), 'access', result.reason || 'Blocked');
        }
        return target.apply(thisArg, args);
      },
    });

    // Intercept fs.promises.copyFile
    fsPromises.copyFile = new Proxy(fsPromises.copyFile, {
      apply: async (target, thisArg, args: Parameters<typeof fsPromises.copyFile>) => {
        const srcPath = args[0];
        const destPath = args[1];

        // Check both source and destination
        const srcResult = await this.checkPath(srcPath, ['O_RDONLY']);
        if (srcResult.blocked) {
          throw newError(String(srcPath), 'copyFile', srcResult.reason || 'Blocked');
        }

        const destResult = await this.checkPath(destPath, ['O_WRONLY', 'O_CREAT']);
        if (destResult.blocked) {
          throw newError(String(destPath), 'copyFile', destResult.reason || 'Blocked');
        }

        return target.apply(thisArg, args);
      },
    });

    this.subscriptions.push(() => {
      fs.writeFile = originalWriteFile;
      fs.readFile = originalReadFile;
      fs.open = originalOpen;
      fs.rm = originalRm;
      fs.unlink = originalUnlink;
      fs.rename = originalRename;
      fs.renameSync = originalRenameSync;
      fs.mkdir = originalMkdir;
      fs.readdir = originalReaddir;
      fs.stat = originalStat;
      fs.access = originalAccess;
      fs.existsSync = originalExistsSync;
      fs.copyFile = originalCopyFile;
      fsPromises.writeFile = originalPromisesWriteFile;
      fsPromises.readFile = originalPromisesReadFile;
      fsPromises.open = originalPromisesOpen;
      fsPromises.rm = originalPromisesRm;
      fsPromises.unlink = originalPromisesUnlink;
      fsPromises.rename = originalPromisesRename;
      fsPromises.mkdir = originalPromisesMkdir;
      fsPromises.readdir = originalPromisesReaddir;
      fsPromises.stat = originalPromisesStat;
      fsPromises.access = originalPromisesAccess;
      fsPromises.copyFile = originalPromisesCopyFile;
    });
  }

  /**
   * Check if a path should be blocked
   */
  private async checkPath(
    path: PathOrFileDescriptor,
    flags: FileFlag[]
  ): Promise<{ blocked: boolean; reason?: string }> {
    if (typeof path === 'number') {
      return { blocked: false };
    }
    const realPath = resolveAbsolutePath(path);
    if (realPath === mainEntryPath) {
      return { blocked: false };
    }

    return new Promise((resolve) => {
      const fileFlags = flags;
      const controller = new FileController(realPath, fileFlags, {
        passthrough: () => resolve({ blocked: false }),
        errorWith: (reason: string) => resolve({ blocked: true, reason }),
      });
      controller.control(this.emitter).catch(() => resolve({ blocked: false }));
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
