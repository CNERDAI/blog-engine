import {assetReferences, contentBlocks, nodeText} from './blog-document.mjs';

export function articleQuality(article) {
  const errors = [], warnings = [];
  const add = (list, code, path, message) => list.push({code, path, message});
  if (!article.title || article.title.length < 10) add(errors, 'title.required', 'title', 'Use a descriptive title of at least 10 characters.');
  if (!article.summary || article.summary.length < 30) add(errors, 'summary.required', 'summary', 'Add a useful reader summary of at least 30 characters.');
  const text = article.schemaVersion === 2 ? nodeText(article.bodyDoc || {type: 'doc'}) : contentBlocks(article).map(b => b.body || b.content || b.title || '').join(' ');
  if (!text.trim()) add(errors, 'content.required', 'bodyDoc', 'Add public article content.');
  if (!article.heroImage) add(warnings, 'hero.missing', 'heroImage', 'Add a feature image before preparing social images.');
  if (article.heroImage && !article.heroDecorative && !article.heroAlt?.trim()) add(errors, 'image.alt', 'heroAlt', 'Describe the meaningful feature image, or intentionally mark it decorative.');
  if (article.socialImage && !article.socialImageAlt?.trim()) add(errors, 'social.alt', 'socialImageAlt', 'Describe the social image.');
  const image = (value, path) => {
    if (!value.alt?.trim() && value.decorative !== true) add(errors, 'image.alt', path + '.alt', 'Describe this meaningful image or intentionally mark it decorative.');
  };
  const block = (b, path) => {
    if (b.type === 'image') image(b, path);
    (b.images || []).forEach((img, i) => image(img, `${path}.images.${i}`));
    (b.steps || []).forEach((step, i) => { if (step.image) image({alt: step.imageAlt, decorative: step.imageDecorative}, `${path}.steps.${i}.image`); });
  };
  const visit = (node, path) => {
    if (node.type === 'image') image(node.attrs || {}, path + '.attrs');
    if (node.type === 'cnerdBlock') block(node.attrs.block, path + '.attrs.block');
    (node.content || []).forEach((child, i) => visit(child, `${path}.content.${i}`));
  };
  if (article.schemaVersion === 2) visit(article.bodyDoc, 'bodyDoc');
  else (article.blocks || []).forEach((b, i) => block(b, 'blocks.' + i));
  if (!article.topics?.length) add(warnings, 'topics.missing', 'topics', 'Add useful topics for related articles.');
  if ((article.seoTitle || article.title).length > 60) add(warnings, 'title.length', 'seoTitle', 'Search engines may truncate this title.');
  if ((article.seoDescription || article.summary).length > 155) add(warnings, 'description.length', 'seoDescription', 'Search engines may truncate this description.');
  for (const reference of assetReferences(article)) if (/^https?:/.test(reference.url) && reference.kind === 'image') add(warnings, 'image.external', 'bodyDoc', 'External image delivery and dimensions need separate verification. Prefer uploaded images.');
  return {passed: errors.length === 0, errors, warnings};
}
