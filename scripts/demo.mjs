import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {brand} from '../src/brand.mjs';
import {saveBlog,uploadBlogAsset,publishBlog,getBlog} from '../src/blog.mjs';
import {db} from '../src/db.mjs';

if(brand.environment!=='local')throw Error('Demo fixtures are available only on a loopback installation.');
const slug='welcome-to-your-blog';
if(getBlog(slug)){console.log('Existing demo preserved.');db.close();process.exit(0);}
const article={schemaVersion:2,slug,title:`Welcome to the ${brand.name} journal`,summary:'This local sample demonstrates editable stories, accessible images, search metadata, social exports and separate brand configuration.',author:brand.defaultAuthor.name,authorType:brand.defaultAuthor.type,topics:['Getting started'],heroImage:'',heroAlt:'A blue illustration with a green panel and a white rectangle, used as a clearly labeled local test image.',seoTitle:`${brand.name} journal demonstration`,seoDescription:'Explore the local blog engine demonstration with editable articles and branded presentation.',bodyDoc:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'A story that belongs to your brand'}]},{type:'paragraph',content:[{type:'text',text:'Write a useful introduction, support it with real examples and images, and give readers a clear next step. This is demonstration content on a local test installation.'}]},{type:'heading',attrs:{level:2},content:[{type:'text',text:'Edit, review, then publish'}]},{type:'paragraph',content:[{type:'text',text:'The editor keeps your draft separate from the published article. The AI skill can prepare an editable draft and social files. You decide when the article becomes public.'}]}]},trainingDoc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'PRIVATE DEMONSTRATION TRAINING MUST NOT APPEAR IN THE PUBLIC ARTICLE.'}]}]}};
let record=saveBlog(slug,article,0);
const dir=mkdtempSync(join(tmpdir(),'blog-demo-image-'));
try{
  const file=join(dir,'demo.jpg');
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x205caa:s=1600x900','-vf','drawbox=x=200:y=150:w=850:h=600:color=0x3e9c78:t=fill,drawbox=x=1150:y=250:w=200:h=400:color=white:t=fill','-frames:v','1','-update','1',file],{encoding:'utf8',timeout:30000});
  if(result.status!==0)throw Error(result.stderr||'ffmpeg image generation failed.');
  const image=uploadBlogAsset(slug,{kind:'image',visibility:'public',name:'local-demo-illustration.jpg'},readFileSync(file));
  record=saveBlog(slug,{...record.draft,heroImage:image.path},record.revision);
  publishBlog(slug,record.revision);
  console.log(`Created a clearly labeled local sample at ${brand.publicOrigin}${brand.basePath}/${slug}/`);
}finally{rmSync(dir,{recursive:true,force:true});db.close();}
