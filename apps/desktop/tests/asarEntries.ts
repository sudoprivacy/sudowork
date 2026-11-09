import { createRequire } from 'node:module';

/** Read the archive with the same locked ASAR dependency used by the packager. */
export function getAsarEntries(archivePath: string): Set<string> {
  const localRequire = createRequire(import.meta.url);
  const builderRequire = createRequire(localRequire.resolve('electron-builder/package.json'));
  const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'));
  const asar = appBuilderRequire('@electron/asar') as {
    listPackage(path: string): string[];
  };

  return new Set(asar.listPackage(archivePath).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, '')));
}
