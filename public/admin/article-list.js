import {easternInput, easternCandidates, formatArticleDate} from '../assets/article-date.js';
import {icon} from '../assets/ui-icons.js';

const node = (tag, text = '', attrs = {}) => {
  const el = document.createElement(tag);
  el.textContent = text;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
};
const date = (value, zone) => {
  if (!value) return 'Set when published';
  // SQLite CURRENT_TIMESTAMP is UTC, despite having no offset in its text.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  return formatArticleDate(iso, zone);
};
function field(label, control) {
  const el = node('label', label);
  el.append(control);
  return el;
}
function dialog(title, message) {
  const previous = document.activeElement;
  const el = node('dialog', '', {class: 'blog-engine-dialog', 'aria-labelledby': 'article-dialog-title'});
  el.append(node('h2', title, {id: 'article-dialog-title'}), node('p', message));
  const form = node('form');
  const feedback = node('p', '', {role: 'status'});
  const actions = node('div', '', {class: 'blog-engine-dialog-actions'});
  const cancel = node('button', 'Cancel', {type: 'button'});
  const submit = node('button', '', {type: 'submit'});
  actions.append(cancel, submit);
  const close = () => { el.remove(); previous?.focus(); };
  cancel.onclick = close;
  el.oncancel = event => { event.preventDefault(); if (!submit.disabled || !el.dataset.busy) close(); };
  el.append(form);
  document.body.append(el);
  return {el, form, feedback, actions, cancel, submit, close};
}
async function quickEdit(article, {api, refresh, zone, report}) {
  const record = await api('admin/blog/' + article.slug);
  const d = dialog('Quick edit article', 'Save these details to the draft. Use the full editor to review and publish changes.');
  const title = node('input', '', {required: '', maxlength: '180', value: record.draft.title});
  const author = node('input', '', {maxlength: '120', value: record.draft.author});
  const topics = node('input', '', {value: record.draft.topics.join(', ')});
  const mode = node('select');
  mode.append(node('option', 'Set when first published', {value: 'auto'}), node('option', 'Set date and time', {value: 'manual'}));
  mode.value = record.draft.publishedAt ? 'manual' : 'auto';
  const time = node('input', '', {type: 'datetime-local', value: easternInput(record.draft.publishedAt, zone)});
  const offset = node('select', '', {'aria-label': 'Time offset'});
  const initialLocal = time.value;
  const initialOffset = easternCandidates(initialLocal, zone).find(item => Math.abs(Date.parse(item.value) - Date.parse(record.draft.publishedAt)) < 60000)?.value || '';
  let selectedOffset = initialOffset;
  const dateField = field('Article date and time — ' + zone, time);
  const offsetField = field('Time offset', offset);
  const updateDate = () => {
    dateField.hidden = mode.value === 'auto';
    time.required = mode.value === 'manual';
    const choices = easternCandidates(time.value, zone);
    offset.replaceChildren(node('option', 'Choose time offset', {value: ''}), ...choices.map(item => node('option', item.label, {value: item.value})));
    offset.value = choices.find(item => item.value === selectedOffset)?.value || '';
    offsetField.hidden = mode.value === 'auto' || choices.length !== 2;
  };
  mode.onchange = () => { if (!time.value) time.value = easternInput(new Date().toISOString(), zone); updateDate(); };
  time.oninput = () => { selectedOffset = ''; updateDate(); };
  offset.onchange = () => { selectedOffset = offset.value; };
  updateDate();
  d.submit.textContent = 'Save draft';
  d.form.append(field('Title', title), field('Author', author), field('Categories / topics (comma separated)', topics), field('Article date', mode), dateField, offsetField,
    node('p', 'Display date only. Automatic scheduled publication is unavailable.', {class: 'blog-engine-help'}), d.feedback, d.actions);
  d.form.onsubmit = async event => {
    event.preventDefault();
    let publishedAt = null;
    if (mode.value === 'manual') {
      const choices = easternCandidates(time.value, zone);
      publishedAt = choices.length === 1 ? choices[0].value : choices.find(item => item.value === offset.value)?.value;
      if (!publishedAt) { d.feedback.textContent = choices.length === 2 ? 'Choose a time offset for this repeated time.' : 'Choose a valid date and time. This time may not exist during a clock change.'; return; }
      if (time.value === initialLocal && publishedAt === initialOffset) publishedAt = record.draft.publishedAt;
    }
    const categories = [...new Set(topics.value.split(',').map(item => item.trim()).filter(Boolean))];
    if (categories.length > 8 || categories.some(item => item.length > 60)) { d.feedback.textContent = 'Use up to eight categories, with at most 60 characters each.'; return; }
    d.el.dataset.busy = 'true';
    for (const control of d.form.elements) control.disabled = true;
    try {
      await api('admin/blog/' + record.slug, 'PUT', {revision: record.revision, data: {...record.draft, title: title.value, author: author.value, topics: categories, publishedAt}});
      d.close();
      await refresh();
      report('Draft details saved.');
    } catch (error) {
      delete d.el.dataset.busy;
      for (const control of d.form.elements) control.disabled = false;
      d.feedback.textContent = error.message;
    }
  };
  d.el.showModal();
  title.focus();
}
const pendingDeletes = new Map();
async function remove(article, {api, refresh, report}) {
  const impact = await api('admin/blog/' + article.slug + '/deletion');
  if (impact.uses.length) throw Error('Remove these asset references first: ' + impact.uses.join('; '));
  const d = dialog('Delete article permanently?', `“${impact.title}” · ${impact.state}. This removes its content, private training, ${impact.revisions} revisions, ${impact.assets} attached files, and ${impact.recordings} recordings. ${impact.state === 'published' ? 'Its public URL will disappear. ' : ''}This cannot be undone from the editor.`);
  const confirmation = node('input', '', {autocomplete: 'off', required: ''});
  d.submit.textContent = 'Delete article';
  d.submit.className = 'danger';
  d.submit.disabled = true;
  confirmation.oninput = () => { d.submit.disabled = confirmation.value !== impact.title; };
  d.form.append(field('Type the exact article title to confirm', confirmation), d.feedback, d.actions);
  d.form.onsubmit = async event => {
    event.preventDefault();
    if (confirmation.value !== impact.title) return;
    const input = pendingDeletes.get(article.id) || {articleId: impact.id, revision: impact.revision, confirmation: impact.title};
    pendingDeletes.set(article.id, input);
    d.el.dataset.busy = 'true';
    for (const control of d.form.elements) control.disabled = true;
    try {
      await api('admin/blog/' + article.slug, 'DELETE', input);
      pendingDeletes.delete(article.id);
      d.close();
      await refresh();
      report('Article deleted.');
    } catch (error) {
      if (error.status && error.status !== 503) pendingDeletes.delete(article.id);
      delete d.el.dataset.busy;
      for (const control of d.form.elements) control.disabled = false;
      d.feedback.textContent = error.message;
    }
  };
  d.el.showModal();
  confirmation.focus();
}
export function articleList(articles, options) {
  const {zone, open, report, path} = options;
  const section = node('section', '', {'aria-label': 'Article list'});
  const filters = node('div', '', {class: 'blog-engine-list-filters'});
  const search = node('input', '', {type: 'search', placeholder: 'Search title, author or category'});
  const state = node('select');
  for (const [value, label] of [['', 'All statuses'], ['published', 'Published'], ['draft', 'Draft'], ['archived', 'Archived']]) state.append(node('option', label, {value}));
  const count = node('p', '', {role: 'status', class: 'blog-engine-list-count'});
  filters.append(field('Search articles', search), field('Status', state));
  const wrapper = node('div', '', {class: 'blog-engine-table-wrap'});
  const table = node('table', '', {class: 'blog-engine-article-table'});
  table.append(node('caption', 'Article details · dates shown in ' + zone + ' · Automatic scheduling is unavailable'));
  const head = node('thead'), headings = node('tr');
  for (const label of ['Article', 'Status', 'Date / time', 'Categories', 'Audio', 'Schedule', 'Actions']) headings.append(node('th', label, {scope: 'col'}));
  head.append(headings);
  const body = node('tbody');
  table.append(head, body);
  wrapper.append(table);
  section.append(filters, count, wrapper);
  const render = () => {
    body.replaceChildren();
    const term = search.value.trim().toLowerCase();
    const visible = articles.filter(item => (!state.value || state.value === item.state) && (!term || [item.title, item.author, item.slug, ...item.topics].join(' ').toLowerCase().includes(term)));
    count.textContent = `${visible.length} of ${articles.length} articles`;
    for (const article of visible) {
      const row = node('tr');
      const cell = label => { const el = node('td', '', {'data-label': label}); row.append(el); return el; };
      const title = cell('Article');
      const openButton = node('button', article.title, {type: 'button', class: 'blog-engine-article-title'});
      const run = (button, action) => { button.onclick = async () => { button.disabled = true; try { await action(); } catch (error) { report(error.message); } finally { button.disabled = false; } }; };
      run(openButton, () => open(article));
      title.append(openButton, node('small', article.author + ' · Revision ' + article.revision));
      const status = cell('Status');
      status.append(node('strong', article.state[0].toUpperCase() + article.state.slice(1), {class: 'blog-engine-state-' + article.state}));
      if (article.hasUnpublished) status.append(node('small', 'Unpublished changes'));
      const dates = cell('Date / time');
      dates.append(node('div', date(article.publishedAt || article.draftPublishedAt, zone)), node('small', article.publishedAt ? 'Published date' : article.draftPublishedAt ? 'Draft display date' : 'Publication date'), node('small', 'Updated: ' + date(article.updatedAt, zone)));
      if (article.publishedAt && article.draftPublishedAt && article.draftPublishedAt !== article.publishedAt) dates.append(node('small', 'Draft date: ' + date(article.draftPublishedAt, zone)));
      cell('Categories').textContent = article.topics.join(', ') || 'Uncategorized';
      const audio = cell('Audio'), saved = article.audio;
      audio.append(node('div', saved?.active ? 'Available to readers' : saved?.saved ? 'Saved · inactive' : 'No saved audio'));
      if (saved?.saved) audio.append(node('small', `${saved.saved} recording${saved.saved === 1 ? '' : 's'}${saved.stale ? ' · ' + saved.stale + ' stale' : ''}`));
      if (saved?.jobState === 'waiting_for_producer') audio.append(node('small', 'Waiting for producer'));
      cell('Schedule').textContent = 'Unavailable';
      const actions = cell('Actions');
      const buttons = node('div', '', {class: 'blog-engine-row-actions'});
      const pencil = node('button', '', {type: 'button', title: 'Quick edit', 'aria-label': 'Quick edit ' + article.title});
      pencil.innerHTML = icon('pencil');
      const trash = node('button', '', {type: 'button', class: 'danger', title: 'Delete article', 'aria-label': 'Delete ' + article.title});
      trash.innerHTML = icon('trash');
      run(pencil, () => quickEdit(article, options));
      run(trash, () => remove(article, options));
      buttons.append(pencil, trash);
      actions.append(buttons);
      if (article.state === 'published') actions.append(node('a', 'View ↗', {href: path(article.slug + '/'), target: '_blank', rel: 'noopener noreferrer'}));
      body.append(row);
    }
    if (!visible.length) { const row = node('tr'); row.append(node('td', 'No articles match these filters.', {colspan: '7'})); body.append(row); }
  };
  search.oninput = render;
  state.onchange = render;
  render();
  return section;
}
