import { request } from './use-article-session';
import type { ArticleRecord } from './types';
const pending = new Map<string, unknown>();
export async function deleteArticle(record: ArticleRecord): Promise<boolean> {
  let input = pending.get(record.id);
  if (!input) {
    const impact = await request<any>('admin/blog/' + record.slug + '/deletion');
    if (impact.uses.length) throw new Error('Remove these asset references first: ' + impact.uses.join('; '));
    const message = `Delete “${impact.title}” permanently? This removes its content, private training, ${impact.revisions} revisions, ${impact.assets} attached files and ${impact.recordings} recordings. Type its exact title to confirm.`;
    if (prompt(message) !== impact.title) return false;
    input = { articleId: impact.id, revision: impact.revision, confirmation: impact.title };
    pending.set(record.id, input);
  }
  try {
    await request('admin/blog/' + record.slug, 'DELETE', input);
  } catch (error: any) {
    if (error.status && error.status !== 503) pending.delete(record.id);
    throw error;
  }
  pending.delete(record.id);
  return true;
}
