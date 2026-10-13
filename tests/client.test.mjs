import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { connection, createClient, checkArticle, importDraft } from '../scripts/blog-client.mjs';

const article = { schemaVersion: 2, slug: 'supplied-image', title: 'Supplied image', summary: 'Inspect the real image before using it.', author: 'Example owner', topics: [], heroImage: 'asset://hero', heroAlt: 'A checked image description', bodyDoc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Useful editable content.' }] }] } };
async function fixture(t, { wrongBrand = false, conflict = false, interrupt = false, loseReceipt = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'engine-client-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const image = join(root, 'actual.png'); writeFileSync(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const manifest = { importId: 'test-resumable-import', assets: [{ key: 'hero', file: image, kind: 'image' }] };
  const counters = { create: 0, update: 0, upload: 0, social: 0, narration: 0, validations: 0 };
  let stored, stopped = false;
  const requests = new Map();
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-token');
    let bytes = Buffer.alloc(0); for await (const part of req) bytes = Buffer.concat([bytes, part]);
    const body = req.headers['content-type'] === 'application/json' ? JSON.parse(bytes.toString()) : bytes;
    const route = new URL(req.url, 'http://localhost').pathname;
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (route === '/journal/api/integration/capabilities') return send({ brand: { id: wrongBrand ? 'other-brand' : 'landworkspro' }, schemaVersion: 2 });
    if (route === '/journal/api/integration/validate') {
      counters.validations++; assert.equal(body.articleId, 'draft-uuid'); assert.match(body.data.heroImage, /^\/journal\/media\//); return send({ valid: true, errors: [], warnings: [] });
    }
    if (route === '/journal/api/integration/drafts' && req.method === 'POST') {
      counters.create++; assert.equal(body.data.heroImage, '');
      stored = { id: 'draft-uuid', revision: 1, data: body.data, state: 'draft', editorUrl: 'http://localhost/journal/admin/?article=draft-uuid' }; return send(stored, 201);
    }
    if (route.endsWith('/assets') && req.method === 'POST') { counters.upload++; assert.deepEqual(bytes, readFileSync(image)); return send({ path: '/journal/media/uploaded' }, 201); }
    if (route.endsWith('/draft-uuid') && req.method === 'PUT') {
      counters.update++;
      if (conflict) return send({ error: 'Draft revision conflict.' }, 409);
      if (interrupt && !stopped) { stopped = true; return send({ error: 'Temporarily unavailable.' }, 503); }
      assert.equal(body.expectedRevision, 1); assert.equal(body.idempotencyKey, 'finish:test-resumable-import');
      if (requests.has(body.idempotencyKey)) return send(stored);
      stored = { ...stored, revision: 2, data: body.data }; requests.set(body.idempotencyKey, true);
      if (loseReceipt && !stopped) { stopped = true; return send({error: 'Response was lost after saving.'}, 503); }
      return send(stored);
    }
    if (route.endsWith('/draft-uuid') && req.method === 'GET') return send(stored);
    if (route.endsWith('/status')) return send({ audio: { state: 'not_requested', sourceFingerprint: 'source-hash' } });
    if (route.endsWith('/social')) { counters.social++; assert.equal(body.expectedRevision, 2); return send({ state: 'ready', exportUrl: '/journal/api/integration/drafts/draft-uuid/social/export' }); }
    if (route.endsWith('/narration')) { counters.narration++; assert.equal(body.sourceFingerprint, 'source-hash'); return send({ state: 'waiting_for_producer', producer: { available: false } }); }
    send({ error: 'Unexpected path: ' + route }, 404);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const config = { url: `http://127.0.0.1:${server.address().port}/journal`, token: 'test-token', brandId: 'landworkspro', legacy: false };
  return { root, image, manifest, counters, config, api: createClient(config), statePath: join(root, 'state.json'), edit: data => { stored = { ...stored, data, revision: stored.revision + 1 }; } };
}
test('mounted import uploads real bytes, validates, generates exports, then resumes without rewriting', async t => {
  const context = await fixture(t);
  const first = await importDraft({ ...context, article, social: true, narrationVoice: 'approved-voice' });
  assert.equal(first.revision, 2); assert.equal(first.audio.state, 'waiting_for_producer');
  assert.equal(context.counters.create, 1); assert.equal(context.counters.upload, 1); assert.equal(context.counters.validations, 1);
  context.edit({ ...article, heroImage: '/journal/media/uploaded', title: 'Manual owner edit' });
  const second = await importDraft({ ...context, article, social: true, narrationVoice: 'approved-voice' });
  assert.equal(second.revision, 3);
  assert.deepEqual(context.counters, { create: 1, update: 1, upload: 1, social: 1, narration: 1, validations: 1 });
});
test('failed finish resumes with existing draft and uploaded assets', async t => {
  const context = await fixture(t, { interrupt: true });
  await assert.rejects(importDraft({ ...context, article }), /503/);
  await importDraft({ ...context, article });
  assert.deepEqual(context.counters, { create: 1, update: 2, upload: 1, social: 0, narration: 0, validations: 2 });
});
test('revision conflict preserves state and never generates derivatives', async t => {
  const context = await fixture(t, { conflict: true });
  await assert.rejects(importDraft({ ...context, article, social: true }), /409:.*reconcile/);
  const state = JSON.parse(readFileSync(context.statePath, 'utf8'));
  assert.equal(state.id, 'draft-uuid'); assert.equal(state.assets.hero, '/journal/media/uploaded'); assert.equal(state.draftComplete, undefined); assert.equal(context.counters.social, 0);
});
test('brand mismatch stops before mutation', async t => {
  const context = await fixture(t, { wrongBrand: true });
  await assert.rejects(importDraft({ ...context, article }), /server identity/);
  assert.equal(context.counters.create, 0);
});
test('changed image bytes and server identity cannot reuse an import state', async t => {
  const context = await fixture(t);
  await importDraft({ ...context, article });
  writeFileSync(context.image, 'replacement image');
  await assert.rejects(importDraft({ ...context, article }), /image bytes changed/);
  const state = JSON.parse(readFileSync(context.statePath, 'utf8')); state.identity.url = 'https://elsewhere.invalid/blog'; writeFileSync(context.statePath, JSON.stringify(state));
  writeFileSync(context.image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await assert.rejects(importDraft({ ...context, article }), /another server or brand/);
});
test('unprepared derivatives stop after owner edits instead of overwriting', async t => {
  const context = await fixture(t); await importDraft({ ...context, article });
  context.edit({ ...article, title: 'New owner revision' });
  await assert.rejects(importDraft({ ...context, article, social: true }), /edited after import/);
  assert.equal(context.counters.social, 0);
});
test('private training and arbitrary HTML fail before import', () => {
  assert.throws(() => checkArticle({ ...article, trainingDoc: {} }), /Private training/);
  assert.throws(() => checkArticle({ ...article, bodyDoc: { type: 'doc', content: [{ type: 'rawHtml', html: '<script>' }] } }), /Arbitrary HTML/);
  assert.throws(() => checkArticle({ ...article, schemaVersion: 3 }), /schemaVersion 2/);
});
test('registry requires protected permissions and explicit matching brand', t => {
  const root = mkdtempSync(join(tmpdir(), 'engine-registry-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'registry.json'); writeFileSync(file, JSON.stringify({ landworkspro: { url: 'http://localhost:3000/journal', tokenEnv: 'LW_TOKEN' } }), { mode: 0o600 });
  const env = { BLOG_ENGINE_REGISTRY: file, LW_TOKEN: 'private-token' };
  assert.equal(connection(env, 'landworkspro').url, 'http://localhost:3000/journal');
  assert.throws(() => connection(env), /Choose a configured brand/);
  assert.throws(() => connection(env, 'unknown'), /not configured/);
  assert.throws(() => connection({ BLOG_ENGINE_URL: 'http://public.invalid/blog', BLOG_ENGINE_TOKEN: 'private-token' }), /HTTPS/);
});

test('lost successful receipt followed by owner edits stops instead of claiming prepared content landed', async t => {
  const context = await fixture(t, { loseReceipt: true });
  await assert.rejects(importDraft({ ...context, article }), /503/);
  context.edit({ ...article, heroImage: '/journal/media/uploaded', title: 'Manual owner revision after unknown outcome' });
  await assert.rejects(importDraft({ ...context, article, social: true }), /differs from the prepared content/);
  assert.equal(context.counters.social, 0);
  assert.equal(JSON.parse(readFileSync(context.statePath, 'utf8')).draftComplete, undefined);
});
