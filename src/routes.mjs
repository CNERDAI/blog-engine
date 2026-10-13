import {brand} from './brand.mjs';

export const mounted = suffix => brand.basePath + (suffix.startsWith('/') ? suffix : '/' + suffix);
export const absolute = path => new URL(path, brand.publicOrigin).href;
export const articlePath = slug => mounted('/' + encodeURIComponent(slug) + '/');
export const assetPath = (id, privateAsset = false) => mounted(privateAsset ? '/api/admin/blog/assets/' + id : '/media/' + id);
export function assetId(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('http')) {
    try { const parsed = new URL(url); if (parsed.origin !== brand.publicOrigin) return null; url = parsed.pathname; } catch { return null; }
  }
  return url.match(/(?:\/blog-media\/|\/api\/admin\/blog\/assets\/|\/media\/)([a-f0-9]{32})(?:$|\/variants\/)/)?.[1] || null;
}
// Rewrite only known URL attributes in rendered HTML, never code, prompts or prose.
export function mountHtml(html, {privatePreview = false} = {}) {
  return html.replace(/\b(src|href|action)="([^"]*)"/g, (whole, attr, url) => {
    let next = url;
    const id = assetId(url);
    if (id && /^\/(?:blog-media\/|api\/admin\/blog\/assets\/)/.test(url)) next = assetPath(id, privatePreview);
    else if (id && privatePreview && url.startsWith(mounted('/media/'))) next = url.replace(mounted('/media/'), mounted('/api/admin/blog/assets/'));
    else if (url === '/blog/' || url.startsWith('/blog/')) next = brand.basePath + url.slice(5);
    else if (url.startsWith('/api/')) next = mounted(url);
    return `${attr}="${next}"`;
  });
}
