const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://shareone.app';
const CREDENTIALS_FILENAME = '.shareone_credentials';
const SUDOWORK_SECRET_NAMESPACE = 'service:shareone';
const SUDOWORK_SECRET_KEY = 'X-API-Key';
const CREDENTIAL_MODE_DIRECT = 'direct';
const CREDENTIAL_MODE_SUDOWORK_PROXY = 'sudowork_proxy';
const CREDENTIAL_MODE_DIRECT_FALLBACK = 'direct_fallback';

let credentialModePromise = null;

function isSudowork() {
    return Boolean(process.env.SUDOWORK_AUTH_PROXY_URL && process.env.SUDOWORK_AUTH_PROXY_TOKEN);
}

function getSudoworkBaseUrl() {
    return process.env.SUDOWORK_AUTH_PROXY_BASE_URL || String(process.env.SUDOWORK_AUTH_PROXY_URL || '').replace(/\/proxy\/?$/, '');
}

function getBaseUrl() {
    return process.env.SHAREONE_BASE_URL || DEFAULT_BASE_URL;
}

function getSkillCredentialsPath() {
    return path.join(path.resolve(__dirname, '..'), CREDENTIALS_FILENAME);
}

function getCredentialPathCandidates() {
    return [getSkillCredentialsPath()];
}

function canWriteCredentialsPath(credentialsPath) {
    try {
        if (fs.existsSync(credentialsPath)) {
            fs.accessSync(credentialsPath, fs.constants.W_OK);
            return true;
        }

        const raw = String(credentialsPath);
        const lastSlash = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
        const parent = lastSlash > 0 ? raw.slice(0, lastSlash) : path.dirname(raw);
        fs.accessSync(parent, fs.constants.W_OK);
        return true;
    } catch (_) {
        return false;
    }
}

function getCredentialsPath() {
    return getSkillCredentialsPath();
}

function readLocalApiKey() {
    for (const credentialsPath of getCredentialPathCandidates()) {
        if (!fs.existsSync(credentialsPath)) continue;
        try {
            const data = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            if (data && data.api_key) return data.api_key;
        } catch (_) {
            // Try the next candidate.
        }
    }
    return null;
}

function resolveDirectApiKey(explicitApiKey) {
    return explicitApiKey || process.env.SHAREONE_API_KEY || readLocalApiKey();
}

function saveLocalApiKey(apiKey) {
    const candidates = getCredentialPathCandidates();
    const credentialsPath = candidates.find(canWriteCredentialsPath) || candidates[candidates.length - 1] || getCredentialsPath();
    fs.writeFileSync(credentialsPath, JSON.stringify({ api_key: apiKey }), { mode: 0o600 });
    try {
        fs.chmodSync(credentialsPath, 0o600);
    } catch (_) {
        // Best-effort on filesystems that do not support POSIX permissions.
    }
    return credentialsPath;
}

function deleteLocalApiKey() {
    let deleted = false;
    for (const credentialsPath of getCredentialPathCandidates()) {
        try {
            if (!fs.existsSync(credentialsPath)) continue;
            fs.unlinkSync(credentialsPath);
            deleted = true;
        } catch (_) {
            // Try deleting the next candidate.
        }
    }
    return deleted;
}

function appendPath(baseUrl, apiPath) {
    const trimmedBase = String(baseUrl).replace(/\/+$/, '');
    const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    return `${trimmedBase}${normalizedPath}`;
}

const MAX_REDIRECTS = 5;

// Header names that carry credentials; stripped when a redirect crosses hosts
// so we never hand the API key to a different origin.
const AUTH_HEADER_NAMES = ['x-api-key', 'authorization'];

function stripAuthHeaders(headers) {
    const next = {};
    for (const key of Object.keys(headers || {})) {
        if (!AUTH_HEADER_NAMES.includes(key.toLowerCase())) next[key] = headers[key];
    }
    return next;
}

function requestBuffer(url, options = {}, body = null, redirectsLeft = MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const client = target.protocol === 'https:' ? https : http;
        const req = client.request(target, {
            method: options.method || 'GET',
            headers: options.headers || {},
        }, (res) => {
            // Follow redirects — Node's http client does not auto-follow, so a
            // bare `curl` would succeed where this used to surface the 3xx as an
            // error (e.g. an infra http->https / trailing-slash 301 on a DELETE).
            // Preserve the method and body (API redirects are transport-level,
            // not a POST->GET downgrade); drop the API key on a cross-host hop.
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
                res.resume(); // drain so the socket can be reused
                let nextUrl;
                try {
                    nextUrl = new URL(res.headers.location, target);
                } catch (_) {
                    nextUrl = null;
                }
                if (nextUrl) {
                    const sameHost = nextUrl.host === target.host;
                    const headers = sameHost ? (options.headers || {}) : stripAuthHeaders(options.headers || {});
                    resolve(requestBuffer(nextUrl.toString(), { ...options, headers }, body, redirectsLeft - 1));
                    return;
                }
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () => {
                const data = Buffer.concat(chunks);
                const text = data.toString('utf8');
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ statusCode: res.statusCode, headers: res.headers, data, text });
                    return;
                }
                const error = new Error(`HTTP ${res.statusCode}: ${text}`);
                error.statusCode = res.statusCode;
                error.responseText = text;
                reject(error);
            });
        });

        req.on('error', reject);
        if (options.timeoutMs) {
            req.setTimeout(options.timeoutMs, () => {
                req.destroy(new Error('Request timed out'));
            });
        }
        if (body) req.write(body);
        req.end();
    });
}

function buildJsonRequestBody(payload) {
    const body = payload === null ? null : JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    if (body !== null) headers['Content-Length'] = Buffer.byteLength(body);
    return { body, headers };
}

async function requestJsonUrl(url, options = {}, payload = null) {
    const { body, headers } = buildJsonRequestBody(payload);
    const res = await requestBuffer(url, {
        ...options,
        headers: {
            ...headers,
            ...(options.headers || {}),
        },
    }, body);
    return JSON.parse(res.text);
}

async function requestPublicShareOneJson(apiPath, options = {}, payload = null) {
    return requestJsonUrl(appendPath(getBaseUrl(), apiPath), options, payload);
}

function buildSudoworkSecretsUrl(pathSuffix = '') {
    const baseUrl = getSudoworkBaseUrl();
    if (!baseUrl) {
        throw new Error('SUDOWORK_AUTH_PROXY_BASE_URL is not available');
    }
    return appendPath(baseUrl, `/secrets${pathSuffix}`);
}

async function requestSudoworkSecrets(pathSuffix = '', options = {}, payload = null) {
    if (!isSudowork()) {
        throw new Error('Sudowork environment is not available');
    }
    const { body, headers } = buildJsonRequestBody(payload);
    const res = await requestBuffer(buildSudoworkSecretsUrl(pathSuffix), {
        ...options,
        headers: {
            ...headers,
            ...(options.headers || {}),
            Authorization: `Bearer ${process.env.SUDOWORK_AUTH_PROXY_TOKEN}`,
        },
    }, body);
    return JSON.parse(res.text);
}

async function listSudoworkSecrets(namespace = SUDOWORK_SECRET_NAMESPACE) {
    const query = `?namespace=${encodeURIComponent(namespace)}`;
    const result = await requestSudoworkSecrets(query, { method: 'GET' }, null);
    return Array.isArray(result.data) ? result.data : [];
}

function hasShareOneSecret(secrets) {
    return secrets.some(secret => secret && secret.namespace === SUDOWORK_SECRET_NAMESPACE && secret.key === SUDOWORK_SECRET_KEY);
}

async function hasSudoworkApiKey() {
    const mode = await detectCredentialMode();
    return mode.mode === CREDENTIAL_MODE_SUDOWORK_PROXY && mode.hasSudoworkKey;
}

async function detectCredentialMode({ refresh = false } = {}) {
    if (!refresh && credentialModePromise) return credentialModePromise;

    credentialModePromise = (async () => {
        if (!isSudowork()) {
            return {
                mode: CREDENTIAL_MODE_DIRECT,
                isSudowork: false,
                sudoworkAvailable: false,
                hasSudoworkKey: false,
                secrets: [],
                error: null,
            };
        }

        try {
            const secrets = await listSudoworkSecrets(SUDOWORK_SECRET_NAMESPACE);
            return {
                mode: CREDENTIAL_MODE_SUDOWORK_PROXY,
                isSudowork: true,
                sudoworkAvailable: true,
                hasSudoworkKey: hasShareOneSecret(secrets),
                secrets,
                error: null,
            };
        } catch (error) {
            return {
                mode: CREDENTIAL_MODE_DIRECT_FALLBACK,
                isSudowork: true,
                sudoworkAvailable: false,
                hasSudoworkKey: false,
                secrets: [],
                error,
            };
        }
    })();

    return credentialModePromise;
}

function resetCredentialModeCache() {
    credentialModePromise = null;
}

async function saveSudoworkApiKey(apiKey) {
    const pathSuffix = `/${encodeURIComponent(SUDOWORK_SECRET_NAMESPACE)}/${encodeURIComponent(SUDOWORK_SECRET_KEY)}`;
    return requestSudoworkSecrets(pathSuffix, { method: 'PUT' }, {
        value: apiKey,
        description: 'ShareOne API Key',
    });
}

async function deleteSudoworkApiKey() {
    const pathSuffix = `/${encodeURIComponent(SUDOWORK_SECRET_NAMESPACE)}/${encodeURIComponent(SUDOWORK_SECRET_KEY)}`;
    return requestSudoworkSecrets(pathSuffix, { method: 'DELETE' }, null);
}

async function buildShareOneRequest(apiPath, options = {}) {
    const targetUrl = appendPath(getBaseUrl(), apiPath);
    const headers = { ...(options.headers || {}) };
    const credentialMode = await detectCredentialMode();

    if (credentialMode.mode === CREDENTIAL_MODE_SUDOWORK_PROXY && options.authRequired !== false) {
        delete headers['X-API-Key'];
        delete headers['x-api-key'];
        return {
            url: process.env.SUDOWORK_AUTH_PROXY_URL,
            options: {
                ...options,
                headers: {
                    ...headers,
                    Authorization: `Bearer ${process.env.SUDOWORK_AUTH_PROXY_TOKEN}`,
                    'X-Secret-Namespace': 'service:shareone',
                    'X-Remote-URL': targetUrl,
                    'X-Auth-Scheme': 'header',
                    'X-Auth-Header': 'X-API-Key',
                    'X-Secret-Key': 'X-API-Key'
                },
            },
        };
    }

    if (options.authRequired !== false) {
        const apiKey = resolveDirectApiKey(options.apiKey);
        if (apiKey) headers['X-API-Key'] = apiKey;
    }

    return {
        url: targetUrl,
        options: {
            ...options,
            headers,
        },
    };
}

async function requestShareOneBuffer(apiPath, options = {}, body = null) {
    const built = await buildShareOneRequest(apiPath, options);
    return requestBuffer(built.url, built.options, body);
}

async function requestShareOneJson(apiPath, options = {}, payload = null) {
    const { body, headers } = buildJsonRequestBody(payload);

    const res = await requestShareOneBuffer(apiPath, {
        ...options,
        headers: {
            ...headers,
            ...(options.headers || {}),
        },
    }, body);
    return JSON.parse(res.text);
}

function getErrorDetail(error) {
    const text = String(error && error.responseText ? error.responseText : '');
    if (!text) return '';
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') {
            return text;
        }
        const detail = parsed.detail;
        if (detail && typeof detail === 'object') {
            return String(detail.message || detail.code || parsed.message || text);
        }
        return String(detail || parsed.message || text);
    } catch (_) {
        return text;
    }
}

function isSudoworkMissingKeyError(error) {
    if (!error) return false;
    const detail = getErrorDetail(error);

    if (error.statusCode === 502) {
        return /secret|key|credential|not found|missing|未配置|不存在|缺少/i.test(detail || error.message || '');
    }

    if (error.statusCode !== 401) return false;
    return /Missing API Key/i.test(detail);
}

function isAuthFailedError(error) {
    if (!error) return false;
    if (error.statusCode === 401 || error.statusCode === 403) return true;
    const detail = getErrorDetail(error);
    return /Invalid API Key|Inactive user|unauthorized|forbidden|权限不足|无效/i.test(detail || error.message || '');
}

function printShareOneScriptError(error) {
    if (isSudowork() && isSudoworkMissingKeyError(error)) {
        console.error("ERROR:SUDOWORK_ENV_OK_KEY_NOT_FOUND");
        console.error("请先运行 check_api_key.js，并按提示通过 save_api_key.js 或 create_guest_key.js 设置 ShareOne API Key。");
        return;
    }

    if (isAuthFailedError(error)) {
        console.error("ERROR:AUTH_FAILED");
        console.error("API Key 无效或权限不足。");
        return;
    }

    console.error(`ERROR:${error.message}`);
}

module.exports = {
    CREDENTIAL_MODE_DIRECT,
    CREDENTIAL_MODE_DIRECT_FALLBACK,
    CREDENTIAL_MODE_SUDOWORK_PROXY,
    DEFAULT_BASE_URL,
    SUDOWORK_SECRET_KEY,
    SUDOWORK_SECRET_NAMESPACE,
    appendPath,
    deleteLocalApiKey,
    deleteSudoworkApiKey,
    detectCredentialMode,
    getBaseUrl,
    getCredentialPathCandidates,
    getCredentialsPath,
    getSkillCredentialsPath,
    hasSudoworkApiKey,
    isSudowork,
    isAuthFailedError,
    isSudoworkMissingKeyError,
    listSudoworkSecrets,
    printShareOneScriptError,
    readLocalApiKey,
    requestBuffer,
    requestPublicShareOneJson,
    requestShareOneBuffer,
    requestShareOneJson,
    resetCredentialModeCache,
    resolveDirectApiKey,
    saveLocalApiKey,
    saveSudoworkApiKey,
};
