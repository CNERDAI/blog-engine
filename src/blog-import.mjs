import {brand} from './brand.mjs';
import {assetId, assetPath, mounted} from './routes.mjs';
import {db,hash} from './db.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {getBlogById,getBlog,saveBlog,uploadBlogAsset,assetsFor,blogAsset,normalizeDraft} from './blog.mjs';
import {emptyDoc,assetReferences} from './blog-document.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
db.exec(`CREATE TABLE IF NOT EXISTS blog_import_tokens(token_hash TEXT PRIMARY KEY,owner TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS blog_import_ownership(article_id TEXT PRIMARY KEY,owner TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blog_import_requests(owner TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,article_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(owner,key));
CREATE TABLE IF NOT EXISTS blog_import_assets(article_id TEXT NOT NULL,digest TEXT NOT NULL,asset_id TEXT NOT NULL,PRIMARY KEY(article_id,digest));`);
export function issueBlogToken(){const token='cnerd_blog_'+randomBytes(32).toString('hex');db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM blog_import_tokens WHERE owner=?').run('codex-blog');db.prepare('INSERT INTO blog_import_tokens(token_hash,owner) VALUES(?,?)').run(hash(token),'codex-blog');db.exec('COMMIT');return {token,scope:'Integration-created private drafts and their assets only. No publishing or private training.'};}catch(error){db.exec('ROLLBACK');throw error;}}
if(!db.prepare('PRAGMA table_info(blog_import_requests)').all().some(c=>c.name==='revision'))db.exec('ALTER TABLE blog_import_requests ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
const publicDraft=record=>{const {training,trainingDoc,...data}=record.draft;return {id:record.id,slug:record.slug,revision:record.revision,state:record.state,data};};
function owned(id,owner){const record=getBlogById(id),permission=db.prepare('SELECT owner FROM blog_import_ownership WHERE article_id=?').get(id);if(!record||permission?.owner!==owner||record.state!=='draft')throw fail('This integration draft is unavailable.',404);return record;}
function inputDraft(input,slug,owner){if(input?.schemaVersion!==2||input.trainingDoc!==undefined||input.training!==undefined)throw fail('Import version 2 Content only. Private training is not available to integrations.');const normalized=normalizeDraft({...input,trainingDoc:emptyDoc()},slug);const references=assetReferences(normalized);if(references.some(ref=>ref.url?.includes('/api/admin/')))throw fail('Private assets cannot be imported.');for(const reference of references){const match=(assetId(reference.url)?[null,assetId(reference.url)]:null);if(!match)continue;const asset=blogAsset(match[1],true);const record=asset&&getBlog(asset.slug);if(!record||db.prepare('SELECT owner FROM blog_import_ownership WHERE article_id=?').get(record.id)?.owner!==owner||asset.visibility!=='public')throw fail('Choose an asset uploaded by this integration.');}return normalized;}
function remembered(owner,key,digest){if(typeof key!=='string'||!/^[-a-zA-Z0-9_:]{8,120}$/.test(key))throw fail('Supply a stable idempotency key.');const row=db.prepare('SELECT * FROM blog_import_requests WHERE owner=? AND key=?').get(owner,key);if(row&&row.digest!==digest)throw fail('That idempotency key was used for different content.',409);return row;}
export async function importRoutes(req,res,url,{readBody,readRaw,json,rate,base}){
 const path=url.pathname;if(!path.startsWith('/api/blog-import/'))return false;
 const token=String(req.headers.authorization||'').match(/^Bearer (cnerd_blog_[a-f0-9]{64})$/)?.[1],auth=token&&db.prepare('SELECT owner FROM blog_import_tokens WHERE token_hash=?').get(hash(token));if(!auth)throw fail('A scoped blog integration token is required.',401);rate(req,'blog-import',120,10);const owner=auth.owner;
 if(['POST','PUT','DELETE'].includes(req.method)&&process.env.BLOG_EDITOR_WRITES==='0')throw fail('Blog writes are disabled for recovery.',503);
 const response=record=>({...publicDraft(record),editorUrl:base+mounted('/admin/')+'?article='+record.id});
 if(path==='/api/blog-import/drafts'&&req.method==='POST'){
  const body=await readBody(req,350000),digest=hash(JSON.stringify(body.data)),key=body.idempotencyKey,cached=remembered(owner,key,digest);if(cached)return json(res,200,{...response(owned(cached.article_id,owner)),revision:cached.revision});
  const data=inputDraft(body.data,body.data?.slug,owner);if(getBlog(data.slug))throw fail('Choose a new URL for this integration draft.',409);
  const record=saveBlog(data.slug,data,0,saved=>{db.prepare('INSERT INTO blog_import_ownership VALUES(?,?)').run(saved.id,owner);db.prepare('INSERT INTO blog_import_requests(owner,key,digest,article_id,revision) VALUES(?,?,?,?,?)').run(owner,key,digest,saved.id,saved.revision);});return json(res,201,response(record));
 }
 const match=path.match(/^\/api\/blog-import\/drafts\/([a-f0-9-]{36})(?:\/(assets)(?:\/([a-f0-9]{32}))?)?$/);if(!match)throw fail('Not found.',404);const [,id,action,assetId]=match,record=owned(id,owner);
 if(!action&&req.method==='GET')return json(res,200,response(record));
 if(!action&&req.method==='PUT'){
  const body=await readBody(req,350000),digest=hash(JSON.stringify({data:body.data,expectedRevision:body.expectedRevision})),cached=remembered(owner,body.idempotencyKey,digest);if(cached){if(cached.article_id!==id)throw fail('That key belongs to another draft.',409);return json(res,200,response(record));}
  const data=inputDraft(body.data,record.slug,owner);data.trainingDoc=record.draft.trainingDoc||emptyDoc();const saved=saveBlog(record.slug,data,body.expectedRevision,saved=>db.prepare('INSERT INTO blog_import_requests(owner,key,digest,article_id,revision) VALUES(?,?,?,?,?)').run(owner,body.idempotencyKey,digest,id,saved.revision));return json(res,200,response(saved));
 }
 if(action==='assets'&&req.method==='GET'){if(!assetId)return json(res,200,assetsFor(record.slug).filter(a=>a.visibility==='public'));const asset=blogAsset(assetId,true);if(!asset||asset.slug!==record.slug||asset.visibility!=='public')throw fail('Not found.',404);return json(res,200,{id:asset.id,path:assetPath(asset.id),name:asset.name});}
 if(action==='assets'&&req.method==='POST'){
  if(req.headers['content-type']!=='application/octet-stream')throw fail('Upload the actual asset bytes.');const kind=url.searchParams.get('kind'),name=String(req.headers['x-blog-asset-name']||'asset'),max=kind==='video'?18000000:kind==='download'?8000000:5000000,bytes=await readRaw(req,max),digest=createHash('sha256').update(kind||'').update(bytes).digest('hex');
  db.exec('BEGIN IMMEDIATE');try{const cached=db.prepare('SELECT asset_id FROM blog_import_assets WHERE article_id=? AND digest=?').get(id,digest);if(cached){const asset=assetsFor(record.slug).find(a=>a.id===cached.asset_id);if(asset){db.exec('COMMIT');return json(res,200,asset);}}const asset=uploadBlogAsset(record.slug,{kind,name:decodeURIComponent(name),visibility:'public'},bytes);db.prepare('INSERT OR REPLACE INTO blog_import_assets VALUES(?,?,?)').run(id,digest,asset.id);db.exec('COMMIT');return json(res,201,asset);}catch(error){db.exec('ROLLBACK');throw error;}
 }
 throw fail('Not found.',404);
}
