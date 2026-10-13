import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { brand } from './brand.mjs';
import { assetId } from './routes.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = message => Object.assign(Error(message), { status: 422 });
export function runMedia(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 2_000_000 });
  if (result.error || result.status !== 0) throw fail(`${binary} could not process this image. ${result.error?.code === 'ENOENT' ? 'Install FFmpeg and FFprobe first.' : 'Choose a valid, reasonably sized image.'}`);
  return result.stdout;
}
export function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5_000_000) throw fail('Choose an uploaded image under 5 MB.');
  let mime;
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mime = 'image/jpeg';
  else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
  else throw fail('Only actual JPEG, PNG, and WebP images are supported.');
  const temp = mkdtempSync(join(tmpdir(), 'blog-image-'));
  try {
    const path = join(temp, 'input');
    writeFileSync(path, buffer, { mode: 0o600 });
    const probe = JSON.parse(runMedia('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'json', path]));
    const stream = probe.streams?.[0];
    if (!stream || !Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width < 1 || stream.height < 1 || stream.width > 16000 || stream.height > 16000 || stream.width * stream.height > 40_000_000) throw fail('Choose an image under 40 megapixels and 16,000 pixels per side.');
    const allowed = { 'image/png': 'png', 'image/jpeg': 'mjpeg', 'image/webp': 'webp' };
    if (stream.codec_name !== allowed[mime]) throw fail('The image signature does not match the decoded image.');
    runMedia('ffmpeg', ['-v', 'error', '-xerror', '-threads', '1', '-i', path, '-frames:v', '1', '-f', 'null', '-']);
    return { width: stream.width, height: stream.height, mime, format: mime.split('/')[1] };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export function ensureVariants(asset) {
  if (!asset || !/^[a-f0-9]{32}$/.test(asset.id) || !asset.path || asset.kind !== 'image') throw fail('Choose an actual uploaded image asset.');
  const original = readFileSync(asset.path), sourceHash = sha256(original);
  const root = join(dirname(asset.path), 'variants', asset.id), manifestPath = join(root, 'manifest.json');
  if (existsSync(manifestPath)) {
    const cached = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (cached.sourceHash === sourceHash && cached.variants.every(file => existsSync(file.path) && sha256(readFileSync(file.path)) === file.hash)) return cached;
  }
  const info = inspectImage(original);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const widths = [...new Set([640,1280,1920].map(width => Math.min(width, info.width)))];
  const variants = widths.map(width => {
    const path = join(root, `${width}.jpg`), temp = join(root, `${randomUUID()}.jpg`);
    try {
      runMedia('ffmpeg', ['-v', 'error', '-threads', '1', '-i', asset.path, '-vf', `scale=${width}:-1`, '-frames:v', '1', '-q:v', '3', '-map_metadata', '-1', '-y', temp]);
      const variant = inspectImage(readFileSync(temp));
      renameSync(temp, path);
      return { width: variant.width, height: variant.height, mime: variant.mime, path, bytes: statSync(path).size, hash: sha256(readFileSync(path)) };
    } finally { rmSync(temp, { force: true }); }
  });
  const manifest = { ...info, id: asset.id, sourceHash, variants };
  const pending = `${manifestPath}.${randomUUID()}.tmp`;
  writeFileSync(pending, JSON.stringify(manifest), { mode: 0o600 });
  renameSync(pending, manifestPath);
  return manifest;
}
export function enrichImageHtml(html, resolveAsset, { privatePreview = false } = {}) {
  return html.replace(/<img\b[^>]*>/g, tag => {
    const id = assetId(tag.match(/\bsrc="([^"]*)"/)?.[1]);
    if (!id) return tag;
    const asset = resolveAsset(id);
    if (!asset || asset.kind !== 'image') return tag;
    const info = ensureVariants(asset);
    const base = privatePreview ? `${brand.basePath}/api/admin/blog/assets/${id}/variants/` : `${brand.basePath}/media/${id}/variants/`;
    const clean = tag.replace(/\s(?:width|height|srcset|sizes|decoding)="[^"]*"/g, '');
    return clean.replace(/>$/, ` width="${info.width}" height="${info.height}" decoding="async" srcset="${info.variants.map(item => `${base}${item.width}.jpg ${item.width}w`).join(', ')}" sizes="(max-width: 760px) calc(100vw - 40px), 960px">`);
  });
}
