const path = require('node:path');
const esbuild = require('esbuild');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const outputFile = path.join(__dirname, '..', 'resources', 'ontology-cli', 'ontology.cjs');

esbuild
  .build({
    entryPoints: [path.join(__dirname, '..', 'resources', 'ontology-cli', 'src', 'index.ts')],
    outfile: outputFile,
    write: false,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    minify: true,
    legalComments: 'none',
    banner: {
      js: 'try { if (Number(process.versions.node.split(".")[0]) < 22 || typeof require("node:sqlite").backup !== "function") throw new Error(); } catch { process.stdout.write(JSON.stringify({protocolVersion:1,requestId:"startup",isSuccess:false,error:{code:"RUNTIME_INCOMPATIBLE",message:"Node.js 22.22.2 or newer with node:sqlite backup support is required.",isRetryable:false}})+"\\n"); process.exit(3); }',
    },
    external: ['cpu-features', '*.node'],
    alias: {
      '@sudowork/ontology-common': path.join(__dirname, '..', '..', '..', 'packages', 'ontology-common', 'src', 'index.ts'),
      '@sudowork/ontology-engine': path.join(__dirname, '..', '..', '..', 'packages', 'ontology-engine', 'src', 'index.ts'),
    },
  })
  .then(async (result) => {
    const contents = Buffer.from(result.outputFiles[0].contents);
    try {
      if ((await fs.readFile(outputFile)).equals(contents)) return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const temporary = outputFile + '.tmp-' + randomUUID();
    try {
      await fs.writeFile(temporary, contents, { flag: 'wx' });
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(temporary, outputFile);
          break;
        } catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 7) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
        }
      }
    } finally {
      await fs.rm(temporary, { force: true });
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
