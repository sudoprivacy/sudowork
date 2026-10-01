import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HELP = `Usage:
  node scripts/subtitles.mjs transcribe --input <media> --output <new.srt> [--language en] [--model small]
  node scripts/subtitles.mjs burn --input <video> --subtitles <captions.srt> --output <new.mp4>

Paths may be absolute or relative to the current directory. Existing files are never overwritten.
Source language is detected automatically. First use prepares speech dependencies and model files.`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      subtitles: { type: 'string' },
      language: { type: 'string' },
      model: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(HELP);
  } else {
    const [command] = positionals;
    if (positionals.length !== 1 || !['transcribe', 'burn'].includes(command) || !values.input || !values.output) throw new Error(HELP);
    if (command === 'burn' && (!values.subtitles || values.language || values.model)) throw new Error(HELP);
    if (command === 'transcribe' && values.subtitles) throw new Error(HELP);
    const base = process.env.SUDOWORK_AUTH_PROXY_BASE_URL;
    const token = process.env.SUDOWORK_AUTH_PROXY_TOKEN;
    if (process.platform === 'linux' && (process.env.MOSS_SESSION_ID || (!base && !token))) {
      await runCloud();
    } else {
      if (!base || !token) throw new Error('Run this skill from a Sudowork desktop local conversation or a prepared Linux cloud runtime.');
      const url = new URL(base);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('The subtitle service must use the local Sudowork connection.');
      url.pathname = `/subtitles/${command}`;
      url.search = '';
      url.hash = '';
      const body = JSON.stringify({
        inputPath: path.resolve(values.input),
        outputPath: path.resolve(values.output),
        ...(command === 'burn' ? { subtitlePath: path.resolve(values.subtitles) } : { language: values.language, model: values.model }),
      });
      console.error(command === 'transcribe' ? 'Preparing speech recognition and generating subtitles...' : 'Preparing the encoder and rendering the subtitled video...');
      const result = await request(url, token, body);
      console.log(JSON.stringify(result));
    }
  }
} catch (err) {
  console.error(JSON.stringify({ success: false, msg: err.message }));
  process.exitCode = 1;
}

function runCloud() {
  const imagePython = '/opt/sudowork-subtitles/bin/python';
  const python = process.env.SUDOWORK_SUBTITLE_PYTHON || (existsSync(imagePython) ? imagePython : path.join(homedir(), '.cache', 'sudowork', 'subtitles', 'venv', 'bin', 'python'));
  const script = fileURLToPath(new URL('./cloud_media.py', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, ...process.argv.slice(2)], { stdio: 'inherit', timeout: 45 * 60 * 1000 });
    child.on('error', () => reject(new Error("Cloud subtitle runtime is not prepared. See the skill's Cloud runtime setup section.")));
    child.on('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`Cloud subtitle operation failed (${signal || code}).`))));
  });
}

function request(url, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          req.destroy(new Error('Unexpectedly large subtitle response.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200 || result.success !== true || !result.data?.outputPath) throw new Error(result.msg || 'Subtitle operation failed.');
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.setTimeout(60 * 60 * 1000, () => req.destroy(new Error('Subtitle operation timed out.')));
    req.on('error', reject);
    req.end(body);
  });
}
