#!/usr/bin/env node
// Adapted from CNERD's resumable cnerd-blog.mjs importer. Draft ownership and
// expectedRevision stay server-enforced; this client never publishes.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync, chmodSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const json = path => JSON.parse(readFileSync(resolve(path), 'utf8'));
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
function protectedJson(path) {
  const location = resolve(path);
  if (process.platform !== 'win32' && (statSync(location).mode & 0o077)) throw new Error('Protect the registry/credentials file with mode 0600.');
  return json(location);
}
export function connection(env = process.env, brand) {
  let config;
  if (env.BLOG_ENGINE_REGISTRY) {
    const registry = protectedJson(env.BLOG_ENGINE_REGISTRY);
    if (!brand) throw new Error('Choose a configured brand with --brand BRAND_ID.');
    config = registry[brand];
    if (!config) throw new Error('Brand is not configured in the local registry.');
    if (!config.tokenEnv || !/^[A-Z_][A-Z0-9_]*$/.test(config.tokenEnv)) throw new Error('Set the registry tokenEnv to the name of a protected environment variable.');
    config = { ...config, token: env[config.tokenEnv], brandId: brand, legacy: false };
  } else {
    // Preserve existing CNERD single-site invocation when no engine registry exists.
    const legacy = existsSync('private/cnerd-blog-credentials.json') ? protectedJson('private/cnerd-blog-credentials.json') : {};
    const mounted = Boolean(env.BLOG_ENGINE_URL);
    if (brand && !mounted && !['cnerd', 'cnerd-ai'].includes(brand)) throw new Error('Configure BLOG_ENGINE_REGISTRY for this brand.');
    config = { url: env.BLOG_ENGINE_URL || env.CNERD_BLOG_URL || legacy.url, token: env.BLOG_ENGINE_TOKEN || env.CNERD_BLOG_TOKEN || legacy.token, brandId: mounted ? (brand || env.BLOG_ENGINE_BRAND || 'cnerd') : 'cnerd', legacy: !mounted };
  }
  if (!config.url || !config.token) throw new Error('Configure the server URL and scoped integration token.');
  const url = new URL(config.url);
  if (url.username || url.password || url.search || url.hash) throw new Error('The registry URL cannot contain credentials, query or fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS or local development.');
  return { ...config, url: url.href.replace(/\/$/, '') };
}
export function checkArticle(article) {
  if (!article || article.schemaVersion !== 2 || article.bodyDoc?.type !== 'doc') throw new Error('Use schemaVersion 2 and a canonical bodyDoc.');
  if ('training' in article || 'trainingDoc' in article) throw new Error('Private training is excluded from integration payloads.');
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'html' || value.type === 'rawHtml' || 'html' in value) throw new Error('Arbitrary HTML is excluded from integration payloads.');
    Object.values(value).forEach(walk);
  };
  walk(article);
}
export function createClient(config, fetchImpl = fetch) {
  const prefix = config.legacy ? '/api/blog-import/' : '/api/integration/';
  return async (path, method = 'GET', body, headers = {}) => {
    const response = await fetchImpl(config.url + prefix + path, {
      method,
      headers: { Authorization: 'Bearer ' + config.token, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error(`${response.status}: Server returned an invalid response.`); }
    if (!response.ok) throw Object.assign(new Error(`${response.status}: ${result.error || 'Request failed.'}${response.status === 409 ? ' Read the current draft and reconcile edits before retrying.' : ''}`), { status: response.status });
    return result;
  };
}
async function discover(api, config) {
  if (config.legacy) return;
  const capabilities = await api('capabilities');
  const actual = capabilities.brand?.id || capabilities.brandId;
  if (actual !== config.brandId) throw new Error('Configured brand does not match the server identity.');
  if (capabilities.schemaVersion !== 2 && !capabilities.schemaVersions?.includes(2)) throw new Error('Server does not advertise schemaVersion 2.');
  return capabilities;
}
async function validate(api, config, data, articleId) {
  if (config.legacy) return;
  const result = await api('validate', 'POST', { data, ...(articleId ? { articleId } : {}) });
  if (result.valid === false || result.errors?.length) throw new Error('Draft validation failed: ' + JSON.stringify(result.errors));
  return result;
}
function authoredContentMatches(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((item, index) => authoredContentMatches(item, actual[index]));
  if (expected && typeof expected === 'object') return actual && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => authoredContentMatches(value, actual[key]));
  return expected === actual;
}
function verifyPreparedDraft(prepared, receipt) {
  const sameMetadata = ['title', 'summary', 'slug', 'author', 'heroImage', 'heroAlt', 'socialImage', 'socialImageAlt', 'seoTitle', 'seoDescription']
    .every(key => prepared[key] === undefined || String(prepared[key]).trim() === String(receipt.data?.[key] ?? ''));
  if (!sameMetadata || !authoredContentMatches(prepared.bodyDoc, receipt.data?.bodyDoc)) throw new Error('The saved draft differs from the prepared content. Reconcile current owner edits before continuing.');
}
function sameReadback(updated, verified) {
  if (verified.id !== updated.id || verified.revision !== updated.revision || JSON.stringify(verified.data) !== JSON.stringify(updated.data)) throw new Error('Draft changed during readback. Review the editor before continuing.');
}
export async function importDraft({ api, config, article, manifest, statePath, social = false, narrationVoice }) {
  checkArticle(article);
  await discover(api, config);
  if (!/^[-a-zA-Z0-9_:]{8,100}$/.test(manifest.importId || '')) throw new Error('Set a stable manifest importId (8–100 characters).');
  const keys = new Set();
  const assets = (manifest.assets || []).map(asset => {
    if (!asset.key || keys.has(asset.key)) throw new Error('Asset keys must be unique.');
    keys.add(asset.key);
    if (!['image', 'video', 'download'].includes(asset.kind)) throw new Error('Unsupported asset kind.');
    const file = resolve(asset.file);
    return { ...asset, file, hash: digest(readFileSync(file)) };
  });
  const preparedHash = digest({ article, manifest, files: assets.map(asset => ({ key: asset.key, hash: asset.hash })) });
  const identity = { url: config.url, brandId: config.brandId };
  let state = existsSync(statePath) ? json(statePath) : { preparedHash, identity, assets: {} };
  if (state.preparedHash !== preparedHash) throw new Error('Prepared content or image bytes changed. Reconcile with the existing draft before starting another import.');
  if (JSON.stringify(state.identity) !== JSON.stringify(identity)) throw new Error('Import state belongs to another server or brand.');
  const save = () => {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 });
    chmodSync(statePath + '.tmp', 0o600);
    renameSync(statePath + '.tmp', statePath);
  };
  if (!state.draftComplete) {
    if (!state.id) {
      const stub = { ...article, heroImage: '', bodyDoc: { type: 'doc', content: [{ type: 'paragraph' }] } };
      const created = await api('drafts', 'POST', { data: stub, idempotencyKey: 'create:' + manifest.importId });
      state.id = created.id; state.revision = created.revision; save();
    }
    for (const asset of assets) {
      if (state.assets[asset.key]) continue;
      const uploaded = await api('drafts/' + state.id + '/assets?kind=' + encodeURIComponent(asset.kind), 'POST', readFileSync(asset.file), { 'Content-Type': 'application/octet-stream', 'X-Blog-Asset-Name': encodeURIComponent(basename(asset.file)) });
      state.assets[asset.key] = uploaded.path; save();
    }
    const replace = value => Array.isArray(value) ? value.map(replace) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)])) : typeof value === 'string' && value.startsWith('asset://') ? state.assets[value.slice(8)] || (() => { throw new Error('Missing uploaded asset: ' + value); })() : value;
    const draft = replace(article);
    await validate(api, config, draft, state.id);
    const updated = await api('drafts/' + state.id, 'PUT', { data: draft, expectedRevision: state.revision, idempotencyKey: 'finish:' + manifest.importId });
    verifyPreparedDraft(draft, updated);
    const verified = await api('drafts/' + state.id);
    sameReadback(updated, verified);
    state.revision = updated.revision; state.draftComplete = true; save();
  }
  const verified = await api('drafts/' + state.id);
  if ((social && !state.social) || (narrationVoice && !state.narration)) {
    if (verified.revision !== state.revision) throw new Error('Article was edited after import. Review those edits before generating derivatives.');
    if (social && !state.social) {
      state.social = await api('drafts/' + state.id + '/social', 'POST', { expectedRevision: state.revision, idempotencyKey: 'social:' + manifest.importId }); save();
    }
    if (narrationVoice && !state.narration) {
      const status = await api('drafts/' + state.id + '/status');
      state.narration = await api('drafts/' + state.id + '/narration', 'POST', { expectedRevision: state.revision, voiceId: narrationVoice, ...((status.audio?.draftSourceFingerprint || status.audio?.sourceFingerprint) ? { sourceFingerprint: status.audio.draftSourceFingerprint || status.audio.sourceFingerprint } : {}), idempotencyKey: 'narration:' + manifest.importId }); save();
    }
  }
  return { id: verified.id, revision: verified.revision, editorUrl: verified.editorUrl, state: verified.state, ...(state.social ? { social: state.social } : {}), ...(state.narration ? { audio: state.narration } : {}) };
}
function revision(value) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new Error('Provide a nonnegative expected revision.'); return number; }
export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv];
  const option = name => { const at = args.indexOf(name); if (at < 0) return; const value = args[at + 1]; if (!value || value.startsWith('--')) throw new Error('Missing value for ' + name); args.splice(at, 2); return value; };
  const brand = option('--brand');
  const narrationVoice = option('--narration');
  const socialAt = args.indexOf('--social'), social = socialAt >= 0;
  if (social) args.splice(socialAt, 1);
  if (args[0] === 'help' || args[0] === '--help' || !args.length) return { usage: 'blog-client.mjs --brand BRAND capabilities | validate ARTICLE | import ARTICLE MANIFEST STATE [--social] [--narration VOICE] | read ID | update ARTICLE ID REVISION | social ID REVISION [CAPTIONS_JSON] | status ID | narration ID REVISION VOICE' };
  const config = connection(env, brand), api = createClient(config);
  const command = args[0];
  if (command === 'import') {
    if (!args[1] || !args[2] || !args[3]) throw new Error('Import requires ARTICLE MANIFEST STATE.');
    return importDraft({ api, config, article: json(args[1]), manifest: json(args[2]), statePath: resolve(args[3]), social, narrationVoice });
  }
  const capabilities = await discover(api, config);
  if (command === 'capabilities') return capabilities || { legacy: true, schemaVersion: 2 };
  if (command === 'validate') { const article = json(args[1]); checkArticle(article); return validate(api, config, article); }
  if (command === 'read') return api('drafts/' + args[1]);
  if (command === 'status') return api('drafts/' + args[1] + '/status');
  if (command === 'update') {
    const article = json(args[1]); checkArticle(article); const expectedRevision = revision(args[3]);
    await validate(api, config, article, args[2]);
    const updated = await api('drafts/' + args[2], 'PUT', { data: article, expectedRevision, idempotencyKey: 'update:' + digest({ article, expectedRevision }) });
    verifyPreparedDraft(article, updated);
    const verified = await api('drafts/' + updated.id); sameReadback(updated, verified); return verified;
  }
  if (command === 'social') return api('drafts/' + args[1] + '/social', 'POST', { expectedRevision: revision(args[2]), idempotencyKey: 'social:' + digest(args), ...(args[3] ? { captions: json(args[3]) } : {}) });
  if (command === 'narration') return api('drafts/' + args[1] + '/narration', 'POST', { expectedRevision: revision(args[2]), voiceId: args[3], idempotencyKey: 'narration:' + digest(args) });
  throw new Error('Unknown command. Run help for the supported draft-only workflow.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error('Blog workflow stopped: ' + error.message); process.exitCode = 1; });
}
