import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { brand } from './brand.mjs';
import { dataDir, db } from './db.mjs';
import { inspectImage, runMedia, sha256 } from './media.mjs';
import { assetId as localAssetId } from './routes.mjs';

// These are editable export compositions, not claims of universal posting/API compatibility.
export const socialPresets = [
  { id: 'landscape', width: 1200, height: 630, format: 'jpeg', safeArea: 0.1 },
  { id: 'square', width: 1080, height: 1080, format: 'jpeg', safeArea: 0.1 },
  { id: 'portrait', width: 1080, height: 1350, format: 'jpeg', safeArea: 0.1 }
].map(preset => ({ ...preset, version: '1', sourceDate: '2026-10-13', maxBytes: 5_000_000,
  sources: ['https://ogp.me/', 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09'],
  note: 'Composition option. Review the exported crop and current destination requirements before posting.' }));
const destinations = { facebook: 'landscape', linkedin: 'landscape', x: 'landscape', instagram: 'portrait' };
const root = join(dataDir, 'social');
const fail = (message, status = 422) => Object.assign(Error(message), { status });
function articleKey(record) {
  if (!record || !/^[a-zA-Z0-9-]{1,80}$/.test(record.id || '') || !record.draft) throw fail('Choose an existing article.', 404);
  return `${brand.id}-${record.id}`;
}
function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path);
}
const sourceIdentity = record => sha256(JSON.stringify({ id: record.id, revision: record.revision,
  draft: Object.fromEntries(Object.entries(record.draft).filter(([key]) => !['training', 'trainingDoc'].includes(key))),
  brand: { id: brand.id, name: brand.name, version: brand.version, publicOrigin: brand.publicOrigin, basePath: brand.basePath, publisher: brand.publisher, theme: brand.theme }, presetVersion: '1' }));
export function getSocialPack(record) {
  const path = join(root, `${articleKey(record)}.json`);
  if (!existsSync(path)) return null;
  const pointer = JSON.parse(readFileSync(path, 'utf8'));
  if (!/^[a-f0-9]{32}$/.test(pointer.id || '')) throw fail('The saved social package is invalid.');
  const folder = join(root, pointer.id), manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  if (manifest.brandId !== brand.id || manifest.articleId !== record.id) throw fail('This social package belongs to another article.', 403);
  const files = manifest.files.map(file => ({ ...file, path: join(folder, file.name) }));
  const intact = files.every(file => existsSync(file.path) && sha256(readFileSync(file.path)) === file.hash) && existsSync(join(folder, manifest.zipName));
  const unchangedAssets = manifest.sourceAssets.every(input => {
    const asset = db.prepare('SELECT file,slug,visibility FROM blog_assets WHERE id=?').get(input.id);
    const path = asset && join(dataDir,'blog-assets',asset.file);
    return asset?.slug === record.slug && asset.visibility === 'public' && existsSync(path) && sha256(readFileSync(path)) === input.hash;
  });
  const state = !intact ? 'failed' : unchangedAssets && manifest.sourceHash === sourceIdentity(record) && manifest.sourceRevision === record.revision ? 'ready' : 'stale';
  return { ...manifest, state, revision: manifest.sourceRevision, files, zipPath: join(folder, manifest.zipName),
    images: manifest.images.map(image => ({ ...image, url: `${brand.basePath}/api/admin/blog/${record.slug}/social/files/${image.name}` })),
    exportUrl: `${brand.basePath}/api/admin/blog/${record.slug}/social/export`, posting: { state: 'unavailable', message: 'Account posting requires a separately configured and authorized connector.' } };
}
export const socialStatus = record => getSocialPack(record) || { state: 'not_requested', posting: { state: 'unavailable' } };
export async function prepareSocial(record, options = {}) {
  const key = articleKey(record);
  if (Number(options.expectedRevision) !== record.revision) throw fail('This article changed. Reload before preparing social assets.', 409);
  const sourceHash = sourceIdentity(record);
  const previous = getSocialPack(record);
  const captionsInput = options.captions || {};
  if (typeof captionsInput !== 'object' || Array.isArray(captionsInput) || Object.keys(captionsInput).some(destination => !brand.socialDestinations.includes(destination))) throw fail('Use captions for this brand\'s enabled destinations.');
  const requestHash = sha256(JSON.stringify({ sourceHash, captionsInput, assetId: options.assetId || '', imageAlt: options.imageAlt || '', replaceManualCaptions: options.replaceManualCaptions === true }));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let requestPath;
  if (options.idempotencyKey) {
    if (typeof options.idempotencyKey !== 'string' || options.idempotencyKey.length > 200) throw fail('Use a bounded idempotency key.');
    requestPath = join(root, `${key}-request-${sha256(options.idempotencyKey)}.json`);
    if (existsSync(requestPath)) {
      const saved = JSON.parse(readFileSync(requestPath, 'utf8'));
      if (saved.requestHash !== requestHash) throw fail('This idempotency key was used for different social inputs.', 409);
      if (previous?.id === saved.id && previous.state === 'ready') return previous;
      throw fail('This request has already completed. Read the current package before preparing another.', 409);
    }
  }
  const sourceUrl = record.draft.socialImage || record.draft.heroImage || '';
  const assetId = options.assetId || localAssetId(sourceUrl);
  if (!/^[a-f0-9]{32}$/.test(assetId || '')) throw fail('Social exports require an actual uploaded image. Remote image fetches are unavailable.');
  const { blogAsset } = await import('./blog.mjs');
  const asset = blogAsset(assetId, true);
  if (!asset || asset.slug !== record.slug || asset.kind !== 'image' || asset.visibility !== 'public') throw fail('Choose a public-content image owned by this article. Draft exports remain private.');
  const imageAlt = String(options.imageAlt || record.draft.socialImageAlt || record.draft.heroAlt || '').trim();
  if (!imageAlt || imageAlt.length > 220) throw fail('Describe the uploaded image before preparing social assets (maximum 220 characters).');
  const source = readFileSync(asset.path), sourceInfo = inspectImage(source), sourceAssetHash = sha256(source);
  const canonicalUrl = `${brand.publicOrigin}${brand.basePath}/${record.draft.slug}/`;
  const captions = {};
  for (const destination of brand.socialDestinations) {
    const submitted = captionsInput[destination];
    const old = previous?.captions[destination];
    if (submitted !== undefined) {
      const caption = typeof submitted === 'string' ? submitted : submitted?.text;
      if (typeof caption !== 'string' || caption.length > 10000) throw fail('Each social caption must be text under 10,000 characters.');
      captions[destination] = old?.manual && old.text === caption ? old : { text: caption, manual: true, editedAt: new Date().toISOString() };
    } else if (old?.manual && options.replaceManualCaptions !== true) captions[destination] = old;
    else captions[destination] = { text: destination === 'instagram' ? `${record.draft.title}\n\n${record.draft.summary}\n\nArticle: ${canonicalUrl}\n(Link in this caption is a reference; add the link through the account's supported placement.)` : destination === 'x' ? `${record.draft.title.slice(0,180)}\n${canonicalUrl}` : `${record.draft.title}\n\n${record.draft.summary}\n\n${canonicalUrl}`, manual: false };
  }
  const id = sha256(JSON.stringify({ requestHash, sourceAssetHash, captions, presetVersion: '1' })).slice(0,32);
  const folder = join(root, id), staging = join(root, `${id}.${randomUUID()}.tmp`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    const files = [], images = [];
    const focal = record.draft.focalPoint || { x: 0.5, y: 0.5 };
    const x = Number.isFinite(focal.x) ? Math.max(0,Math.min(1,focal.x)) : 0.5, y = Number.isFinite(focal.y) ? Math.max(0,Math.min(1,focal.y)) : 0.5;
    for (const preset of socialPresets) {
      const name = `${brand.id}-${record.draft.slug}-${preset.id}.jpg`, output = join(staging, name);
      runMedia('ffmpeg', ['-v','error','-threads','1','-i',asset.path,'-vf',`scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase,crop=${preset.width}:${preset.height}:(in_w-out_w)*${x}:(in_h-out_h)*${y}`, '-frames:v','1','-q:v','3','-map_metadata','-1','-y',output]);
      const bytes = readFileSync(output), actual = inspectImage(bytes);
      if (actual.width !== preset.width || actual.height !== preset.height) throw fail('The exported image has incorrect dimensions.');
      files.push({ name, mime: 'image/jpeg', bytes: bytes.length, hash: sha256(bytes), width: actual.width, height: actual.height, preset: preset.id });
      for (const destination of brand.socialDestinations.filter(destination => destinations[destination] === preset.id)) images.push({ destination, name, alt: imageAlt, width: actual.width, height: actual.height, preset: preset.id });
    }
    for (const image of images) {
      const compositionName = image.name;
      image.name = `${brand.id}-${record.draft.slug}-${image.destination}.jpg`;
      const bytes = readFileSync(join(staging,compositionName));
      writeFileSync(join(staging,image.name),bytes,{mode:0o600});
      files.push({name:image.name,mime:'image/jpeg',bytes:bytes.length,hash:sha256(bytes),width:image.width,height:image.height,destination:image.destination,preset:image.preset});
    }
    const captionsName = `${brand.id}-${record.draft.slug}-captions.txt`;
    const captionBytes = Buffer.from(Object.entries(captions).map(([destination, caption]) => `${destination.toUpperCase()}\n${caption.text}\n\nImage description: ${imageAlt}`).join('\n\n---\n\n'));
    writeFileSync(join(staging,captionsName),captionBytes,{mode:0o600});
    files.push({name:captionsName,mime:'text/plain',bytes:captionBytes.length,hash:sha256(captionBytes)});
    const zipName = `${brand.id}-${record.draft.slug}-social-${id.slice(0,8)}.zip`;
    const manifest = { schemaVersion: 1, id, brandId: brand.id, brandVersion: brand.version, articleId: record.id, articleSlug: record.draft.slug, sourceRevision: record.revision, sourceHash,
      createdAt: new Date().toISOString(), state:'ready', canonicalUrl, captions, images, files, zipName, sourceAssets: [{ id: assetId, hash: sourceAssetHash, ...sourceInfo }],
      presets: socialPresets, posting: { state:'unavailable' }, warnings: ['Review the exported crops before posting. Draft links will not resolve publicly until publication.'] };
    atomicJson(join(staging,'manifest.json'),manifest);
    const zip = spawnSync('zip',['-q','-j',join(staging,zipName),...files.map(file => join(staging,file.name)),join(staging,'manifest.json')],{encoding:'utf8',timeout:30000,maxBuffer:100000});
    if (zip.error || zip.status !== 0 || !statSync(join(staging,zipName)).size) throw fail('ZIP creation failed. Install the zip utility.');
    if (existsSync(folder)) rmSync(staging,{recursive:true,force:true}); else renameSync(staging,folder);
    atomicJson(join(root,`${key}.json`),{id});
    if (requestPath) atomicJson(requestPath,{requestHash,id});
    return getSocialPack(record);
  } catch (error) { rmSync(staging,{recursive:true,force:true}); throw error; }
}
