import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { localKnowledgeBaseService } from './LocalKnowledgeBaseService';
import { getLocalKbDocExtractedPath, getLocalKbRootDir, getLocalKbSpaceDir, LOCAL_KB_SPACE_INDEX_FILE } from './paths';

const DISCOVERY_FILE = 'skill-server.json';
const HOST = '127.0.0.1';
const MAX_QUERY_LENGTH = 500;
const MAX_READ_BYTES = 512 * 1024;

export class LocalKnowledgeBaseSkillServer {
  private server: Server | null = null;
  private port = 0;
  private readonly token = randomBytes(24).toString('hex');

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      void this.handleRequest(req, res).catch((err) => {
        mainWarn('LocalKbSkillServer', 'request failed:', err);
        this.sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      });
    });
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, HOST);
      });
      this.port = (server.address() as { port: number }).port;
      await this.writeDiscoveryFile();
      mainLog('LocalKbSkillServer', `listening on ${HOST}:${this.port}`);
    } catch (err) {
      this.server = null;
      this.port = 0;
      await closeServer(server);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await closeServer(server);
    await fs.rm(this.getDiscoveryPath(), { force: true }).catch((): undefined => undefined);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.isLoopback(req)) {
      this.sendJson(res, 403, { error: 'loopback only' });
      return;
    }
    if (req.headers.authorization !== `Bearer ${this.token}`) {
      this.sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    const url = new URL(req.url ?? '/', `http://${HOST}`);
    if (req.method === 'GET' && url.pathname === '/v1/wiki/list') {
      this.sendJson(res, 200, { spaces: localKnowledgeBaseService.listSpaces().filter((space) => space.buildStatus !== 'failed') });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/wiki/metadata') {
      const spaceId = requireParam(url, 'spaceId');
      const space = localKnowledgeBaseService.getSpace(spaceId);
      const files = await listWikiFiles(spaceId);
      const totalBytes = await sumFileBytes(getLocalKbSpaceDir(spaceId), files);
      this.sendJson(res, 200, { space, fileCount: files.length, totalBytes, files });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/wiki/read') {
      const spaceId = requireParam(url, 'spaceId');
      const space = localKnowledgeBaseService.getSpace(spaceId);
      const docId = url.searchParams.get('docId')?.trim() || '';
      const requestedFile = url.searchParams.get('file')?.trim() || LOCAL_KB_SPACE_INDEX_FILE;
      const file = requestedFile === 'WIKI.md' ? LOCAL_KB_SPACE_INDEX_FILE : requestedFile;
      if (url.searchParams.get('list') === '1') {
        this.sendJson(res, 200, { files: await listReadableFiles(spaceId) });
        return;
      }
      if (docId) {
        if (!isSafeDocId(docId)) {
          this.sendJson(res, 400, { error: 'unsupported document id' });
          return;
        }
        const content = await readParsedDocumentById(spaceId, docId);
        if (content) {
          this.sendJson(res, 200, { docId, content });
          return;
        }
        this.sendJson(res, 404, { error: 'document not found' });
        return;
      }
      if (!isSafeReadFile(file)) {
        this.sendJson(res, 400, { error: 'unsupported wiki file' });
        return;
      }
      const content = await readWikiOrParsedDocument(spaceId, file);
      if (content) {
        this.sendJson(res, 200, { file, content });
        return;
      }
      if (file === LOCAL_KB_SPACE_INDEX_FILE) {
        this.sendJson(res, 200, { file, content: formatParsedDocumentsOverview(spaceId, space.name, space.description) });
        return;
      }
      this.sendJson(res, 404, { error: 'wiki file not found' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/wiki/search') {
      const query = requireParam(url, 'query').slice(0, MAX_QUERY_LENGTH);
      const spaceId = url.searchParams.get('spaceId')?.trim();
      if (spaceId) {
        this.sendJson(res, 200, await localKnowledgeBaseService.search(spaceId, query));
        return;
      }
      this.sendJson(res, 200, await localKnowledgeBaseService.searchMany(listSearchableSpaceIds(), query));
      return;
    }
    this.sendJson(res, 404, { error: 'not found' });
  }

  private isLoopback(req: IncomingMessage): boolean {
    const remote = req.socket.remoteAddress;
    return remote === HOST || remote === '::1' || remote === '::ffff:127.0.0.1';
  }

  private async writeDiscoveryFile(): Promise<void> {
    const filePath = this.getDiscoveryPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ host: HOST, port: this.port, token: this.token, version: 1 }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(filePath, 0o600).catch((): undefined => undefined);
  }

  private getDiscoveryPath(): string {
    return path.join(getLocalKbRootDir(), DISCOVERY_FILE);
  }

  private sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }
}

async function listWikiFiles(spaceId: string): Promise<string[]> {
  const dir = getLocalKbSpaceDir(spaceId);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((): import('fs').Dirent[] => []);
  return entries
    .filter((entry) => entry.isFile() && isAllowedWikiFile(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function listReadableFiles(spaceId: string): Promise<string[]> {
  const wikiFiles = await listWikiFiles(spaceId);
  const parsedFiles = localKnowledgeBaseService
    .listDocuments(spaceId)
    .filter((doc) => doc.parseStatus === 'parsed')
    .map((doc) => doc.fileName)
    .filter(isSafeReadFile);
  return [...new Set([...wikiFiles, ...parsedFiles])].sort();
}

async function readWikiOrParsedDocument(spaceId: string, file: string): Promise<string | null> {
  if (isAllowedWikiFile(file)) {
    const filePath = path.join(getLocalKbSpaceDir(spaceId), file);
    const content = await readSmallTextFile(filePath);
    if (content !== null) return content;
  }

  const doc = localKnowledgeBaseService.listDocuments(spaceId).find((item) => item.parseStatus === 'parsed' && item.fileName === file);
  return doc ? readSmallTextFile(getLocalKbDocExtractedPath(doc.id)) : null;
}

async function readParsedDocumentById(spaceId: string, docId: string): Promise<string | null> {
  const doc = localKnowledgeBaseService.listDocuments(spaceId).find((item) => item.id === docId && item.parseStatus === 'parsed');
  return doc ? readSmallTextFile(getLocalKbDocExtractedPath(doc.id)) : null;
}

async function readSmallTextFile(filePath: string): Promise<string | null> {
  const stat = await fs.stat(filePath).catch((): null => null);
  if (!stat?.isFile()) return null;
  if (stat.size <= MAX_READ_BYTES) return fs.readFile(filePath, 'utf8');

  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES, 0);
    const content = buffer.subarray(0, bytesRead).toString('utf8');
    return `${content}\n\n[Sudowork local KB: content truncated to ${MAX_READ_BYTES} bytes; file size is ${stat.size} bytes. Use search for more targeted lines.]`;
  } finally {
    await handle.close();
  }
}

function formatParsedDocumentsOverview(spaceId: string, name: string, description: string | null): string {
  const docs = localKnowledgeBaseService.listDocuments(spaceId).filter((doc) => doc.parseStatus === 'parsed');
  return ['---', `title: ${name}`, 'type: index', '---', '', `# ${name}`, '', description || '本地知识库已导入并解析文档，尚未构建 Wiki chunk。', '', '## 已解析文档', '', ...docs.map((doc) => `- ${doc.fileName}`), ''].join('\n');
}

async function sumFileBytes(dir: string, files: string[]): Promise<number> {
  const sizes = await Promise.all(
    files.map((file) =>
      fs
        .stat(path.join(dir, file))
        .then((stat) => stat.size)
        .catch(() => 0)
    )
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

function isAllowedWikiFile(file: string): boolean {
  if (!isSafeReadFile(file)) return false;
  return file === LOCAL_KB_SPACE_INDEX_FILE || file === '_sudowork_images.md' || /^chunk-\d+-.+\.md$/i.test(file);
}

function isSafeReadFile(file: string): boolean {
  if (file !== path.basename(file) || file.includes('..')) return false;
  return file.length > 0 && file.length <= 255;
}

function isSafeDocId(docId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(docId);
}

function requireParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function listSearchableSpaceIds(): string[] {
  return localKnowledgeBaseService
    .listSpaces()
    .filter((space) => space.buildStatus !== 'failed')
    .map((space) => space.id);
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export const localKnowledgeBaseSkillServerTest = {
  isSafeDocId,
  listReadableFiles,
  listSearchableSpaceIds,
  readParsedDocumentById,
  readWikiOrParsedDocument,
};

export const localKnowledgeBaseSkillServer = new LocalKnowledgeBaseSkillServer();
