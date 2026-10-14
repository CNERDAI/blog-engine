import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'blog-admin-details-'));
process.env.DATA_DIR = dir;
const {saveBlog, publishBlog, getBlog, archiveBlog} = await import('../src/blog.mjs');
const {adminArticles} = await import('../src/admin-articles.mjs');
const {db} = await import('../src/db.mjs');
after(() => { db.close(); rmSync(dir, {recursive: true, force: true}); });
const draft = {schemaVersion: 2, slug: 'admin-details', title: 'A useful article for readers',
  summary: 'A clear summary that explains what the reader will learn from this article.', author: 'Test author', topics: ['Technology'],
  bodyDoc: {type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'Useful public content.'}]}]},
  trainingDoc: {type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'PRIVATE TRAINING SENTINEL'}]}]}};

test('admin list distinguishes draft dates, public dates and scheduling without leaking content', () => {
  let article = saveBlog(draft.slug, {...draft, publishedAt: '2026-01-02T15:00:00Z'}, 0);
  let row = adminArticles().find(item => item.id === article.id);
  assert.equal(row.publishedAt, null);
  assert.equal(row.draftPublishedAt, '2026-01-02T15:00:00.000Z');
  assert.deepEqual(row.scheduling, {supported: false, scheduledAt: null});
  assert.deepEqual(row.audio, {saved: 0, active: 0, stale: 0, jobState: 'not_requested'});
  assert.equal(row.draft, undefined);
  assert(!JSON.stringify(row).includes('PRIVATE TRAINING SENTINEL'));
  article = publishBlog(article.slug, article.revision);
  const snapshot = structuredClone(article.published);
  // The manager submits the existing canonical draft with only edited metadata.
  article = saveBlog(article.slug, {...article.draft, title: 'Changed title waiting for review', topics: ['How to'], publishedAt: '2026-01-03T16:00:00Z'}, article.revision);
  row = adminArticles().find(item => item.id === article.id);
  assert.equal(row.hasUnpublished, true);
  assert.equal(row.publishedAt, snapshot.publishedAt);
  assert.equal(row.draftPublishedAt, '2026-01-03T16:00:00.000Z');
  assert.deepEqual(getBlog(article.slug).published, snapshot);
  assert.deepEqual(article.draft.bodyDoc, draft.bodyDoc);
  assert.deepEqual(article.draft.trainingDoc, draft.trainingDoc);
  assert.throws(() => saveBlog(article.slug, article.draft, article.revision - 1), error => error.status === 409);
  archiveBlog(article.slug, article.revision);
  assert.equal(adminArticles().find(item => item.id === article.id).state, 'archived');
});
