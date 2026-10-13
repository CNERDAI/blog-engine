export type EngineBootstrap = {
  basePath: string;
  brandId: string;
  name: string;
  defaultAuthor?: string;
  socialDestinations?: string[];
  approvedVoices?: Array<{ id: string; name?: string }>;
};
declare global { interface Window { BLOG_ENGINE?: EngineBootstrap } }
export function engineConfig(): EngineBootstrap {
  return window.BLOG_ENGINE || { basePath: '/blog', brandId: '', name: 'Blog Engine' };
}
export function enginePath(path = ''): string {
  return engineConfig().basePath.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}
export const apiPath = (path: string) => enginePath('api/' + path);
export const adminPath = (id?: string) => enginePath('admin/') + (id ? '?article=' + encodeURIComponent(id) : '');
export function privateAssetPath(value: string): string {
  if (!value) return value;
  const mount = engineConfig().basePath.replace(/\/$/, '');
  for (const prefix of [mount + '/media/', '/blog/media/', '/blog-media/']) {
    if (value.startsWith(prefix)) return apiPath('admin/blog/assets/' + value.slice(prefix.length));
  }
  if (value.startsWith('/api/')) return enginePath(value);
  return value;
}
export function privatePreviewHtml(html: string): string {
  // Canonical renderer escapes the attribute contents. Preserve that encoding.
  return html.replace(/\b(src|href)="([^"]+)"/g, (_, attr, path) => `${attr}="${privateAssetPath(path)}"`);
}
