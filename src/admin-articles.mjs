import {allBlogs, getBlogById} from './blog.mjs';
import {narrationStatus, narrationAsset, publicNarrations} from './narration.mjs';

// Admin-only summaries. Saved audio and reader availability are distinct.
export function adminArticles() {
  return allBlogs(true).map(article => {
    const record = getBlogById(article.id);
    const status = narrationStatus(article.id);
    const recordings = status.recordings.filter(item => narrationAsset(item.id, true));
    return {...article, draftPublishedAt: record.draft.publishedAt ?? null,
      scheduling: {supported: false, scheduledAt: null},
      audio: {saved: recordings.length,
        active: article.state === 'published' ? publicNarrations(article.slug).voices.length : 0,
        stale: recordings.filter(item => item.stale).length,
        jobState: status.state}};
  });
}
