import http from 'node:http';
import {readFileSync, existsSync, statSync, realpathSync} from 'node:fs';
import {resolve, relative, extname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {brand} from './brand.mjs';
import {db, hash, passwordMatches} from './db.mjs';
import {mounted, assetId, articlePath, mountHtml} from './routes.mjs';
import {allBlogs, getBlog, getBlogById, publishedBlogs, publishedBlog, blogAlias, blogAsset, blogLibrary, blogArticle, normalizeDraft, technicalChecks, adminBlogRoutes} from './blog.mjs';
import {adminArticles} from './admin-articles.mjs';
import {importRoutes} from './blog-import.mjs';
import {shell, articleSchema, sitemap, feed} from './render.mjs';
import {enrichImageHtml, ensureVariants} from './media.mjs';
import {prepareSocial, socialStatus, getSocialPack, socialPresets} from './social.mjs';
import {narrationExport, importNarration, publicNarrations, narrationAsset, adminNarrationRoutes, requestNarration, narrationJobStatus, narrationCapabilities, narrationJobPackage, importProducedNarration} from './narration.mjs';
import {esc, assetReferences} from './blog-document.mjs';
import {mediaLibrary,useMedia,uploadLibraryImage} from './media-library.mjs';

const version = '0.1.2';
const hostSession = process.env.CNERD_HOST_SESSION === '1';
if (hostSession && brand.id !== 'cnerd') throw new Error('CNERD host sessions require the CNERD installation.');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || new URL(brand.publicOrigin).port || 4310);
const cookieName = `blog_${brand.id.replace(/-/g, '_')}_session`;
const publicRoot = resolve('public');
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const isMutation = req => ['POST', 'PUT', 'DELETE'].includes(req.method);
const buckets = new Map();
let producerImports = 0;

export function json(res, status, value) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(value));
  return true;
}
async function readRaw(req, limit = 350000) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail('Upload exceeds its size limit.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readBody(req, limit) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail('Use application/json.', 415);
  try { return JSON.parse((await readRaw(req, limit)).toString('utf8')); } catch (error) { if (error.status) throw error; throw fail('Malformed JSON.'); }
}
function rate(req, operation, max, minutes) {
  const key = `${req.socket.remoteAddress}:${operation}`, now = Date.now();
  if (buckets.size > 10000) for (const [k, row] of buckets) if (row.expires <= now) buckets.delete(k);
  const row = buckets.get(key);
  if (!row || row.expires <= now) { buckets.set(key, {count: 1, expires: now + minutes * 60000}); return; }
  if (++row.count > max) throw fail('Too many requests. Try again later.', 429);
}
function session(req) {
  const cookies = new Map(String(req.headers.cookie || '').split(';').map(value => value.trim().split('=')));
  for (const name of [cookieName, ...(hostSession ? ['cnerd_session'] : [])]) {
    const token = cookies.get(name);
    if (!/^[a-f0-9]{64}$/.test(token || '')) continue;
    const current = db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(hash(token), Date.now());
    if (current) return current;
  }
  return null;
}
function requireSession(req) { if (!session(req)) throw fail('Sign in to manage this blog.', 401); }
function originCheck(req) { if (isMutation(req) && req.headers.origin !== brand.publicOrigin) throw fail('Request origin did not match this website.', 403); }
function integrationOwner(req) {
  const producerToken=String(req.headers.authorization||'').match(/^Bearer (cnerd_producer_[a-f0-9]{64})$/)?.[1];
  if(producerToken){const row=db.prepare('SELECT owner FROM blog_producer_tokens WHERE token_hash=?').get(hash(producerToken));if(!row)throw fail('Producer token was not recognized.',401);req.blogProducer=true;return row.owner;}
  const token = String(req.headers.authorization || '').match(/^Bearer (cnerd_blog_[a-f0-9]{64})$/)?.[1];
  const auth = token && db.prepare('SELECT owner FROM blog_import_tokens WHERE token_hash=?').get(hash(token));
  if (!auth) throw fail('A scoped blog integration token is required.', 401);
  return auth.owner;
}
function ownedDraft(id, owner) {
  const record = getBlogById(id), permission = db.prepare('SELECT owner FROM blog_import_ownership WHERE article_id=?').get(id);
  if (!record || record.state !== 'draft' || permission?.owner !== owner) throw fail('This integration draft is unavailable.', 404);
  return record;
}
function checkedDraft(data, owner) {
  if (data?.training !== undefined || data?.trainingDoc !== undefined) throw fail('Private training is not available to integrations.');
  const article = normalizeDraft(data, data?.slug);
  for (const ref of assetReferences(article)) {
    if (ref.url.includes('/api/admin/')) throw fail('Private assets cannot be imported.');
    const id = assetId(ref.url);
    if (!id) continue;
    const asset = blogAsset(id, true), record = asset && getBlog(asset.slug);
    const permission = record && db.prepare('SELECT owner FROM blog_import_ownership WHERE article_id=?').get(record.id);
    if (!asset || asset.visibility !== 'public' || permission?.owner !== owner) throw fail('Use an asset owned by this integration.');
  }
  return article;
}
function statusFor(record, integration=false) {
  return {brand: brand.id, articleId: record.id, revision: record.revision, publicationState: record.state, validation: technicalChecks(record.draft), social: integration?integrationPack(record,socialStatus(record)):publicPack(socialStatus(record)), audio: {...narrationJobStatus(record),draftSourceFingerprint:narrationExport(record.id,'draft').sourceFingerprint}};
}
function publicPack(pack) {
  if (!pack) return pack;
  const {zipPath, ...safe} = pack;
  safe.files = pack.files?.map(({path, ...file}) => file);
  return safe;
}
function integrationPack(record,pack) {
  const safe=publicPack(pack);
  if(safe?.images)safe.images=safe.images.map(image=>({...image,url:mounted('/api/integration/drafts/'+record.id+'/social/files/'+encodeURIComponent(image.name))}));
  if(safe?.exportUrl)safe.exportUrl=mounted('/api/integration/drafts/'+record.id+'/social-export');
  return safe;
}
function requestAudio(record, options) {
  if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== record.revision) throw fail('This article changed. Reload before preparing narration.', 409);
  return requestNarration(record, {...options, visibility:'draft', sourceFingerprint:options.sourceFingerprint || narrationExport(record.id,'draft').sourceFingerprint});
}
async function producerImport(req, record, job) {
  if (!req.blogProducer) throw fail('Use the scoped producer credential to import generated narration.', 403);
  rate(req, 'producer-import', 6, 60);
  if (producerImports >= 2) throw fail('Two narration imports are already validating. Try again shortly.', 429);
  producerImports++;
  try {
    const body=await readBody(req,56000000);
    if(Number(body.expectedRevision)!==getBlogById(record.id)?.revision)throw fail('This article changed. Reload before importing narration.',409);
    return await importProducedNarration(job.id,body.manifest,Buffer.from(body.audioBase64||'','base64'));
  } finally { producerImports--; }
}
function capabilities(producer=false) {
  return {brandId: brand.id, name: brand.name, publicOrigin: brand.publicOrigin, basePath: brand.basePath, version, contractVersion: 1, schemaVersion: 2, defaultAuthor: brand.defaultAuthor.name, brand:{id:brand.id,name:brand.name}, operations: producer?['narration:source','narration:import']:['validate', 'draft:create', 'draft:read', 'draft:update', 'asset:upload', 'social:prepare', 'social:export', 'narration:request'], limits: {image: 5000000, video: 18000000, download: 8000000}, nodes: ['paragraph','heading','bulletList','orderedList','taskList','blockquote','codeBlock','image','horizontalRule','cnerdBlock'], socialPresets, narration: narrationCapabilities(), connectedPosting: false};
}
function fileResponse(req, res, file, mime, {privateFile = false, downloadName, cacheControl} = {}) {
  if (!existsSync(file) || !statSync(file).isFile()) throw fail('Not found.', 404);
  const size = statSync(file).size;
  const headers = {'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': privateFile ? 'no-store' : cacheControl || 'public, max-age=3600', 'Accept-Ranges': 'bytes'};
  if (privateFile) headers['X-Robots-Tag'] = 'noindex,nofollow';
  if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`;
  let start = 0, end = size - 1, code = 200;
  if (req.headers.range) {
    const range = String(req.headers.range).match(/^bytes=(\d*)-(\d*)$/);
    if (!range || !range[1] && !range[2]) { res.writeHead(416, {'Content-Range': `bytes */${size}`}); res.end(); return true; }
    if (!range[1]) start = Math.max(0, size - Number(range[2]));
    else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    if (start >= size || start > end) { res.writeHead(416, {'Content-Range': `bytes */${size}`}); res.end(); return true; }
    code = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(code, headers); res.end(req.method === 'HEAD' ? undefined : readFileSync(file).subarray(start, end + 1)); return true;
}
function publicImage(asset) {
  const media=ensureVariants(asset),variant=media.variants.at(-1);
  return {file:variant.path,mime:variant.mime,width:variant.width,height:variant.height};
}
function staticFile(req, res, suffix) {
  const file = resolve(publicRoot, suffix.startsWith('editor/')||['inter-latin.woff2','favicon.svg'].includes(suffix)?'assets/'+suffix:suffix), rel = relative(publicRoot, file);
  if (rel.startsWith('..') || !existsSync(file) || !realpathSync(file).startsWith(realpathSync(publicRoot) + '/')) throw fail('Not found.', 404);
  const mime = {'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}[extname(file)];
  if (!mime) throw fail('Not found.', 404);
  return fileResponse(req, res, file, mime, {cacheControl: /^(admin\/|engine\.css$)/.test(suffix) ? 'no-cache' : undefined});
}
function page(req, res, options, status = 200) {
  const nonce = randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; media-src 'self'; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`);
  res.writeHead(status, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': options.admin ? 'no-store' : 'no-cache'});
  res.end(req.method === 'HEAD' ? undefined : shell({...options, nonce})); return true;
}

async function handle(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('X-Frame-Options', 'DENY');
  if (!['GET','HEAD','POST','PUT','DELETE'].includes(req.method)) throw fail('Method not allowed.', 405);
  const url = new URL(req.url, brand.publicOrigin), path = url.pathname;
  if (path.startsWith(mounted('/api/')) || path.startsWith(mounted('/admin'))) res.setHeader('X-Robots-Tag', 'noindex,nofollow');
  if (process.env.BLOG_EDITOR_WRITES === '0' && isMutation(req)) throw fail('Writes are disabled for recovery.', 503);
  if (path === '/' || path === brand.basePath) { res.writeHead(302, {Location: mounted('/')}); return res.end(); }
  if (path === '/robots.txt') { res.writeHead(200, {'Content-Type':'text/plain'}); return res.end(`User-agent: *\nAllow: ${mounted('/')}\nDisallow: ${mounted('/admin/')}\nDisallow: ${mounted('/api/')}\nSitemap: ${brand.publicOrigin}${mounted('/sitemap.xml')}\n`); }
  if (path === '/sitemap.xml' || path === mounted('/sitemap.xml')) { res.writeHead(200, {'Content-Type':'application/xml'}); return res.end(sitemap(publishedBlogs())); }
  if (path === mounted('/feed.xml')) { res.writeHead(200, {'Content-Type':'application/rss+xml; charset=utf-8'}); return res.end(feed(publishedBlogs())); }
  if (path === mounted('/admin/manage.js')) return staticFile(req,res,'admin/manage.js');
  if (path === mounted('/admin/article-list.js')) return staticFile(req,res,'admin/article-list.js');
  if (path.startsWith(mounted('/assets/'))) return staticFile(req, res, decodeURIComponent(path.slice(mounted('/assets/').length)));
  if (path === mounted('/api/health')) return json(res, 200, {ok:true, version, brand:brand.id});
  if (path === mounted('/api/auth')) {
    if (req.method === 'GET') return json(res, 200, {authenticated: !!session(req), brand: brand.id});
    originCheck(req);
    if (req.method === 'DELETE') { const current = session(req); if (current) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(current.token_hash); res.setHeader('Set-Cookie', [`${cookieName}=; Path=${mounted('/')}; HttpOnly; SameSite=Lax; Max-Age=0`, ...(hostSession ? ['cnerd_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure'] : [])]); return json(res, 200, {ok:true}); }
    if (req.method !== 'POST') throw fail('Method not allowed.', 405);
    rate(req, 'login', 8, 15);
    const body = await readBody(req, 4096), user = db.prepare('SELECT * FROM users WHERE username=?').get(body.username || 'owner');
    if (!user || !passwordMatches(body.password, user.password_hash)) throw fail('Password was not recognized.', 401);
    const token = randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.username, Date.now()+8*3600000);
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=${mounted('/')}; HttpOnly; SameSite=Lax; Max-Age=28800${brand.publicOrigin.startsWith('https:')?'; Secure':''}`);
    return json(res, 200, {ok:true});
  }
  const integrationPrefix = mounted('/api/integration');
  const legacyImport = path.startsWith('/api/blog-import/');
  if (path.startsWith(integrationPrefix + '/') || legacyImport) {
    const owner = integrationOwner(req); rate(req, 'integration', 120, 10);
    const rest = legacyImport ? path.slice('/api/blog-import'.length) : path.slice(integrationPrefix.length);
    if (rest === '/capabilities' && req.method === 'GET') return json(res,200,capabilities(!!req.blogProducer));
    if(req.blogProducer&&!/^\/drafts\/[a-f0-9-]{36}\/narration-jobs\/[a-f0-9-]{36}(?:\/import)?$/.test(rest))throw fail('Producer credentials can only read narration job sources and import their recordings.',403);
    if (rest === '/validate' && req.method === 'POST') { const body=await readBody(req,350000); const draft=checkedDraft(body.data,owner); return json(res,200,technicalChecks(draft)); }
    const derivative = rest.match(/^\/drafts\/([a-f0-9-]{36})\/(social\/files\/([a-zA-Z0-9._-]+)|narration-jobs\/([a-f0-9-]{36})(\/import)?)$/);
    if (derivative) {
      const record=ownedDraft(derivative[1],owner);
      if (derivative[3] && ['GET','HEAD'].includes(req.method)) { const pack=getSocialPack(record), file=pack?.files.find(f=>f.name===derivative[3]);if(!file)throw fail('Not found.',404);return fileResponse(req,res,file.path,file.mime,{privateFile:true}); }
      if (derivative[4]) {
        const job=narrationJobPackage(derivative[4]);if(job.articleId!==record.id||job.visibility!=='draft')throw fail('Narration job not available to this integration.',404);
        if(!derivative[5]&&req.method==='GET')return json(res,200,job);
        if(derivative[5]&&req.method==='POST')return json(res,201,await producerImport(req,record,job));
      }
      throw fail('Method not allowed.',405);
    }
    const extra = rest.match(/^\/drafts\/([a-f0-9-]{36})\/(social|status|narration|narration-import|social-export)$/);
    if (extra) {
      const record = ownedDraft(extra[1],owner), action=extra[2];
      if (action==='status' && req.method==='GET') return json(res,200,statusFor(record,true));
      if (action==='social-export' && ['GET','HEAD'].includes(req.method)) { const pack=getSocialPack(record); if(!pack)throw fail('Prepare a social pack first.',404); return fileResponse(req,res,pack.zipPath,'application/zip',{privateFile:true,downloadName:`${brand.id}-${record.slug}-social.zip`}); }
      if (action==='social' && req.method==='POST') { const body=await readBody(req,16000); const pack=await prepareSocial(getBlogById(record.id),body); return json(res,200,{...integrationPack(record,pack),exportUrl:brand.publicOrigin+integrationPrefix+'/drafts/'+record.id+'/social-export'}); }
      if (action==='narration' && req.method==='POST') return json(res,202,requestAudio(record,await readBody(req,16000)));
      if (action==='narration-import') throw fail('Use the scoped producer job import endpoint.',403);
      throw fail('Method not allowed.',405);
    }
    const internal = new URL(url); internal.pathname='/api/blog-import'+rest;
    if (await importRoutes(req,res,internal,{readBody,readRaw,json,rate,base:brand.publicOrigin})) return;
    throw fail('Not found.',404);
  }
  if (path === mounted('/admin/') || path === mounted('/admin')) return page(req,res,{title:brand.name+' Blog editor',description:'Manage your articles.',body:'<div class="wrap" id="blog-manager"></div>',path:mounted('/admin/'),admin:true,robots:'noindex,nofollow'});
  if (path.startsWith(mounted('/api/admin/'))) {
    requireSession(req); originCheck(req);
    if (path===mounted('/api/admin/media')){
      if(req.method==='POST'){rate(req,'library-upload',30,10);return json(res,200,uploadLibraryImage(await readBody(req,7200000)));}
      if(req.method==='GET')return json(res,200,mediaLibrary({privateView:false}).items);
      throw fail('Method not allowed.',405);
    }
    if (path===mounted('/api/admin/media-library')&&req.method==='GET')return json(res,200,mediaLibrary(Object.fromEntries(url.searchParams)));
    const useMediaRoute=path.match(new RegExp('^'+mounted('/api/admin/blog/')+'([a-z0-9-]+)/use-media$'));
    if(useMediaRoute&&req.method==='POST'){rate(req,'blog-use-media',120,10);return json(res,200,useMedia(useMediaRoute[1],await readBody(req,4096)));}
    const socialFile=path.match(new RegExp('^'+mounted('/api/admin/blog/')+'([a-z0-9-]+)/social/files/([a-zA-Z0-9._-]+)$'));
    if(socialFile){const record=getBlog(socialFile[1]),pack=record&&getSocialPack(record),file=pack?.files.find(f=>f.name===socialFile[2]);if(!file)throw fail('Not found.',404);return fileResponse(req,res,file.path,file.mime,{privateFile:true});}
    if (path===mounted('/api/admin/blog-preview') && req.method==='POST') {
      const body=await readBody(req,2000000), article=normalizeDraft(body.data,body.data?.slug);
      if(body.training) article.bodyDoc=article.trainingDoc;
      return json(res,200,{html:enrichImageHtml(mountHtml(blogArticle(article),{privatePreview:true}),id=>blogAsset(id,true),{privatePreview:true})});
    }
    const privateAsset=path.match(new RegExp('^'+mounted('/api/admin/blog/assets/')+'([a-f0-9]{32})(?:/variants/([1-9][0-9]{0,4})\\.jpg)?$'));
    if(privateAsset){const asset=blogAsset(privateAsset[1],true);if(!asset)throw fail('Not found.',404); if(privateAsset[2]){const v=ensureVariants(asset).variants.find(v=>v.width===Number(privateAsset[2]));if(!v)throw fail('Not found.',404);return fileResponse(req,res,v.path,v.mime,{privateFile:true});}return fileResponse(req,res,asset.path,asset.mime,{privateFile:true});}
    const extra=path.match(new RegExp('^'+mounted('/api/admin/blog/')+'([a-z0-9-]+)/(social|status|narration|social-export|social/export)$'));
    if(extra){const record=getBlog(extra[1]);if(!record)throw fail('Not found.',404);const action=extra[2];
      if(action==='status'&&req.method==='GET')return json(res,200,statusFor(record));
      if(action==='social'&&req.method==='POST'){const pack=await prepareSocial(record,await readBody(req,16000));return json(res,200,{...publicPack(pack),exportUrl:mounted('/api/admin/blog/'+record.slug+'/social-export')});}
      if((action==='social-export'||action==='social/export')&&['GET','HEAD'].includes(req.method)){const pack=getSocialPack(record);if(!pack)throw fail('Prepare a social pack first.',404);return fileResponse(req,res,pack.zipPath,'application/zip',{privateFile:true,downloadName:`${brand.id}-${record.slug}-social.zip`});}
      if(action==='narration'&&req.method==='POST')return json(res,202,requestAudio(record,await readBody(req,16000)));
      throw fail('Method not allowed.',405);
    }
    if(path === mounted('/api/admin/blog') && req.method === 'GET')return json(res,200,adminArticles());
    const internal=new URL(url);internal.pathname=path.slice(brand.basePath.length);
    if(await adminNarrationRoutes(req,res,internal,{readBody,json,rate,serveFile:(req,res,path,mime)=>fileResponse(req,res,path,mime,{privateFile:true})}))return;
    if(await adminBlogRoutes(req,res,internal,{readBody,readRaw,json,rate}))return;
    throw fail('Not found.',404);
  }
  const libraryImage=path.match(new RegExp('^'+mounted('/library-media/')+'([a-f0-9]{32}\\.(?:png|jpg|webp))$'));
  if(libraryImage){const row=db.prepare('SELECT mime,path FROM media WHERE path=?').get(path);if(!row)throw fail('Not found.',404);return fileResponse(req,res,resolve(process.env.DATA_DIR||'private','media',libraryImage[1]),row.mime);}
  const discover=path.match(new RegExp('^'+mounted('/api/narration/')+'([a-z0-9-]+)$'));
  if(discover&&req.method==='GET'){const result=publicNarrations(discover[1]);if(!result)throw fail('Not found.',404);return json(res,200,result);}
  const audio=path.match(new RegExp('^(?:'+mounted('/narration/')+'|/blog-narration/)([a-f0-9-]{32,36})/(audio|manifest)$'));
  if(audio){const asset=narrationAsset(audio[1]);if(!asset)throw fail('Not found.',404);return audio[2]==='audio'?fileResponse(req,res,asset.path,'audio/mpeg'):json(res,200,asset.manifest);}
  const image=path.match(new RegExp('^(?:'+mounted('/media/')+'|/blog-media/)([a-f0-9]{32})(?:/variants/([1-9][0-9]{0,4})\\.jpg)?$'));
  if(image){const asset=blogAsset(image[1],false);if(!asset)throw fail('Not found.',404);if(image[2]){const v=ensureVariants(asset).variants.find(v=>v.width===Number(image[2]));if(!v)throw fail('Not found.',404);return fileResponse(req,res,v.path,v.mime);}if(asset.kind==='image'){const clean=publicImage(asset);return fileResponse(req,res,clean.file,clean.mime);}return fileResponse(req,res,asset.path,asset.mime);}
  if(!['GET','HEAD'].includes(req.method))throw fail('Method not allowed.',405);
  if(path===mounted('/')){
    const blogs=publishedBlogs(),q=(url.searchParams.get('q')||'').slice(0,160),topic=(url.searchParams.get('topic')||'').slice(0,80),pageNumber=Math.max(1,Number(url.searchParams.get('page'))||1);
    const robots=q||topic||!blogs.length?'noindex,follow':undefined;if(robots)res.setHeader('X-Robots-Tag',robots);
    if(!q&&!topic&&pageNumber>Math.max(1,Math.ceil(blogs.length/12)))throw fail('Article page not found.',404);
    const body=enrichImageHtml(mountHtml(blogLibrary(blogs,{query:q,topic,page:pageNumber})),id=>blogAsset(id));
    return page(req,res,{title:brand.name+' Blog',description:brand.description||'Stories and useful ideas from '+brand.name,body,path:mounted('/')+(!q&&!topic&&pageNumber>1?'?page='+pageNumber:''),robots});
  }
  const articleMatch=path.match(new RegExp('^'+brand.basePath+'/([a-z0-9-]+)(/preview|/)?$'));
  if(articleMatch){const slug=articleMatch[1],preview=articleMatch[2]==='/preview';
    if(preview){requireSession(req);const record=getBlog(slug);if(!record)throw fail('Not found.',404);const article={...record.draft};if(url.searchParams.get('training')==='1')article.bodyDoc=article.trainingDoc;
      res.setHeader('X-Robots-Tag','noindex,nofollow');const body=enrichImageHtml(mountHtml(blogArticle(article),{privatePreview:true}),id=>blogAsset(id,true),{privatePreview:true});
      return page(req,res,{title:'Preview: '+article.title,description:article.summary,body,path,admin:true,robots:'noindex,nofollow'});
    }
    const blog=publishedBlog(slug);
    if(!blog){const alias=blogAlias(slug);if(alias){res.writeHead(301,{Location:articlePath(alias)});return res.end();}throw fail('Article not found.',404);}
    if(articleMatch[2]!=='/'){res.writeHead(301,{Location:articlePath(slug)});return res.end();}
    const article={...blog.article,id:blog.id,publishedAt:blog.publishedAt,modifiedAt:blog.modifiedAt};
    const related=publishedBlogs().filter(b=>b.slug!==slug).slice(0,3),body=enrichImageHtml(mountHtml(blogArticle(article,related,{base:brand.publicOrigin,settings:{}})),id=>blogAsset(id));
    const shareUrl=article.socialImage||article.heroImage,shareAsset=shareUrl&&blogAsset(assetId(shareUrl));
    const shareImage=shareAsset?{url:shareUrl,...publicImage(shareAsset)}:shareUrl;
    return page(req,res,{title:article.seoTitle||article.title+' — '+brand.name,description:article.seoDescription||article.summary,body,path:articlePath(slug),schema:articleSchema(article),image:shareImage,imageAlt:article.socialImageAlt||article.heroAlt,publishedAt:blog.publishedAt,modifiedAt:blog.modifiedAt});
  }
  throw fail('Not found.',404);
}

export const server=http.createServer((req,res)=>handle(req,res).catch(error=>{
  if(res.headersSent){res.end();return;}
  if(!error.status)console.error(error.stack);
  const status=error.status||500;
  if(req.url.includes('/api/'))json(res,status,{error:error.status?error.message:'The operation failed. Your saved work is preserved.'});
  else page(req,res,{title:status===404?'Page not found':'Unable to open this page',description:'',path:req.url,body:`<div class="wrap"><h1>${status===404?'Page not found':'Unable to open this page'}</h1><p>${esc(error.status?error.message:'Please try again.')}</p><a href="${mounted('/')}">All articles</a></div>`,robots:'noindex,nofollow'},status);
}));
server.listen(port,host,()=>console.log(`CNERD Blog Engine ${version} (${brand.id}) listening at ${brand.publicOrigin}${mounted('/')}`));
