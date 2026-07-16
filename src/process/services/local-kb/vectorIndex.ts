import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getLocalKbModelsDir, LOCAL_KB_SPACE_INDEX_FILE, LOCAL_KB_VECTOR_BIN_FILE, LOCAL_KB_VECTOR_JSONL_FILE } from './paths';
import { extractTitle } from './query';

export interface ILocalKbPassage {
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  text: string;
}

interface IEmbedder {
  dim: number;
  modelId: string;
  passage(texts: string[]): Promise<Float32Array[]>;
  query(text: string): Promise<Float32Array>;
}

const DEFAULT_MODEL_ID = 'Xenova/multilingual-e5-small';

export async function buildLocalKbVectorIndex(spaceDir: string, modelId = DEFAULT_MODEL_ID): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  const embedder = await ensureOptionalEmbedder(modelId);
  if (!embedder) return { ok: false, reason: 'embedder-unavailable' };

  const passages = await collectPassages(spaceDir);
  if (passages.length === 0) return { ok: false, reason: 'no-passages' };

  const vectors = await embedder.passage(passages.map((passage) => passage.text)).catch((): null => null);
  if (!vectors || vectors.length !== passages.length) return { ok: false, reason: 'embed-failed' };

  const flat = new Float32Array(passages.length * embedder.dim);
  for (let i = 0; i < passages.length; i += 1) {
    const vector = vectors[i]!;
    if (vector.length !== embedder.dim) return { ok: false, reason: 'dim-mismatch' };
    flat.set(vector, i * embedder.dim);
  }

  await fs.writeFile(path.join(spaceDir, LOCAL_KB_VECTOR_BIN_FILE), Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength));
  const manifest = {
    version: 1,
    model: embedder.modelId,
    dim: embedder.dim,
    count: passages.length,
    builtAt: Date.now(),
  };
  await fs.writeFile(path.join(spaceDir, LOCAL_KB_VECTOR_JSONL_FILE), [JSON.stringify(manifest), ...passages.map((passage) => JSON.stringify(passage))].join('\n') + '\n', 'utf8');
  return { ok: true, count: passages.length };
}

export async function appendLocalKbVectorIndex(spaceDir: string, files: string[], modelId = DEFAULT_MODEL_ID): Promise<{ ok: true; count: number; appended: number } | { ok: false; reason: string }> {
  const existing = await loadVectorIndex(spaceDir);
  if (!existing) {
    const result = await buildLocalKbVectorIndex(spaceDir, modelId);
    return 'count' in result ? { ok: true, count: result.count, appended: result.count } : { ok: false, reason: result.reason };
  }

  const embedder = await ensureOptionalEmbedder(modelId);
  if (!embedder) return { ok: false, reason: 'embedder-unavailable' };
  if (embedder.dim !== existing.dim) return { ok: false, reason: 'dim-mismatch' };

  const passages = await collectPassages(spaceDir, new Set(files));
  if (passages.length === 0) return { ok: true, count: existing.passages.length, appended: 0 };

  const vectors = await embedder.passage(passages.map((passage) => passage.text)).catch((): null => null);
  if (!vectors || vectors.length !== passages.length) return { ok: false, reason: 'embed-failed' };

  const allPassages = [...existing.passages, ...passages];
  const flat = new Float32Array(allPassages.length * embedder.dim);
  flat.set(existing.vectors, 0);
  for (let i = 0; i < vectors.length; i += 1) {
    const vector = vectors[i]!;
    if (vector.length !== embedder.dim) return { ok: false, reason: 'dim-mismatch' };
    flat.set(vector, (existing.passages.length + i) * embedder.dim);
  }

  await fs.writeFile(path.join(spaceDir, LOCAL_KB_VECTOR_BIN_FILE), Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength));
  const manifest = {
    version: 1,
    model: embedder.modelId,
    dim: embedder.dim,
    count: allPassages.length,
    builtAt: Date.now(),
  };
  await fs.writeFile(path.join(spaceDir, LOCAL_KB_VECTOR_JSONL_FILE), [JSON.stringify(manifest), ...allPassages.map((passage) => JSON.stringify(passage))].join('\n') + '\n', 'utf8');
  return { ok: true, count: allPassages.length, appended: passages.length };
}

async function collectPassages(spaceDir: string, onlyFiles?: Set<string>): Promise<ILocalKbPassage[]> {
  const entries = await fs.readdir(spaceDir, { withFileTypes: true }).catch((): fsSync.Dirent[] => []);
  const files = entries
    .filter((entry) => entry.isFile() && (entry.name === LOCAL_KB_SPACE_INDEX_FILE || /^chunk-\d+-.+\.md$/i.test(entry.name)))
    .map((entry) => entry.name)
    .filter((file) => !onlyFiles || onlyFiles.has(file))
    .sort();
  const passages: ILocalKbPassage[] = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(spaceDir, file), 'utf8').catch((): string => '');
    if (!content.trim()) continue;
    passages.push(...splitMarkdown(content, file));
  }
  return passages.slice(0, 20_000);
}

function splitMarkdown(markdown: string, file: string): ILocalKbPassage[] {
  const lines = markdown.split(/\r?\n/);
  const title = extractTitle(markdown, file);
  const passages: ILocalKbPassage[] = [];
  let buffer: string[] = [];
  let startLine = 1;
  const flush = (endLine: number) => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) {
      passages.push({ file, startLine, endLine, title, text });
    }
    buffer = [];
    startLine = endLine + 1;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^#{1,3}\s+/.test(line) && buffer.join('\n').length > 800) {
      flush(i);
    }
    buffer.push(line);
    if (buffer.join('\n').length > 1800) {
      flush(i + 1);
    }
  }
  flush(lines.length);
  return passages;
}

async function ensureOptionalEmbedder(modelId: string): Promise<IEmbedder | null> {
  const cacheDir = getLocalKbModelsDir();
  const modelDir = path.join(cacheDir, modelId);
  const onnx = path.join(modelDir, 'onnx', 'model_quantized.onnx');
  if (!fsSync.existsSync(onnx)) return null;

  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const mod = await dynamicImport('@xenova/transformers');
    const env = mod.env as Record<string, any>;
    env.cacheDir = cacheDir;
    env.localModelPath = cacheDir;
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    const pipeline = await mod.pipeline('feature-extraction', modelId, { quantized: true });
    const probe = await pipeline('query: probe', { pooling: 'mean', normalize: true });
    const dim = Number(probe.dims?.[probe.dims.length - 1] ?? 0);
    if (!dim) return null;
    const passage = async (texts: string[]): Promise<Float32Array[]> => {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += 32) {
        const batch = texts.slice(i, i + 32).map((text) => `passage: ${text}`);
        const tensor = await pipeline(batch, { pooling: 'mean', normalize: true });
        const data = tensor.data as Float32Array;
        for (let b = 0; b < batch.length; b += 1) {
          out.push(new Float32Array(data.subarray(b * dim, (b + 1) * dim)));
        }
      }
      return out;
    };
    const query = async (text: string): Promise<Float32Array> => {
      const tensor = await pipeline([`query: ${text}`], { pooling: 'mean', normalize: true });
      return new Float32Array((tensor.data as Float32Array).subarray(0, dim));
    };
    return { dim, modelId, passage, query };
  } catch {
    return null;
  }
}

export async function searchLocalKbVector(spaceDir: string, query: string, topK = 50, modelId = DEFAULT_MODEL_ID): Promise<Array<ILocalKbPassage & { score: number }>> {
  const index = await loadVectorIndex(spaceDir);
  if (!index) return [];
  const embedder = await ensureOptionalEmbedder(modelId);
  if (!embedder || embedder.dim !== index.dim) return [];
  const qVec = await embedder.query(query).catch((): null => null);
  if (!qVec) return [];

  const hits: Array<ILocalKbPassage & { score: number }> = [];
  for (let row = 0; row < index.passages.length; row += 1) {
    let score = 0;
    const offset = row * index.dim;
    for (let d = 0; d < index.dim; d += 1) {
      score += (index.vectors[offset + d] ?? 0) * (qVec[d] ?? 0);
    }
    hits.push({ ...index.passages[row]!, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}

async function loadVectorIndex(spaceDir: string): Promise<{ dim: number; vectors: Float32Array; passages: ILocalKbPassage[] } | null> {
  try {
    const jsonl = await fs.readFile(path.join(spaceDir, LOCAL_KB_VECTOR_JSONL_FILE), 'utf8');
    const lines = jsonl.split('\n').filter(Boolean);
    const manifest = JSON.parse(lines[0] ?? '{}') as { dim?: number; count?: number };
    if (!manifest.dim || !manifest.count) return null;
    const passages = lines.slice(1).map((line) => JSON.parse(line) as ILocalKbPassage);
    if (passages.length !== manifest.count) return null;
    const bin = await fs.readFile(path.join(spaceDir, LOCAL_KB_VECTOR_BIN_FILE));
    if (bin.byteLength !== manifest.dim * manifest.count * 4) return null;
    return {
      dim: manifest.dim,
      vectors: new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4),
      passages,
    };
  } catch {
    return null;
  }
}
