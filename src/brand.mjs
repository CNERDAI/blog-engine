import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const defaultConfig = fileURLToPath(new URL('../config/cnerd.local.json', import.meta.url));
const text = (value, name, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`Brand ${name} is required and must be under ${max} characters.`);
  return value.trim();
};
function identity(value, field) {
  if (!value || !['Person', 'Organization'].includes(value.type)) throw Error(`Brand ${field} requires a truthful Person or Organization type.`);
  return { type: value.type, name: text(value.name, `${field} name`), ...(value.url ? { url: safeLink(value.url) } : {}) };
}
function safeLink(value) {
  if (typeof value === 'string' && /^\/(?!\/)[a-zA-Z0-9._/?=&%-]*$/.test(value) && !value.includes('..')) return value;
  let url;
  try { url = new URL(value); } catch { throw Error('Brand links require a local path or HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Brand links require a local path or HTTPS URL.');
  return url.href;
}
export function loadBrandConfig(source = process.env.BRAND_CONFIG || defaultConfig) {
  const input = typeof source === 'string' ? JSON.parse(readFileSync(source, 'utf8')) : structuredClone(source);
  const id = text(input.id, 'id', 50);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw Error('Brand id must use lowercase letters, numbers and hyphens.');
  let origin;
  try { origin = new URL(input.publicOrigin); } catch { throw Error('Brand publicOrigin must be a valid origin.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  const local = input.environment === 'local';
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('Brand publicOrigin must contain only the origin.');
  if (local ? !loopback || !['http:', 'https:'].includes(origin.protocol) : origin.protocol !== 'https:' || loopback) throw Error('Local brand previews require loopback; production requires HTTPS.');
  if (!local && (input.domainVerified !== true || /(?:^|\.)(?:example\.(?:com|org|net)|example|invalid|test|localhost)$/.test(origin.hostname) || /placeholder|your-domain|yourdomain/i.test(origin.hostname))) throw Error('Production brand domain must be verified and cannot be a placeholder.');
  const basePath = input.basePath || '/blog';
  if (!/^\/[a-z][a-z0-9-]{0,39}$/.test(basePath) || ['api','admin','assets','media','private','auth','.well-known'].includes(basePath.slice(1))) throw Error('Brand basePath requires a safe mount such as /blog or /journal.');
  const timeZone=input.timeZone||'America/New_York';
  try { new Intl.DateTimeFormat('en-US',{timeZone}).format(); } catch { throw Error('Brand timeZone must be a valid IANA time zone.'); }
  const logo=input.logo?{src:safeLink(input.logo.src),alt:text(input.logo.alt,'logo alt',220),width:Number(input.logo.width||160),height:Number(input.logo.height||40)}:null;
  if(logo&&![logo.width,logo.height].every(v=>Number.isInteger(v)&&v>0&&v<=1000))throw Error('Logo dimensions must be positive integers under 1,000 pixels.');
  const theme = { accent: '#205caa', ink: '#15243a', paper: '#f8fafc', ...(input.theme || {}) };
  for (const color of Object.values(theme)) if (!/^#[a-fA-F0-9]{6}$/.test(color)) throw Error('Theme colors must be six-digit hex colors.');
  const navigation = (input.navigation || [{ label: 'Articles', href: '/blog/' }]).map(link => ({ label: text(link.label, 'navigation label', 60), href: safeLink(link.href) }));
  const port = input.port ?? Number(origin.port || (origin.protocol === 'https:' ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Brand port must be a valid TCP port.');
  const pronunciations = input.pronunciations || {};
  if (typeof pronunciations !== 'object' || Array.isArray(pronunciations) || Object.entries(pronunciations).length > 100 || Object.entries(pronunciations).some(([key, value]) => !/^[\p{L}\p{N} .'-]{1,80}$/u.test(key) || typeof value !== 'string' || !/^[\p{L}\p{N} .'-]{1,120}$/u.test(value))) throw Error('Brand pronunciations require a small mapping of words to spoken words.');
  return Object.freeze({
    id, name: text(input.name, 'name'), environment: local ? 'local' : 'production',
    publicOrigin: origin.origin, domainVerified: input.domainVerified === true, basePath, port,
    language: input.language || 'en-US', timeZone, logo, version: text(input.version || '1', 'version', 30),
    defaultAuthor: identity(input.defaultAuthor, 'defaultAuthor'), publisher: identity(input.publisher, 'publisher'),
    theme, navigation, footer: { text: text(input.footer?.text || input.name, 'footer text', 500), links: (input.footer?.links || []).map(link => ({ label: text(link.label, 'footer label', 60), href: safeLink(link.href) })) },
    pronunciations, voices: Array.isArray(input.voices) ? input.voices.map(voice => ({ id: text(voice.id, 'voice id', 80), label: text(voice.label, 'voice label', 120), approved: voice.approved === true, default:voice.default===true, kind: voice.kind || 'unverified' })) : [],
    socialDestinations: ['facebook', 'linkedin', 'x', 'instagram'].filter(destination => (input.socialDestinations || ['facebook', 'linkedin', 'x', 'instagram']).includes(destination)),
    description: input.description || `Articles from ${input.name}.`, previewNotice: local ? (input.previewNotice || 'Local release candidate preview. Brand details require owner verification before production.') : ''
  });
}
const configured = JSON.parse(readFileSync(process.env.BRAND_CONFIG || defaultConfig, 'utf8'));
export const brand = loadBrandConfig({ ...configured, ...(process.env.PUBLIC_ORIGIN ? { publicOrigin: process.env.PUBLIC_ORIGIN, port: Number(new URL(process.env.PUBLIC_ORIGIN).port || (process.env.PUBLIC_ORIGIN.startsWith('https:') ? 443 : 80)) } : {}), ...(process.env.BLOG_BASE_PATH ? { basePath: process.env.BLOG_BASE_PATH } : {}) });
