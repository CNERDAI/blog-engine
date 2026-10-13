import {brand} from './brand.mjs';
import {assetId,assetPath,mounted} from './routes.mjs';
import {articleQuality} from './validation.mjs';
import {inspectImage} from './media.mjs';
import {validPublicationDate,formatArticleDate} from '../public/article-date.js';
import {articleSharing} from './blog-sharing.mjs';
import {blogDeletionImpact,deleteBlog} from './admin-deletion.mjs';
import {narrationSource} from './narration-source.mjs';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { dataDir, db } from './db.mjs';
import {nodeText,assetReferences,renderBlock,normalBlock, validateDoc, contentBlocks, renderNode, safeUrl as validUrl} from './blog-document.mjs';

const assetRoot=resolve(dataDir,'blog-assets');
mkdirSync(assetRoot,{recursive:true,mode:0o700});
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const clean=value=>String(value||'').trim();
const slugOk=value=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const blockIdOk=value=>/^b_[a-z0-9]{8,40}$/.test(value);
const safeUrl=validUrl;
const localAssetIds=value=>{const id=assetId(String(value||''));return id?[id]:[];};
const paragraph=value=>esc(value).split(/\n{2,}/).filter(Boolean).map(line=>`<p>${line.replace(/\n/g,'<br>')}</p>`).join('');
const words=value=>String(value||'').trim().split(/\s+/).filter(Boolean).length;
function blockWords(block){
 if(block.type==='text'||block.type==='rich'||block.type==='callout')return words(`${block.heading||block.title||''} ${block.body||''}`);
 if(block.type==='prompt')return words(`${block.title||''} ${block.content||''}`);
 if(block.type==='workflow')return words(`${block.outcome||''} ${block.prerequisites?.join(' ')||''} ${block.tools?.join(' ')||''} ${(block.steps||[]).map(step=>`${step.title} ${step.instructions} ${step.prompt} ${step.expected}`).join(' ')}`);
 if(block.type==='checklist')return words(`${block.title||''} ${(block.items||[]).map(item=>`${item.label} ${item.details}`).join(' ')}`);
 if(block.type==='table')return words(`${(block.headings||[]).join(' ')} ${(block.rows||[]).flat().join(' ')}`);
 return 0;
}
const articleWords=article=>contentBlocks(article).reduce((total,block)=>total+blockWords(block),0);
const readJson=row=>row?JSON.parse(row):null;

db.exec(`CREATE TABLE IF NOT EXISTS blogs(
 slug TEXT PRIMARY KEY,
 draft_json TEXT NOT NULL,
 public_json TEXT,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
 revision INTEGER NOT NULL DEFAULT 1,
 published_at TEXT,
 modified_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 archived_at TEXT
);
CREATE TABLE IF NOT EXISTS blog_revisions(
 id INTEGER PRIMARY KEY,
 slug TEXT NOT NULL,
 draft_json TEXT NOT NULL,
 public_json TEXT,
 revision INTEGER NOT NULL,
 action TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS blog_revisions_slug ON blog_revisions(slug,id DESC);
CREATE TABLE IF NOT EXISTS blog_assets(
 id TEXT PRIMARY KEY,
 slug TEXT NOT NULL,
 name TEXT NOT NULL,
 mime TEXT NOT NULL,
 bytes INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('image','video','download')),
 visibility TEXT NOT NULL CHECK(visibility IN ('public','training')),
 file TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS blog_assets_slug ON blog_assets(slug,created_at DESC);`);
db.exec(`CREATE TABLE IF NOT EXISTS blog_aliases(
 alias TEXT PRIMARY KEY,
 slug TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS blog_aliases_slug ON blog_aliases(slug);`);

if(!db.prepare('PRAGMA table_info(blogs)').all().some(c=>c.name==='article_id')){db.exec('BEGIN IMMEDIATE');try{db.exec('ALTER TABLE blogs ADD COLUMN article_id TEXT');for(const row of db.prepare('SELECT slug FROM blogs').all())db.prepare('UPDATE blogs SET article_id=? WHERE slug=?').run(randomUUID(),row.slug);db.exec('CREATE UNIQUE INDEX IF NOT EXISTS blogs_article_id ON blogs(article_id)');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}

function fail(message,status=400){return Object.assign(new Error(message),{status});}
function bounded(value,length=500){return clean(value).slice(0,length);}
function lines(value,max=12,length=120){return String(value||'').split('\n').map(item=>clean(item)).filter(Boolean).slice(0,max).map(item=>item.slice(0,length));}
export function normalizeDraft(input,slug){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Use a blog draft object.');
 const v2=input.schemaVersion===2;
 const blocks=v2?[]:Array.isArray(input.blocks)?input.blocks.slice(0,80).map(normalBlock):[];
 const training=v2?[]:Array.isArray(input.training)?input.training.slice(0,80).map(normalBlock):[];
 const topics=[...new Set((Array.isArray(input.topics)?input.topics:String(input.topics||'').split(',')).map(topic=>bounded(topic,60)).filter(Boolean))].slice(0,8);
 const desiredSlug=clean(input.slug||slug);
 if(!slugOk(desiredSlug)||['admin','api','assets','media','narration','stories','work','landing'].includes(desiredSlug))throw fail('Use a lowercase URL with letters, numbers, and single hyphens.');
 const draft={slug:desiredSlug,title:bounded(input.title,180),summary:bounded(input.summary,500),author:bounded(input.author,120)||brand.defaultAuthor.name,topics,heroImage:bounded(input.heroImage,1000),seoTitle:bounded(input.seoTitle,70),seoDescription:bounded(input.seoDescription,160),blocks,training};
 draft.heroAlt=bounded(input.heroAlt,220);draft.heroDecorative=input.heroDecorative===true;draft.socialImage=bounded(input.socialImage,1000);draft.socialImageAlt=bounded(input.socialImageAlt,220);draft.authorType=input.authorType==='Organization'||draft.author===brand.defaultAuthor.name&&brand.defaultAuthor.type==='Organization'?'Organization':'Person';if(input.focalPoint&&[input.focalPoint.x,input.focalPoint.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))draft.focalPoint={x:input.focalPoint.x,y:input.focalPoint.y};
 if(draft.socialImage&&!safeUrl(draft.socialImage))throw fail('Choose a valid social image.');
 if(input.publishedAt!==undefined){try{draft.publishedAt=validPublicationDate(input.publishedAt);}catch(error){throw fail(error.message);}}
 if(v2){draft.schemaVersion=2;draft.bodyDoc=validateDoc(input.bodyDoc);draft.trainingDoc=validateDoc(input.trainingDoc||{type:'doc',content:[]});delete draft.blocks;delete draft.training;}
 if(draft.heroImage&&!safeUrl(draft.heroImage))throw fail('Choose a valid feature image.');
 if(!draft.title)throw fail('A title is required.');
 return draft;
}
function publicSnapshot(draft){const {training,trainingDoc,...publicDraft}=draft;return publicDraft;}
function listRows(includeArchived=false){return db.prepare(`SELECT * FROM blogs ${includeArchived?'':'WHERE state<>\'archived\''} ORDER BY COALESCE(published_at,updated_at) DESC,slug`).all();}
function display(row){const draft=readJson(row.draft_json),published=readJson(row.public_json);return {id:row.article_id,slug:row.slug,title:draft.title,summary:draft.summary,author:draft.author,topics:draft.topics,heroImage:draft.heroImage,state:row.state,revision:row.revision,publishedAt:row.published_at,modifiedAt:row.modified_at,updatedAt:row.updated_at,archivedAt:row.archived_at,hasUnpublished:row.state==='published'&&JSON.stringify({...publicSnapshot(draft),publishedAt:draft.publishedAt||row.published_at})!==JSON.stringify({...published,publishedAt:published?.publishedAt||row.published_at})};}
export function allBlogs(includeArchived=false){return listRows(includeArchived).map(display);}
export function getBlog(slug,includeArchived=true){const row=db.prepare('SELECT * FROM blogs WHERE slug=?').get(slug);return row&&(includeArchived||row.state!=='archived')?{...display(row),draft:{...readJson(row.draft_json),...(row.published_at&&readJson(row.draft_json).publishedAt===undefined?{publishedAt:row.published_at}:{})},published:readJson(row.public_json)}:null;}
export function getBlogById(id){const row=db.prepare('SELECT slug FROM blogs WHERE article_id=?').get(id);return row?getBlog(row.slug):null;}
export function publishedBlogs(){return listRows().filter(row=>row.state==='published'&&row.public_json).map(row=>({...display({...row,draft_json:row.public_json}),article:readJson(row.public_json)}));}
export function publishedBlog(slug){const row=db.prepare("SELECT * FROM blogs WHERE slug=? AND state='published' AND public_json IS NOT NULL").get(slug);return row?{...display({...row,draft_json:row.public_json}),article:readJson(row.public_json)}:null;}
export function blogAlias(slug){const alias=db.prepare('SELECT slug FROM blog_aliases WHERE alias=?').get(slug);return alias&&publishedBlog(alias.slug)?alias.slug:null;}
function checkAssetReference(url,visibility='public',kind=''){
 if(visibility==='public'&&String(url).includes('/api/admin/'))throw fail('Public content cannot reference a private asset URL.');
 if(kind==='image'&&String(url).startsWith('/')&&!assetId(url)){const local=String(url).replace(mounted('/assets/'),'/assets/');if(!local.startsWith('/assets/')||!existsSync(resolve('public',local.slice(1))))throw fail('Choose an uploaded image or a real bundled image.');}

 for(const id of localAssetIds(url)){const asset=blogAsset(id,true);if(!asset||asset.visibility!==visibility||kind&&asset.kind!==kind)throw fail('Choose an asset available to this part of the article.');const path=String(url).startsWith('http')?new URL(url).pathname:String(url);if(visibility==='public'&&![assetPath(id),'/blog-media/'+id].includes(path))throw fail('Use the mounted public URL for this asset.');}
}
function checkAssets(article,visibility='public'){
 for(const reference of assetReferences(article))checkAssetReference(reference.url,visibility,reference.kind);
}
export function technicalChecks(draft){
 const quality=articleQuality(draft),warnings=quality.warnings.map(i=>i.message),errors=quality.errors.map(i=>i.message);if(!draft.title||draft.title.length<10)errors.push('Use a clear title of at least 10 characters.');if(!draft.summary||draft.summary.length<30)errors.push('Add a reader-facing summary of at least 30 characters.');if(!contentBlocks(draft).length||!contentBlocks(draft).some(b=>b.type!=='rich'||b.body.trim()||['horizontalRule'].includes(b.node.type)))errors.push('Add at least one public content block.');if(draft.seoTitle&&draft.seoTitle.length>60)warnings.push('SEO title is longer than the usual search-result display.');if(draft.seoDescription&&draft.seoDescription.length>155)warnings.push('SEO description may be truncated in search results.');if(!draft.heroImage)warnings.push('Add a feature image for richer social sharing.');if(!draft.topics.length)warnings.push('Add one or more topics to improve related articles.');if(articleWords(draft)<180)warnings.push('The public article is short; consider adding context, examples, or useful steps.');try{checkAssets(draft,'public');}catch(error){errors.push(error.message);}try{checkAssets(draft.schemaVersion===2?{schemaVersion:2,heroImage:'',bodyDoc:draft.trainingDoc}:{heroImage:'',blocks:draft.training},'training');}catch(error){errors.push(error.message);}return {passed:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)],issues:{errors:quality.errors,warnings:quality.warnings}};
}
function revision(row,action){db.prepare('INSERT INTO blog_revisions(slug,draft_json,public_json,revision,action) VALUES(?,?,?,?,?)').run(row.slug,row.draft_json,row.public_json,row.revision,action);}
function assertRevision(row,revisionValue){if(!row&&Number(revisionValue)!==0)throw fail('This article no longer exists. Reload before saving. Your draft is still here.',409);if(row&&row.revision!==Number(revisionValue))throw fail('This article changed in another window. Reload before saving. Your draft is still here.',409);}
function slugAvailable(slug,except=''){const row=db.prepare('SELECT slug FROM blogs WHERE slug=?').get(slug),alias=db.prepare('SELECT alias FROM blog_aliases WHERE alias=?').get(slug);if((row&&row.slug!==except)||alias)throw fail('That URL is already in use. Choose another one.',409);}
function renameRecord(row,next,{keepRedirect=false}={}){
 if(row.slug===next)return row;
 slugAvailable(next,row.slug);
 db.prepare('UPDATE blogs SET slug=? WHERE slug=?').run(next,row.slug);
 db.prepare('UPDATE blog_revisions SET slug=? WHERE slug=?').run(next,row.slug);
 db.prepare('UPDATE blog_assets SET slug=? WHERE slug=?').run(next,row.slug);
 db.prepare('UPDATE blog_aliases SET slug=? WHERE slug=?').run(next,row.slug);
 if(keepRedirect)db.prepare('INSERT OR REPLACE INTO blog_aliases(alias,slug) VALUES(?,?)').run(row.slug,next);
 return db.prepare('SELECT * FROM blogs WHERE slug=?').get(next);
}
export function saveBlog(slug,input,revisionValue,afterSave=()=>{}){
 if(!slugOk(slug))throw fail('Use a valid article URL.');const draft=normalizeDraft(input,slug);db.exec('BEGIN IMMEDIATE');try{let row=db.prepare('SELECT * FROM blogs WHERE slug=?').get(slug);assertRevision(row,revisionValue);if(row&&input.publishedAt===undefined){const before=readJson(row.draft_json);if(before.publishedAt!==undefined||row.published_at)draft.publishedAt=before.publishedAt!==undefined?before.publishedAt:row.published_at;}if(row)revision(row,'save');if(row&&row.state!=='published'&&row.slug!==draft.slug)row=renameRecord(row,draft.slug);if(!row){slugAvailable(draft.slug);db.prepare('INSERT INTO blogs(slug,draft_json,public_json,state,revision,published_at,modified_at,archived_at,updated_at) VALUES(?,?,?,?,1,NULL,NULL,NULL,CURRENT_TIMESTAMP)').run(draft.slug,JSON.stringify(draft),null,'draft');db.prepare('UPDATE blogs SET article_id=? WHERE slug=?').run(randomUUID(),draft.slug);afterSave(getBlog(draft.slug));db.exec('COMMIT');return getBlog(draft.slug);}const state=row.state==='archived'?'archived':row.state;db.prepare('UPDATE blogs SET draft_json=?,state=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE slug=?').run(JSON.stringify(draft),state,row.slug);afterSave(getBlog(row.slug));db.exec('COMMIT');return getBlog(row.slug);}catch(error){db.exec('ROLLBACK');throw error;}
}
export function publishBlog(slug,revisionValue){db.exec('BEGIN IMMEDIATE');try{let row=db.prepare('SELECT * FROM blogs WHERE slug=?').get(slug);if(!row)throw fail('Article not found.',404);assertRevision(row,revisionValue);const draft=readJson(row.draft_json),checks=technicalChecks(draft);if(!checks.passed)throw fail(checks.errors.join(' '));revision(row,'publish');if(row.slug!==draft.slug)row=renameRecord(row,draft.slug,{keepRedirect:row.state==='published'});const timestamp=now(),date=draft.publishedAt||row.published_at||timestamp;if(Date.parse(date)>Date.now())throw fail('Article date is in the future. Choose a past/current date; this does not schedule publication.');draft.publishedAt=date;const snapshot=JSON.stringify(publicSnapshot(draft));db.prepare("UPDATE blogs SET draft_json=?,public_json=?,state='published',revision=revision+1,published_at=?,modified_at=?,archived_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE slug=?").run(JSON.stringify(draft),snapshot,date,timestamp,row.slug);db.exec('COMMIT');return {...getBlog(row.slug),checks};}catch(error){db.exec('ROLLBACK');throw error;}}
export function archiveBlog(slug,revisionValue){db.exec('BEGIN IMMEDIATE');try{const row=db.prepare('SELECT * FROM blogs WHERE slug=?').get(slug);if(!row)throw fail('Article not found.',404);assertRevision(row,revisionValue);revision(row,'archive');db.prepare("UPDATE blogs SET state='archived',revision=revision+1,archived_at=?,updated_at=CURRENT_TIMESTAMP WHERE slug=?").run(now(),slug);db.exec('COMMIT');return getBlog(slug);}catch(error){db.exec('ROLLBACK');throw error;}}
export function duplicateBlog(slug){const source=getBlog(slug);if(!source)throw fail('Article not found.',404);let copySlug=`${slug}-copy`,suffix=2;while(getBlog(copySlug))copySlug=`${slug}-copy-${suffix++}`;const copy={...source.draft,slug:copySlug,title:`${source.draft.title} (copy)`,publishedAt:null};return saveBlog(copySlug,copy,0);}
export function revisions(slug){return db.prepare('SELECT id,revision,action,created_at FROM blog_revisions WHERE slug=? ORDER BY id DESC LIMIT 50').all(slug);}
export function restoreRevision(slug,id,revisionValue){db.exec('BEGIN IMMEDIATE');try{const row=db.prepare('SELECT * FROM blogs WHERE slug=?').get(slug),old=db.prepare('SELECT * FROM blog_revisions WHERE slug=? AND id=?').get(slug,Number(id));if(!row||!old)throw fail('Revision not found.',404);assertRevision(row,revisionValue);revision(row,'restore');db.prepare("UPDATE blogs SET draft_json=?,state=CASE WHEN public_json IS NOT NULL AND state='published' THEN 'published' ELSE 'draft' END,revision=revision+1,archived_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE slug=?").run(old.draft_json,slug);db.exec('COMMIT');return getBlog(slug);}catch(error){db.exec('ROLLBACK');throw error;}}

export function fileInfo(buffer,type,name){
 const lower=clean(name).toLowerCase(),image=type==='image',video=type==='video',download=type==='download';
 if(image){if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {extension:'png',mime:'image/png'};if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return {extension:'jpg',mime:'image/jpeg'};if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return {extension:'webp',mime:'image/webp'};}
 if(video&&buffer.toString('ascii',4,8)==='ftyp')return {extension:'mp4',mime:'video/mp4'};
 if(download&&buffer.toString('ascii',0,5)==='%PDF-')return {extension:'pdf',mime:'application/pdf'};
 if(download&&lower.endsWith('.json')){try{JSON.parse(buffer.toString('utf8'));return {extension:'json',mime:'application/json'};}catch{throw fail('The JSON upload is invalid.');}}
 if(download&&lower.endsWith('.txt')&&!buffer.includes(0))return {extension:'txt',mime:'text/plain; charset=utf-8'};
 throw fail('Choose a valid PNG, JPEG, WebP, MP4, PDF, JSON, or TXT file.');
}
export function uploadBlogAsset(slug,input,rawBuffer){const blog=getBlog(slug);if(!blog)throw fail('Save the article before adding media.',404);const kind=['image','video','download'].includes(input.kind)?input.kind:'';const visibility=input.visibility==='training'?'training':'public';const buffer=rawBuffer||Buffer.from(String(input.base64||''),'base64'),limit=kind==='video'?18_000_000:kind==='download'?8_000_000:5_000_000;if(!kind||!buffer.length||buffer.length>limit)throw fail(`Choose a ${kind} under ${Math.floor(limit/1_000_000)} MB.`);const info=fileInfo(buffer,kind,input.name);if(kind==='image')inspectImage(buffer);const id=randomBytes(16).toString('hex'),file=`${id}.${info.extension}`,target=resolve(assetRoot,file),name=bounded(input.name,150)||file;writeFileSync(target,buffer,{mode:0o600});try{db.prepare('INSERT INTO blog_assets(id,slug,name,mime,bytes,kind,visibility,file) VALUES(?,?,?,?,?,?,?,?)').run(id,slug,name,info.mime,buffer.length,kind,visibility,file);}catch(error){if(existsSync(target))unlinkSync(target);throw error;}return {id,slug,name,mime:info.mime,bytes:buffer.length,kind,visibility,path:visibility==='public'?assetPath(id):assetPath(id,true)};}
export function assetsFor(slug){return db.prepare('SELECT id,slug,name,mime,bytes,kind,visibility,created_at FROM blog_assets WHERE slug=? ORDER BY created_at DESC').all(slug).map(asset=>({...asset,path:asset.visibility==='public'?assetPath(asset.id):assetPath(asset.id,true)}));}
function publicUsesAsset(id){return publishedBlogs().some(blog=>assetReferences(blog.article).some(ref=>localAssetIds(ref.url).includes(id)));}
export function blogAsset(id,admin=false){const asset=db.prepare('SELECT * FROM blog_assets WHERE id=?').get(id);if(!asset||(!admin&&(asset.visibility!=='public'||!publicUsesAsset(id)))||!existsSync(resolve(assetRoot,asset.file)))return null;return {...asset,path:resolve(assetRoot,asset.file)};}

function readingMinutes(article){return Math.max(1,Math.ceil(articleWords(article)/220));}
function readerControls(saved=false){return `<section class="blog-reader" data-reader aria-label="Listen to this article"><p class="eyebrow" data-reader-kind>AI NARRATION</p><label class="reader-voice-label" hidden data-reader-voice-label>Voice<select data-reader-voice aria-label="Narration voice"></select></label><div class="blog-reader-controls"><button type="button" class="reader-icon-button" data-reader-action="back" ${saved?'disabled':''} aria-label="Read the previous section" title="Previous section">↺</button><button type="button" class="reader-play-button" data-reader-action="listen" ${saved?'disabled':''} aria-label="Listen to this article"><span data-reader-listen-label aria-hidden="true">▶</span></button><button type="button" class="reader-icon-button" data-reader-action="forward" ${saved?'disabled':''} aria-label="Read the next section" title="Next section">↻</button><span class="blog-reader-status" data-reader-status role="status" aria-live="polite">${saved?'Loading saved narration…':'Ready to listen'}</span></div><label class="reader-scrubber"><span class="sr-only">Reading position</span><input type="range" min="0" max="100" value="0" data-reader-seek ${saved?'disabled':''} aria-label="Reading position"><span data-reader-time>0:00 / estimate</span></label><div class="reader-speeds" aria-label="Reader speed"><button type="button" data-reader-rate="1" ${saved?'disabled':''} aria-pressed="true">1x</button><button type="button" data-reader-rate="1.25" ${saved?'disabled':''} aria-pressed="false">1.25x</button><button type="button" data-reader-rate="1.5" ${saved?'disabled':''} aria-pressed="false">1.5x</button><button type="button" data-reader-rate="2" ${saved?'disabled':''} aria-pressed="false">2x</button></div><button type="button" class="reader-setting-button" data-reader-browser hidden>Use browser reading</button><details class="blog-reader-settings"><summary>Reader settings</summary><div><label class="reader-follow-label"><input type="checkbox" data-reader-follow checked>Follow narrator</label><span class="reader-follow-help">Press Esc to browse freely while listening.</span><span class="sr-only" data-follow-status role="status"></span><button type="button" class="reader-icon-button" data-reader-font="-1" aria-label="Decrease text size" title="Decrease text size">A-</button><button type="button" class="reader-icon-button" data-reader-font="1" aria-label="Increase text size" title="Increase text size">A+</button><button type="button" class="reader-setting-button" data-reader-spacing aria-pressed="false">Line spacing</button><button type="button" class="reader-setting-button" data-reader-contrast aria-pressed="false">High contrast</button></div></details></section>`;}
export function blogLibrary(articles,{query='',topic='',page=1}={}){
 const terms=clean(query).toLowerCase(),selected=clean(topic),filtered=articles.filter(article=>!terms||[article.title,article.summary,article.topics.join(' '),...contentBlocks(article.article||article).map(block=>block.type==='rich'?block.body:block.type==='text'?[block.heading,block.body].join(' '):nodeText({type:'cnerdBlock',attrs:{block}}))].join(' ').toLowerCase().includes(terms)).filter(article=>!selected||article.topics.includes(selected));const topics=[...new Set(articles.flatMap(article=>article.topics))].sort();const perPage=12,totalPages=Math.max(1,Math.ceil(filtered.length/perPage)),current=Math.min(Math.max(1,Number(page)||1),totalPages),visible=filtered.slice((current-1)*perPage,current*perPage),featured=!terms&&!selected&&current===1?articles[0]:null,grid=featured?visible.filter(article=>article.slug!==featured.slug):visible;const href=(next,extra={})=>{const params=new URLSearchParams();if(terms)params.set('q',terms);if(selected)params.set('topic',selected);if(next>1)params.set('page',next);for(const [key,value]of Object.entries(extra))value?params.set(key,value):params.delete(key);return '/blog/'+(params.toString()?`?${params}`:'');};const card=article=>`<article class="blog-card">${article.heroImage?`<div class="blog-card-image"><img src="${esc(article.heroImage)}" alt="${esc(article.heroDecorative?"":article.heroAlt||article.article?.heroAlt||"")}" loading="lazy" decoding="async"><span>Listen · ${readingMinutes(article.article)} min</span></div>`:''}<p class="eyebrow">${esc(article.topics[0]||brand.name)}</p><h2><a href="/blog/${esc(article.slug)}/">${esc(article.title)}</a></h2><p>${esc(article.summary)}</p><span>${esc(article.author)} · ${`<time datetime="${esc(article.publishedAt)}">${esc(formatArticleDate(article.publishedAt,brand.timeZone))}</time>`} · ${readingMinutes(article.article)} min</span></article>`;const trackLinks=topics.length?topics.map(item=>`<a href="${href(1,{topic:item})}"><span>${esc(item)}</span><b>${articles.filter(article=>article.topics.includes(item)).length}</b></a>`).join(''):`<a href="/blog/"><span>All original work</span><b>${articles.length}</b></a>`;return `<article class="blog-library"><header class="blog-library-hero"><div class="wrap"><p class="eyebrow">${esc(brand.name.toUpperCase())} JOURNAL</p><h1>The latest from <em>${esc(brand.name)}.</em></h1><p>${esc(brand.description||"Stories, field notes, and useful ideas.")}</p></div></header><div class="wrap"><form class="blog-filter" method="get" action="/blog/"><label><span>Search articles</span><input type="search" name="q" value="${esc(query)}" placeholder="Search articles"></label><label><span>Topic</span><select name="topic"><option value="">All topics</option>${topics.map(item=>`<option value="${esc(item)}" ${item===selected?'selected':''}>${esc(item)}</option>`).join('')}</select></label><button class="button dark small">Search</button><a class="text-link blog-clear" href="/blog/">Clear search</a></form>${(terms||selected)?`<p class="blog-filter-note">${filtered.length} ${filtered.length===1?'article':'articles'}${terms?` matching “${esc(clean(query))}”`:''}${selected?` in ${esc(selected)}`:''}.</p>`:''}${featured?`<section class="blog-featured"><article class="blog-featured-card">${featured.heroImage?`<img class="blog-featured-image" src="${esc(featured.heroImage)}" alt="${esc(featured.article?.heroAlt||"")}" loading="lazy">`: ''}<div><p class="eyebrow">${esc(featured.topics[0]||'CNERD')}</p><span class="listen-badge">Listen · ${readingMinutes(featured.article)} min</span><h2><a href="/blog/${esc(featured.slug)}/">${esc(featured.title)}</a></h2><p>${esc(featured.summary)}</p><small>${esc(featured.author)} · ${new Date(featured.publishedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · ${readingMinutes(featured.article)} min</small><a class="button light small" href="/blog/${esc(featured.slug)}/">Read the post</a></div></article><aside class="blog-track-list"><p class="eyebrow">TOPICS</p>${trackLinks}<p class="eyebrow blog-track-latest">LATEST</p>${articles.slice(1,4).map(article=>`<a class="blog-mini-link" href="/blog/${esc(article.slug)}/">${article.heroImage?`<img src="${esc(article.heroImage)}" alt="${esc(article.heroDecorative?"":article.heroAlt||article.article?.heroAlt||"")}">`:''}<span>${esc(article.title)}<small>${esc(article.topics[0]||brand.name)} · ${readingMinutes(article.article)} min</small></span></a>`).join('')||'<p class="blog-mini-empty">New posts will appear here.</p>'}</aside></section>`:''}<div class="blog-grid-heading"><p class="eyebrow">${terms||selected?'MATCHING ARTICLES':'MORE FROM THE JOURNAL'}</p><span>${filtered.length} ${filtered.length===1?'post':'posts'}</span></div><section class="blog-card-grid">${grid.map(card).join('')||(filtered.length?'<p class="blog-empty">More field notes are on the way.</p>':'<p class="blog-empty">No published articles match this search yet.</p>')}</section>${totalPages>1?`<nav class="blog-pagination" aria-label="Blog pages">${current>1?`<a href="${href(current-1)}">Previous</a>`:''}${Array.from({length:totalPages},(_,i)=>i+1).map(item=>item===current?`<span aria-current="page">${item}</span>`:`<a href="${href(item)}">${item}</a>`).join('')}${current<totalPages?`<a href="${href(current+1)}">Next</a>`:''}</nav>`:''}</div></article>`;}
export function blogArticle(article,related=[],sharing=null){const narration=narrationSource({id:article.id||'preview',slug:article.slug,article});const headings=contentBlocks(article).filter(block=>['text','rich'].includes(block.type)&&block.heading);const time=value=>`<time datetime="${esc(value)}">${esc(formatArticleDate(value))}</time>`,published=article.publishedAt?time(article.publishedAt):'Not yet published',modified=article.hasPublicationUpdate!==false&&article.modifiedAt&&article.modifiedAt!==article.publishedAt?` · Updated ${time(article.modifiedAt)}`:'';return `<article class="blog-article" data-narration-article="${esc(article.id||'')}" data-narration-slug="${esc(article.slug||'')}" data-narration-source="${narration.sourceFingerprint}"><header class="blog-article-head wrap"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/blog/">← All articles</a><span>/</span><span aria-current="page">${esc(article.title)}</span></nav><p class="eyebrow">${esc(article.topics.join(' · ')||'CNERD FIELD NOTES')}</p><h1>${article.id?narration.rendered.titleHtml:esc(article.title)}</h1><p class="blog-dek">${article.id?narration.rendered.introHtml:esc(article.summary)}</p><p class="blog-byline">By ${esc(article.author)} · Published ${published}${modified} · ${readingMinutes(article)} min read</p>${sharing?articleSharing(article,sharing.base,sharing.settings):''}${article.heroImage?`<img class="blog-hero-image" src="${esc(article.heroImage)}" alt="${esc(article.heroDecorative?"":article.heroAlt||article.article?.heroAlt||"")}" decoding="async">`:''}</header><div class="blog-reading wrap"><aside class="blog-rail">${readerControls(Boolean(article.id))}${headings.length?`<nav class="blog-contents" aria-label="Section map"><p>SECTION MAP</p><a href="#article-start" data-section-link="article-start">Start</a>${headings.map((item,index)=>`<a href="#${esc(item.id)}" data-section-link="${esc(item.id)}">${index+1} ${esc(item.heading)}</a>`).join('')}</nav>`:''}</aside><div class="blog-body" id="article-start">${contentBlocks(article).map((block,index)=>`<div id="${esc(block.id)}" data-reader-unit>${article.id?narration.rendered.blocks[index].html:renderBlock(block,index)}</div>`).join('')}</div></div>${related.length?`<aside class="blog-related wrap"><p class="eyebrow">KEEP EXPLORING</p><h2>More from the blog</h2><div>${related.map(item=>`<a href="/blog/${esc(item.slug)}/"><strong>${esc(item.title)}</strong><span>${esc(item.summary)}</span></a>`).join('')}</div></aside>`:''}</article>`;}
export function blogSchema(article,base){return [{'@context':'https://schema.org','@type':'BlogPosting','@id':`${base}/blog/${article.slug}/#article`,mainEntityOfPage:`${base}/blog/${article.slug}/`,headline:article.title,description:article.seoDescription||article.summary,datePublished:article.publishedAt,dateModified:article.modifiedAt||article.publishedAt,author:{'@type':'Person',name:article.author},publisher:{'@id':`${base}/#organization`},image:article.heroImage?(article.heroImage.startsWith('http')?article.heroImage:`${base}${article.heroImage}`):undefined,inLanguage:'en-US'},{'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[['Home','/'],['Blog','/blog/'],[article.title,`/blog/${article.slug}/`]].map(([name,path],index)=>({'@type':'ListItem',position:index+1,name,item:base+path}))}];}

export async function adminBlogRoutes(req,res,url,{readBody,readRaw,json,rate}){
 const path=decodeURIComponent(url.pathname);
 if(/^\/api\/admin\/blog\/assets\/[a-f0-9]{32}$/.test(path)&&req.method==='GET')return false;
 const match=path.match(/^\/api\/admin\/blog(?:\/([a-z0-9-]+))?(?:\/(publish|archive|duplicate|revisions|restore|assets|deletion))?(?:\/([a-z0-9]+))?$/);if(!match)return false;const [,slug,action,id]=match;
 if(path==='/api/admin/blog'&&req.method==='GET')return json(res,200,allBlogs(true));
 if(!slug)throw fail('Not found.',404);
 if(action==='deletion'&&req.method==='GET')return json(res,200,blogDeletionImpact(slug));
 if(!action&&req.method==='DELETE'){rate(req,'blog-delete',20,60);return json(res,200,deleteBlog(slug,await readBody(req,4096)));}
 if(!action&&req.method==='GET'){const blog=getBlog(slug);if(!blog)throw fail('Not found.',404);return json(res,200,blog);}
 if(!action&&req.method==='PUT'){rate(req,'blog-save',120,10);const body=await readBody(req,2_000_000);return json(res,200,saveBlog(slug,body.data,body.revision));}
 if(action==='publish'&&req.method==='POST'){rate(req,'blog-publish',30,10);const body=await readBody(req,4096);return json(res,200,publishBlog(slug,body.revision));}
 if(action==='archive'&&req.method==='POST'){const body=await readBody(req,4096);return json(res,200,archiveBlog(slug,body.revision));}
 if(action==='duplicate'&&req.method==='POST')return json(res,200,duplicateBlog(slug));
 if(action==='revisions'&&req.method==='GET')return json(res,200,revisions(slug));
 if(action==='restore'&&req.method==='POST'){const body=await readBody(req,4096);return json(res,200,restoreRevision(slug,body.id,body.revision));}
 if(action==='assets'&&req.method==='GET')return json(res,200,assetsFor(slug));
 if(action==='assets'&&req.method==='POST'){rate(req,'blog-upload',30,10);if(req.headers['content-type']==='application/octet-stream'){const kind=String(req.headers['x-blog-asset-kind']||''),visibility=String(req.headers['x-blog-asset-visibility']||''),name=decodeURIComponent(String(req.headers['x-blog-asset-name']||''));const max=kind==='video'?18_000_000:kind==='download'?8_000_000:5_000_000;return json(res,200,uploadBlogAsset(slug,{kind,visibility,name},await readRaw(req,max)));}const body=await readBody(req,25_000_000);return json(res,200,uploadBlogAsset(slug,body));}
 throw fail('Not found.',404);
}
