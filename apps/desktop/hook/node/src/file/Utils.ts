import { constants, type OpenMode, type PathLike } from 'node:fs';
import 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { Emitter, type EventMap } from 'strict-event-emitter';

/**
 * Emits an event on the given emitter but executes
 * the listeners sequentially. This accounts for asynchronous
 * listeners (e.g. those having "sleep" and handling the request).
 */
export async function emitAsync<Events extends EventMap, EventName extends keyof Events>(emitter: Emitter<Events>, eventName: EventName, ...data: Events[EventName]): Promise<void> {
  const listeners = emitter.listeners(eventName);

  if (listeners.length === 0) {
    return;
  }

  for (const listener of listeners) {
    await listener.apply(emitter, data);
  }
}

export function newError(path: string, syscall: string, message: string): NodeJS.ErrnoException {
  return {
    errno: -4048,
    code: 'EPERM',
    path,
    syscall,
    name: '',
    message,
  };
}

export function resolveAbsolutePath(pathlike: PathLike): string {
  let p: string;
  if (Buffer.isBuffer(pathlike)) {
    p = pathlike.toString('utf8');
  } else if (pathlike instanceof URL) {
    if (pathlike.protocol !== 'file:') {
      throw new Error(`Unsupported URL protocol: ${pathlike.protocol}`);
    }
    p = pathlike.pathname;
  } else {
    p = pathlike;
  }
  return path.resolve(p);
}

export type FileFlag = 'O_RDONLY' | 'O_WRONLY' | 'O_RDWR' | 'O_CREAT' | 'O_EXCL' | 'O_NOCTTY' | 'O_TRUNC' | 'O_APPEND' | 'O_DIRECTORY' | 'O_NOATIME' | 'O_NOFOLLOW' | 'O_SYNC' | 'O_DSYNC' | 'O_SYMLINK' | 'O_DIRECT' | 'O_NONBLOCK' | 'REMOVE';

export function resolveFileFlags(flags?: OpenMode): FileFlag[] {
  const numberFlags = stringToFlags(flags);

  const fileFlags = new Array<FileFlag>();
  if (numberFlags & constants.O_RDWR) {
    fileFlags.push('O_RDWR');
  } else if (numberFlags & constants.O_WRONLY) {
    fileFlags.push('O_WRONLY');
  } else {
    fileFlags.push('O_RDONLY');
  }

  const openFlags: Array<[number, FileFlag]> = [
    [constants.O_CREAT, 'O_CREAT'],
    [constants.O_EXCL, 'O_EXCL'],
    [constants.O_NOCTTY, 'O_NOCTTY'],
    [constants.O_TRUNC, 'O_TRUNC'],
    [constants.O_APPEND, 'O_APPEND'],
    [constants.O_DIRECTORY, 'O_DIRECTORY'],
    [constants.O_NOATIME, 'O_NOATIME'],
    [constants.O_NOFOLLOW, 'O_NOFOLLOW'],
    [constants.O_SYNC, 'O_SYNC'],
    [constants.O_DSYNC, 'O_DSYNC'],
    [constants.O_SYMLINK, 'O_SYMLINK'],
    [constants.O_DIRECT, 'O_DIRECT'],
    [constants.O_NONBLOCK, 'O_NONBLOCK'],
  ];
  openFlags.forEach(([flag, name]) => {
    if (numberFlags & flag) {
      fileFlags.push(name);
    }
  });
  return fileFlags;
}

// copy from
// internal/fs/utils
function stringToFlags(flags?: OpenMode): number {
  if (typeof flags === 'number') {
    return flags;
  }
  if (!flags) {
    return constants.O_RDONLY;
  }

  switch (flags) {
    case 'r':
      return constants.O_RDONLY;
    case 'rs': // Fall through.
    case 'sr':
      return constants.O_RDONLY | constants.O_SYNC;
    case 'r+':
      return constants.O_RDWR;
    case 'rs+': // Fall through.
    case 'sr+':
      return constants.O_RDWR | constants.O_SYNC;

    case 'w':
      return constants.O_TRUNC | constants.O_CREAT | constants.O_WRONLY;
    case 'wx': // Fall through.
    case 'xw':
      return constants.O_TRUNC | constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL;

    case 'w+':
      return constants.O_TRUNC | constants.O_CREAT | constants.O_RDWR;
    case 'wx+': // Fall through.
    case 'xw+':
      return constants.O_TRUNC | constants.O_CREAT | constants.O_RDWR | constants.O_EXCL;

    case 'a':
      return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY;
    case 'ax': // Fall through.
    case 'xa':
      return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL;
    case 'as': // Fall through.
    case 'sa':
      return constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_SYNC;

    case 'a+':
      return constants.O_APPEND | constants.O_CREAT | constants.O_RDWR;
    case 'ax+': // Fall through.
    case 'xa+':
      return constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | constants.O_EXCL;
    case 'as+': // Fall through.
    case 'sa+':
      return constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | constants.O_SYNC;
  }

  throw new Error(`flags is invalid: ${flags}`);
}
