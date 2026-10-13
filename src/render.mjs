import { brand } from './brand.mjs';
import { esc } from './blog-document.mjs';

const absolute = path => new URL(path, `${brand.publicOrigin}/`).href;
const mountLink = path => path === '/blog' || path.startsWith('/blog/') ? brand.basePath + path.slice(5) : path;
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const meta = (name, value, property = false) => value === undefined || value === null || value === '' ? '' : `<meta ${property ? 'property' : 'name'}="${esc(name)}" content="${esc(value)}">`;
export function shell({ title, description = brand.description, body, path = brand.basePath + '/', schema = [], image, imageAlt = '', admin = false, publishedAt, modifiedAt, robots, nonce = '' }) {
  const canonical = absolute(path);
  const imageData = typeof image === 'string' ? { url: image } : image;
  const imageUrl = imageData?.url ? absolute(imageData.url) : '';
  const fullTitle = title === brand.name || title.includes(brand.name) ? title : `${title} · ${brand.name}`;
  return `<!doctype html><html lang="${esc(brand.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(fullTitle)}</title>
${meta('description', description)}${meta('robots', admin ? 'noindex, nofollow, noarchive' : robots || 'index, follow, max-image-preview:large')}
${admin ? '' : `<link rel="canonical" href="${esc(canonical)}"><link rel="alternate" type="application/rss+xml" title="${esc(brand.name)} articles" href="${brand.basePath}/feed.xml">`}
${meta('og:title', title, true)}${meta('og:description', description, true)}${meta('og:site_name', brand.name, true)}${meta('og:locale', brand.language.replace('-', '_'), true)}${meta('og:type', publishedAt ? 'article' : 'website', true)}${admin ? '' : meta('og:url', canonical, true)}
${admin ? '' : meta('og:image', imageUrl, true)}${!admin && imageUrl ? meta('og:image:alt', imageAlt || imageData?.alt, true) + meta('og:image:width', imageData?.width, true) + meta('og:image:height', imageData?.height, true) + meta('og:image:type', imageData?.mime, true) : ''}
${meta('twitter:card', imageUrl && !admin ? 'summary_large_image' : 'summary')}${meta('twitter:title', title)}${meta('twitter:description', description)}${admin ? '' : meta('twitter:image', imageUrl)}${admin ? '' : meta('twitter:image:alt', imageAlt || imageData?.alt)}
${meta('article:published_time', publishedAt, true)}${meta('article:modified_time', modifiedAt || publishedAt, true)}
${admin ? '' : schema.map(item => `<script nonce="${esc(nonce)}" type="application/ld+json">${json(item)}</script>`).join('')}
<link rel="stylesheet" href="${brand.basePath}/assets/engine.css">${admin ? `<link rel="stylesheet" href="${brand.basePath}/assets/editor/blog-editor.css">` : ''}<style nonce="${esc(nonce)}">:root{--blue:${brand.theme.accent};--accent:${brand.theme.accent};--ink:${brand.theme.ink};--paper:${brand.theme.paper}}</style><script nonce="${esc(nonce)}">window.BLOG_ENGINE=${json({ id: brand.id, brandId: brand.id, name: brand.name, brandName: brand.name, defaultAuthor: brand.defaultAuthor.name, timeZone:brand.timeZone, basePath: brand.basePath, approvedVoices: brand.voices.filter(voice => voice.approved).map(voice => ({ id: voice.id, name: voice.label })) })};</script></head>
<body data-brand="${esc(brand.id)}" ${admin ? 'class="admin-page"' : ''}><a class="skip-link" href="#main-content">Skip to content</a><header class="site-header wrap"><a class="brand" href="${brand.basePath}/">${brand.logo?`<img src="${esc(brand.logo.src)}" alt="${esc(brand.logo.alt)}" width="${brand.logo.width}" height="${brand.logo.height}">`:esc(brand.name)}</a><nav aria-label="Main navigation">${brand.navigation.map(link => `<a href="${esc(mountLink(link.href))}"${mountLink(link.href) === path ? ' aria-current="page"' : ''}>${esc(link.label)}</a>`).join('')}${admin ? `<a href="${brand.basePath}/admin/">Manage articles</a>` : ''}</nav></header>
${brand.previewNotice ? `<p class="preview-notice wrap">${esc(brand.previewNotice)}</p>` : ''}<main id="main-content">${body}</main><footer class="site-footer wrap"><p>${esc(brand.footer.text)}</p><nav aria-label="Footer">${brand.footer.links.map(link => `<a href="${esc(mountLink(link.href))}">${esc(link.label)}</a>`).join('')}</nav><small>Blog engine by CNERD</small></footer>
<script type="module" src="${brand.basePath}/assets/site.js"></script>${admin ? `<script type="module" src="${brand.basePath}/admin/manage.js"></script>` : ''}</body></html>`;
}
export function articleSchema(article) {
  const url = absolute(`${brand.basePath}/${article.slug}/`);
  const configuredAuthor = brand.defaultAuthor;
  const author = article.authorIdentity || (!article.author || article.author === configuredAuthor.name ? configuredAuthor : { type: article.authorType, name: article.author });
  return [{ '@context': 'https://schema.org', '@type': 'BlogPosting', '@id': `${url}#article`, mainEntityOfPage: url, headline: article.title,
    description: article.seoDescription || article.summary, datePublished: article.publishedAt, dateModified: article.modifiedAt || article.publishedAt,
    author: { ...(author.type ? { '@type': author.type } : {}), name: author.name, ...(author.url ? { url: absolute(author.url) } : {}) },
    publisher: { '@type': brand.publisher.type, '@id': `${brand.publicOrigin}/#publisher`, name: brand.publisher.name, ...(brand.publisher.url ? { url: absolute(brand.publisher.url) } : {}) },
    ...(article.heroImage ? { image: absolute(article.heroImage) } : {}), inLanguage: brand.language },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [[brand.name, `${brand.basePath}/`], [article.title, `${brand.basePath}/${article.slug}/`]].map(([name, path], index) => ({ '@type': 'ListItem', position: index + 1, name, item: absolute(path) })) }];
}
const publicArticles = blogs => blogs.filter(blog => blog.state === 'published' && blog.article && blog.publishedAt);
export function sitemap(blogs) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicArticles(blogs).length?`<url><loc>${esc(absolute(`${brand.basePath}/`))}</loc></url>`:""}${publicArticles(blogs).map(blog => `<url><loc>${esc(absolute(`${brand.basePath}/${blog.slug}/`))}</loc><lastmod>${esc(blog.modifiedAt || blog.publishedAt)}</lastmod></url>`).join('')}</urlset>`;
}
export function feed(blogs) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(brand.name)}</title><link>${esc(absolute(`${brand.basePath}/`))}</link><description>${esc(brand.description)}</description><language>${esc(brand.language)}</language>${publicArticles(blogs).map(blog => `<item><title>${esc(blog.title)}</title><link>${esc(absolute(`${brand.basePath}/${blog.slug}/`))}</link><guid isPermaLink="true">${esc(absolute(`${brand.basePath}/${blog.slug}/`))}</guid><description>${esc(blog.summary)}</description><pubDate>${esc(new Date(blog.publishedAt).toUTCString())}</pubDate></item>`).join('')}</channel></rss>`;
}
