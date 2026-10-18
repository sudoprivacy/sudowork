import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

interface AssetPublication {
  added: number
  retained: number
}

const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex')
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

async function ensureDirectory(directory: string): Promise<void> {
  try {
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Asset directory must be a real directory: ${directory}`)
    }
  } catch (error) {
    if (!isMissing(error)) throw error
    await mkdir(directory, { recursive: true })
  }
}

/** Publish immutable build assets while retaining every earlier release. */
export async function publishAssets(
  sources: string[],
  destination: string,
): Promise<AssetPublication> {
  const target = resolve(destination)
  if (!isAbsolute(destination) || dirname(target) === target || sources.length === 0) {
    throw new Error('Provide source asset directories and an absolute target directory')
  }
  await ensureDirectory(target)
  const result: AssetPublication = { added: 0, retained: 0 }

  for (const source of sources) {
    const origin = resolve(source)
    if (origin === target || target.startsWith(origin + sep) || origin.startsWith(target + sep)) {
      throw new Error('Source and retained asset directories must be separate')
    }
    const sourceStat = await lstat(origin)
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      throw new Error(`Asset source must be a real directory: ${origin}`)
    }
    async function visit(directory: string): Promise<void> {
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const input = join(directory, entry.name)
        const name = relative(origin, input)
        if (entry.isSymbolicLink()) throw new Error(`Asset links are not supported: ${name}`)
        if (entry.isDirectory()) {
          await visit(input)
          continue
        }
        if (!entry.isFile()) throw new Error(`Unsupported asset entry: ${name}`)
        let parent = target
        for (const component of dirname(name)
          .split(sep)
          .filter((part) => part !== '.')) {
          parent = join(parent, component)
          await ensureDirectory(parent)
        }
        const output = join(target, name)
        const data = await readFile(input)
        const verifyExisting = async (): Promise<void> => {
          const stat = await lstat(output)
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            digest(await readFile(output)) !== digest(data)
          ) {
            throw new Error(`Asset name has conflicting contents: ${name}`)
          }
          result.retained++
        }
        try {
          await lstat(output)
          await verifyExisting()
          continue
        } catch (error) {
          if (!isMissing(error)) throw error
        }
        const temporary = join(parent, `.asset-${randomUUID()}.tmp`)
        await writeFile(temporary, data, { flag: 'wx', mode: 0o644 })
        try {
          // A hard link publishes complete bytes without replacing a concurrent writer.
          await link(temporary, output)
          result.added++
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          await verifyExisting()
        } finally {
          await unlink(temporary)
        }
      }
    }
    await visit(origin)
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [flag, destination, ...sources] = process.argv.slice(2)
  const work =
    flag === '--target' && destination
      ? publishAssets(sources, destination)
      : Promise.reject(
          new Error('Usage: publishAssets.js --target /retained-assets source-assets [...]'),
        )
  void work
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
