import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import JSZip from 'jszip';
import type { IOntologyPackageExportResult } from '@sudowork/ontology-common';
import type { IOntologyArtifact } from './artifact.js';
import { canonicalJson, contentHash, listPackageFiles, loadOntologyArtifact, OntologyPackageError, packageFilePath, sealPackage, verifyPackage, writePackageFile } from './artifact.js';

export interface IOntologyArchiveOptions {
  targetPath: string;
  embeddedResourceIds: string[];
  signal?: AbortSignal;
  onProgress?: (phase: 'collecting' | 'validating' | 'packing', completed: number, total: number) => void;
  onVerify?: (directory: string) => Promise<unknown>;
}

export async function exportOntologyArchive(artifact: IOntologyArtifact, options: IOntologyArchiveOptions) {
  await verifyPackage(artifact.directory);
  const selected = new Set(options.embeddedResourceIds);
  if ([...selected].some((id) => !artifact.manifest.resources.some((item) => item.id === id && ['file', 'sqlite'].includes(item.provider)))) throw new OntologyPackageError('INVALID_ARGUMENTS', 'Only file and SQLite resources can be embedded.');
  const staging = await fs.mkdtemp(path.join(path.dirname(artifact.directory), '.export-'));
  const temporaryOutput = options.targetPath + '.tmp-' + randomUUID();
  try {
    await fs.cp(artifact.directory, staging, { recursive: true, force: false });
    const manifest = structuredClone(artifact.manifest);
    await fs.rm(path.join(staging, 'assets'), { recursive: true, force: true });
    let completed = 0;
    for (const resource of manifest.resources) {
      delete resource.embeddedPath;
      options.signal?.throwIfAborted();
      options.onProgress?.('collecting', completed++, manifest.resources.length);
      if (!selected.has(resource.id)) continue;
      const source = resource.provider === 'file' ? artifact.bindings.files?.[resource.assetIds[0]] : artifact.bindings.connections?.[resource.id]?.path;
      if (!source || !path.isAbsolute(source)) throw new OntologyPackageError('BINDING_REQUIRED', resource.name);
      const stat = await fs.stat(source);
      if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new OntologyPackageError('PACKAGE_INVALID', 'Resource is not a supported file: ' + resource.name);
      const relative = 'assets/' + contentHash(resource.id).slice(0, 24) + (resource.provider === 'sqlite' ? '.db' : path.extname(source).replace(/[^a-zA-Z0-9.]/g, ''));
      const target = packageFilePath(staging, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (resource.provider === 'sqlite') {
        const database = new DatabaseSync(source, { readOnly: true });
        try {
          await backup(database, target, {
            rate: 100,
            progress: () => {
              options.signal?.throwIfAborted();
            },
          });
        } finally {
          database.close();
        }
      } else {
        await pipeline(createReadStream(source), createWriteStream(target, { mode: 0o600 }), { signal: options.signal });
      }
      resource.embeddedPath = relative;
    }
    await writePackageFile(staging, 'manifest.json', canonicalJson(manifest));
    await sealPackage(staging);
    options.signal?.throwIfAborted();
    options.onProgress?.('validating', 0, 1);
    const loaded = await loadOntologyArtifact(staging);
    const runtimeCheck = !loaded.missingBindings.length ? await options.onVerify?.(staging) : undefined;
    const runtimeVerification: NonNullable<IOntologyPackageExportResult['runtimeVerification']> = loaded.missingBindings.length ? 'binding-required' : options.onVerify ? 'passed' : 'not-run';
    await writePackageFile(
      staging,
      'verification/export-report.json',
      canonicalJson({
        runtimeDigest: manifest.runtimeDigest,
        isStructurallyValid: true,
        runtimeVerification,
        runtimeCheck,
        requiresBindings: loaded.missingBindings,
        embeddedResources: [...selected],
        exportedAt: new Date().toISOString(),
      })
    );
    const packageDigest = await sealPackage(staging);
    const zip = new JSZip();
    const files = await listPackageFiles(staging);
    completed = 0;
    for (const name of files) {
      options.signal?.throwIfAborted();
      options.onProgress?.('packing', completed++, files.length);
      zip.file(name, createReadStream(packageFilePath(staging, name)), { date: new Date('1980-01-01T00:00:00Z'), unixPermissions: 0o100600 });
    }
    await pipeline(zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' }), createWriteStream(temporaryOutput, { mode: 0o600, flags: 'wx' }), { signal: options.signal });
    options.signal?.throwIfAborted();
    await fs.rename(temporaryOutput, options.targetPath);
    return { filePath: options.targetPath, fileBytes: (await fs.stat(options.targetPath)).size, runtimeDigest: manifest.runtimeDigest, packageDigest, runtimeVerification, requiresBindings: loaded.missingBindings };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    await fs.rm(temporaryOutput, { force: true });
  }
}

export async function extractOntologyArchive(archivePath: string, targetDirectory: string): Promise<void> {
  if ((await fs.stat(archivePath)).size > 512 * 1024 * 1024) throw new OntologyPackageError('PACKAGE_INVALID', 'Archive exceeds size limit.');
  const bytes = await fs.readFile(archivePath);
  validateZipDirectory(bytes);
  const archive = await JSZip.loadAsync(bytes);
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  if (entries.length > 4096) throw new OntologyPackageError('PACKAGE_INVALID', 'Too many archive entries.');
  await fs.mkdir(targetDirectory, { recursive: false, mode: 0o700 });
  let totalBytes = 0;
  const names = new Set<string>();
  try {
    for (const entry of entries) {
      const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName || entry.name;
      if (original !== entry.name) throw new OntologyPackageError('PACKAGE_INVALID', 'Archive contains a normalized path.');
      const mode = typeof entry.unixPermissions === 'string' ? Number.parseInt(entry.unixPermissions, 8) : entry.unixPermissions || 0;
      if ((mode & 0o170000) === 0o120000 || names.has(entry.name.toLowerCase())) throw new OntologyPackageError('PACKAGE_INVALID', 'Archive contains links or colliding paths.');
      names.add(entry.name.toLowerCase());
      const target = packageFilePath(targetDirectory, entry.name);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          totalBytes += chunk.length;
          if (totalBytes > 512 * 1024 * 1024) callback(new OntologyPackageError('PACKAGE_INVALID', 'Uncompressed archive exceeds size limit.'));
          else callback(null, chunk);
        },
      });
      await pipeline(entry.nodeStream(), limiter, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
    }
    await verifyPackage(targetDirectory);
  } catch (error) {
    await fs.rm(targetDirectory, { recursive: true, force: true });
    throw error;
  }
}

function validateZipDirectory(bytes: Buffer): void {
  let end = bytes.length - 22;
  const minimum = Math.max(0, bytes.length - 65557);
  while (end >= minimum && (bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length)) end--;
  if (end < minimum || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid ZIP directory.');
  const count = bytes.readUInt16LE(end + 10);
  const length = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);
  const boundary = cursor + length;
  if (count > 4096 || boundary > end || cursor > bytes.length) throw new OntologyPackageError('PACKAGE_INVALID', 'Unsupported ZIP directory.');
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > boundary || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid ZIP entry.');
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const recordLength = 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    if (cursor + recordLength > boundary) throw new OntologyPackageError('PACKAGE_INVALID', 'Invalid ZIP entry length.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const normalized = name.endsWith('/') ? name.slice(0, -1) : name;
    packageFilePath('/package', normalized);
    if (names.has(normalized.toLowerCase())) throw new OntologyPackageError('PACKAGE_INVALID', 'Duplicate ZIP entry.');
    names.add(normalized.toLowerCase());
    cursor += recordLength;
  }
  if (cursor !== boundary) throw new OntologyPackageError('PACKAGE_INVALID', 'ZIP directory size mismatch.');
}
