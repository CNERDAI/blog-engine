import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {basename,resolve} from 'node:path';
import {brand} from './brand.mjs';
import {db,dataDir} from './db.mjs';
import {assetReferences} from './blog-document.mjs';
import {getBlog,uploadBlogAsset} from './blog.mjs';
import {inspectImage} from './media.mjs';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const canUseSite=()=>brand.id==='cnerd'&&process.env.CNERD_HOST_SESSION==='1';
function normalized(value){
  let url=String(value||'');
  try{const parsed=new URL(url);if(parsed.origin===brand.publicOrigin)url=parsed.pathname;}catch{}
  return url.replace(/^\/blog-media\/([a-f0-9]{32})$/,`${brand.basePath}/media/$1`);
}
function references(){
  const uses=new Map();
  const add=(value,usage)=>{const key=normalized(value);if(!key)return;if(!uses.has(key))uses.set(key,[]);if(!uses.get(key).some(item=>item.articleId===usage.articleId&&item.section===usage.section))uses.get(key).push(usage);};
  for(const row of db.prepare('SELECT article_id,slug,draft_json,public_json FROM blogs').all()){
    for(const [column,section] of [['draft_json','draft'],['public_json','published']]){
      if(!row[column])continue;const article=JSON.parse(row[column]);
      for(const ref of assetReferences(article).filter(ref=>ref.kind==='image'))add(ref.url,{articleId:row.article_id,slug:row.slug,title:article.title,section});
    }
    const draft=JSON.parse(row.draft_json);
    for(const ref of assetReferences(draft,true).filter(ref=>ref.kind==='image'))add(ref.url,{articleId:row.article_id,slug:row.slug,title:draft.title,section:'private training'});
  }
  return uses;
}
function catalog(){
  const uses=references(),items=[];
  for(const row of db.prepare('SELECT id,name,mime,bytes,path FROM media').all()){
    if(!row.mime?.startsWith('image/'))continue;
    items.push({id:'site:'+row.id,name:row.name,mime:row.mime,bytes:row.bytes,kind:'image',source:canUseSite()?'Website upload':'Library upload',visibility:'public',url:row.path,previewUrl:row.path,uses:uses.get(normalized(row.path))||[],canSelect:true,canDelete:canUseSite()});
  }
  for(const row of db.prepare('SELECT id,slug,name,mime,bytes,kind,visibility,created_at FROM blog_assets ORDER BY created_at DESC').all()){
    const url=row.visibility==='public'?`${brand.basePath}/media/${row.id}`:`${brand.basePath}/api/admin/blog/assets/${row.id}`;
    items.push({id:'blog:'+row.id,name:row.name,mime:row.mime,bytes:row.bytes,kind:row.kind,source:'Article upload',visibility:row.visibility,url,previewUrl:row.kind==='image'?`${brand.basePath}/api/admin/blog/assets/${row.id}`:null,ownerSlug:row.slug,uses:uses.get(normalized(url))||[],canSelect:row.kind==='image'&&row.visibility==='public',canDelete:false});
  }
  const known=new Set(items.map(item=>normalized(item.url)));
  for(const [url,usage] of uses){
    if(known.has(url)||!usage.some(item=>item.section!=='private training'))continue;
    const external=/^https:\/\//.test(url),bundled=/^\/(?:assets|blog\/assets)\//.test(url);
    if(!external&&!bundled)continue;
    items.push({id:'ref:'+hash(url),name:basename(url.split('?')[0])||url,mime:'image/unknown',bytes:null,kind:'image',source:external?'External reference':'Bundled image',visibility:'public',url,previewUrl:url,uses:usage,canSelect:true,canDelete:false});
    known.add(url);
  }
  return items;
}
export function mediaLibrary({search='',source='all',type='all',privateView=false,offset=0}={}){
  const pageOffset=Number(offset);
  if(!Number.isSafeInteger(pageOffset)||pageOffset<0||pageOffset>1000000)throw fail('Invalid library page.');
  const term=String(search).trim().toLowerCase().slice(0,120);
  const showPrivate=privateView===true||privateView==='true';
  const entries=catalog().filter(item=>(showPrivate?item.visibility==='training':item.visibility==='public')&&(source==='all'||item.source===source)&&(type==='all'||item.kind===type)&&(!term||[item.name,item.url,...item.uses.map(use=>use.title)].join(' ').toLowerCase().includes(term)));
  return {items:entries.slice(pageOffset,pageOffset+50),total:entries.length,pageSize:50,offset:pageOffset,nextOffset:pageOffset+50<entries.length?pageOffset+50:null,previousOffset:pageOffset?Math.max(0,pageOffset-50):null};
}
export function useMedia(slug,{id,expectedRevision}={}){
  const article=getBlog(slug);
  if(!article)throw fail('Save the article before choosing an image.',404);
  if(Number(expectedRevision)!==article.revision)throw fail('This article changed. Reload before choosing media.',409);
  const item=catalog().find(item=>item.id===id);
  if(!item||!item.canSelect||item.visibility!=='public'||item.kind!=='image')throw fail('Choose an available public image.',422);
  if(item.id.startsWith('ref:'))return {path:item.url,copied:false};
  if(item.id.startsWith('blog:')&&item.ownerSlug===slug)return {path:item.url,copied:false};
  let file;
  if(item.id.startsWith('blog:'))file=db.prepare('SELECT file FROM blog_assets WHERE id=? AND kind=\'image\' AND visibility=\'public\'').get(item.id.slice(5))?.file;
  const target=item.id.startsWith('blog:')&&file?resolve(dataDir,'blog-assets',file):item.id.startsWith('site:')?resolve(dataDir,'media',basename(item.url)):null;
  if(!target||!existsSync(target)||!statSync(target).isFile()||statSync(target).size>5_000_000)throw fail('This image cannot be copied into the article.',422);
  const content=readFileSync(target),fingerprint=hash(content);
  for(const row of db.prepare('SELECT id,file FROM blog_assets WHERE slug=? AND kind=\'image\' AND visibility=\'public\'').all(slug)){
    const prior=resolve(dataDir,'blog-assets',row.file);
    if(existsSync(prior)&&statSync(prior).size===content.length&&hash(readFileSync(prior))===fingerprint)return {path:`${brand.basePath}/media/${row.id}`,copied:false};
  }
  const asset=uploadBlogAsset(slug,{kind:'image',visibility:'public',name:item.name},content);
  return {path:asset.path,copied:true};
}

export function uploadLibraryImage({name,base64}={}){
  const buffer=Buffer.from(String(base64||''),'base64');
  const info=inspectImage(buffer),ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[info.mime];
  const id=randomBytes(16).toString('hex'),file=id+'.'+ext;
  const root=resolve(dataDir,'media');mkdirSync(root,{recursive:true,mode:0o700});
  const path=canUseSite()?'/media/'+file:`${brand.basePath}/library-media/${file}`;
  writeFileSync(resolve(root,file),buffer,{mode:0o600});
  try{db.prepare('INSERT INTO media(id,name,mime,bytes,path) VALUES(?,?,?,?,?)').run(id,String(name||file).slice(0,150),info.mime,buffer.length,path);}
  catch(error){unlinkSync(resolve(root,file));throw error;}
  return {id:'site:'+id,path};
}
