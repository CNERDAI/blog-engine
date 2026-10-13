const config = window.BLOG_ENGINE;
const base = config.basePath.replace(/\/$/, '');
const host = document.querySelector('#blog-manager');
let cleanup;
const path = part => base + '/' + part;
const node = (tag, text, attrs = {}) => {
  const el = document.createElement(tag);
  el.textContent = text;
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
};
async function api(part, method = 'GET', data) {
  const response = await fetch(path('api/' + part), {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { status: response.status });
  return result;
}
function clear() {
  cleanup?.();
  cleanup = undefined;
  host.replaceChildren();
}
function status(message, parent = host) {
  const text = node('p', message, { role: 'status' });
  parent.append(text);
  return text;
}
function login(message = '') {
  clear();
  host.append(node('h1', config.name + ' · Articles'));
  const form = node('form', '', { class: 'blog-engine-login' });
  const label = node('label', 'Owner password');
  const input = node('input', '', { type: 'password', autocomplete: 'current-password', required: '', name: 'password' });
  label.append(input);
  const submit = node('button', 'Sign in', { type: 'submit' });
  const feedback = status(message, form);
  form.prepend(label, submit);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    try { await api('auth', 'POST', { password: input.value }); input.value = ''; await list(); }
    catch (error) { feedback.textContent = error.message; submit.disabled = false; }
  };
  host.append(form);
}
async function edit(record) {
  clear();
  const editor = await import(path('assets/editor/blog-editor.js'));
  cleanup = editor.mountBlog(host, record, { onBack: () => void list() });
  history.replaceState(null, '', path('admin/') + (record ? '?article=' + encodeURIComponent(record.id) : ''));
}
async function list() {
  try {
    const articles = await api('admin/blog');
    clear();
    host.append(node('h1', config.name + ' · Articles'));
    const actions = node('div', '', { class: 'blog-engine-manager-actions' });
    const create = node('button', 'New article', { type: 'button' });
    create.onclick = () => edit(null).catch(error => status(error.message));
    const logout = node('button', 'Sign out', { type: 'button' });
    logout.onclick = async () => {
      try { await api('auth', 'DELETE'); login(); }
      catch (error) { status(error.message); }
    };
    const library = node('a', 'View public articles ↗', { href: path(''), target: '_blank', rel: 'noopener noreferrer' });
    actions.append(create, library, logout);
    host.append(actions);
    if (!articles.length) status('No articles yet. Create a private draft to begin.');
    const rows = node('ul', '', { class: 'blog-engine-article-list' });
    for (const article of articles) {
      const row = node('li', '');
      const button = node('button', article.title || article.draft?.title || 'Untitled', { type: 'button' });
      button.onclick = async () => {
        button.disabled = true;
        try { await edit(await api('admin/blog/' + encodeURIComponent(article.slug))); }
        catch (error) { button.disabled = false; status(error.message); }
      };
      row.append(button, node('span', `${article.state} · Revision ${article.revision}`));
      rows.append(row);
    }
    host.append(rows);
    const articleId = new URL(location.href).searchParams.get('article');
    if (articleId) {
      const item = articles.find(article => article.id === articleId);
      if (item) await edit(await api('admin/blog/' + encodeURIComponent(item.slug)));
      else status('This article was not found.');
    }
  } catch (error) {
    if (error.status === 401) login();
    else { clear(); status(error.message); const retry = node('button', 'Retry'); retry.onclick = () => void list(); host.append(retry); }
  }
}
if (host) void list();
