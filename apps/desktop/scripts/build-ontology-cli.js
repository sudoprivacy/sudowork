const path = require('node:path');
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: [path.join(__dirname, '..', 'resources', 'ontology-cli', 'src', 'index.ts')],
    outfile: path.join(__dirname, '..', 'resources', 'ontology-cli', 'ontology.cjs'),
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
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
