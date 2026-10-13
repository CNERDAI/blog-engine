import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const dir=mkdtempSync(join(tmpdir(),'cnerd-media-library-'));
process.env.DATA_DIR=dir;
process.env.BRAND_CONFIG=resolve('config/cnerd.local.json');
const {saveBlog,uploadBlogAsset,getBlog}=await import('../src/blog.mjs');
const {deleteBlog,mediaDeletionImpact}=await import('../src/admin-deletion.mjs');
const {mediaLibrary,useMedia,uploadLibraryImage}=await import('../src/media-library.mjs');
const {db}=await import('../src/db.mjs');
after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
const image=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=16x16','-frames:v','1','-c:v','png','-f','image2pipe','pipe:1'],{maxBuffer:100000}).stdout;
const draft=slug=>({schemaVersion:2,slug,title:'An article with reusable illustrations',summary:'A useful explanation for readers with an example image.',author:'Test',topics:['Media'],heroImage:'',bodyDoc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'The image helps explain the article.'}]}]},trainingDoc:{type:'doc',content:[]}});

test('catalog includes all sources and keeps private training separate',()=>{
  const first=saveBlog('media-first',draft('media-first'),0);
  const uploaded=uploadBlogAsset(first.slug,{kind:'image',visibility:'public',name:'Article image.png'},image);
  uploadBlogAsset(first.slug,{kind:'image',visibility:'training',name:'Private training.png'},image);
  const general=uploadLibraryImage({name:'Website upload.png',base64:image.toString('base64')});
  const saved=saveBlog(first.slug,{...first.draft,heroImage:uploaded.path,socialImage:'https://images.example.org/reference.png',bodyDoc:{type:'doc',content:[{type:'image',attrs:{src:'/assets/bundled.webp',alt:'Bundled example'}}]}},first.revision);
  const publicItems=mediaLibrary({}).items;
  assert(publicItems.some(item=>item.id===general.id));
  assert(publicItems.some(item=>item.id==='blog:'+uploaded.id&&item.uses.some(use=>use.articleId===saved.id)));
  assert(publicItems.some(item=>item.source==='External reference'));
  assert(publicItems.some(item=>item.source==='Bundled image'&&item.url==='/assets/bundled.webp'));
  assert(!publicItems.some(item=>item.name==='Private training.png'));
  const privateItems=mediaLibrary({privateView:'true'}).items;
  assert(privateItems.some(item=>item.name==='Private training.png'&&!item.canSelect));
});

test('general uploads become article-owned copies and show draft usage',()=>{
  const article=saveBlog('media-general',draft('media-general'),0);
  const general=mediaLibrary({}).items.find(item=>item.name==='Website upload.png');
  const copied=useMedia(article.slug,{id:general.id,expectedRevision:article.revision});
  assert.equal(copied.copied,true);
  assert.match(copied.path,/\/blog\/media\/[a-f0-9]{32}$/);
  const saved=saveBlog(article.slug,{...article.draft,heroImage:copied.path},article.revision);
  assert(mediaLibrary({}).items.find(item=>item.url===copied.path).uses.some(use=>use.articleId===saved.id&&use.section==='draft'));
  assert.equal(mediaDeletionImpact(general.id.slice(5)).uses.length,0);
});

test('inserting another article image copies once and protects the destination',()=>{
  const first=getBlog('media-first'),second=saveBlog('media-second',draft('media-second'),0);
  const source=mediaLibrary({}).items.find(item=>item.ownerSlug===first.slug&&item.visibility==='public');
  assert.throws(()=>useMedia(second.slug,{id:source.id,expectedRevision:second.revision+1}),error=>error.status===409);
  const copied=useMedia(second.slug,{id:source.id,expectedRevision:second.revision});
  assert.equal(copied.copied,true);
  assert.notEqual(copied.path,source.url);
  assert.deepEqual(useMedia(second.slug,{id:source.id,expectedRevision:second.revision}),{path:copied.path,copied:false});
  const updated=saveBlog(second.slug,{...second.draft,heroImage:copied.path},second.revision);
  const impact=deleteBlog(first.slug,{articleId:first.id,revision:first.revision,confirmation:first.draft.title});
  assert.equal(impact.deleted,true);
  assert.equal(getBlog(updated.slug).draft.heroImage,copied.path);
  assert(mediaLibrary({}).items.some(item=>item.url===copied.path));
});
