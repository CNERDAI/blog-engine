import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const root=resolve('.'),dir=mkdtempSync(join(tmpdir(),'blog-engine-integration-')),base='http://127.0.0.1:4380';
const env={...process.env,BRAND_CONFIG:resolve('config/cnerd.local.json'),DATA_DIR:dir,PUBLIC_ORIGIN:base,PORT:'4380'};
let child,cookie,credentials,record,asset,source,recording;
const draft=(slug='integration-story')=>({schemaVersion:2,slug,title:'A practical story for our readers',summary:'A useful, clearly sourced explanation with an accessible image and an editable article body.',author:'Test author',topics:['Local tests'],heroImage:'',heroAlt:'A blue test illustration with a contrasting panel.',bodyDoc:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Start with a clear example'}]},{type:'paragraph',content:[{type:'text',text:'Readers need clear examples and practical explanations. This article is an isolated integration fixture, with no production content or credentials.'}]}]},trainingDoc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'PRIVATE TRAINING SENTINEL'}]}]}});
async function request(path,{method='GET',body,admin=false,token,headers={}}={}){
  const response=await fetch(base+path,{method,headers:{...(body!==undefined?{'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'}:{}),...(admin?{Cookie:cookie,Origin:base}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
  return response;
}
const api=(path,options={})=>request('/blog/api/'+path,options);
async function value(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function start(cmd,args,options){const c=spawn(cmd,args,{...options,stdio:['ignore','pipe','pipe']});await new Promise((yes,no)=>{let err='';const timer=setTimeout(()=>no(Error('Startup timeout '+err)),15000);c.stderr.on('data',v=>err+=v);c.stdout.once('data',()=>{clearTimeout(timer);yes();});c.once('exit',code=>{clearTimeout(timer);no(Error('Startup failed '+code+' '+err));});});return c;}
before(async()=>{
  const setup=spawnSync(process.execPath,['scripts/setup.mjs'],{cwd:root,env,encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
  credentials=JSON.parse(readFileSync(join(dir,'local-credentials.json')));
  child=await start(process.execPath,['src/server.mjs'],{cwd:root,env});
  const login=await api('auth',{method:'POST',body:{password:credentials.password},headers:{Origin:base}});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
});
after(()=>{child?.kill();rmSync(dir,{recursive:true,force:true});});

test('standalone startup has no CNERD website seeds and namespaced authentication',async()=>{
  const db=new DatabaseSync(join(dir,'site.sqlite'));assert.equal(db.prepare('SELECT COUNT(*) n FROM documents').get().n,0);db.close();
  assert.equal((await api('admin/blog')).status,401);
  assert.equal((await api('admin/blog',{method:'PUT',body:{},admin:true,headers:{Origin:'https://wrong.example'}})).status,403);
  assert.equal((await request('/api/admin/blog',{admin:true})).status,404);
  assert.match(cookie,/^blog_cnerd_session=/);
  const health=await value(await api('health'));assert.equal(health.version,'0.1.0');assert.equal(health.brand,'cnerd');
});
test('admin saves private training and draft media never leaks',async()=>{
  record=await value(await api('admin/blog/integration-story',{method:'PUT',body:{data:draft(),revision:0},admin:true}));
  const image=join(dir,'fixture.png');const ff=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=1600x900','-frames:v','1','-update','1',image],{encoding:'utf8'});assert.equal(ff.status,0,ff.stderr);
  asset=await value(await api('admin/blog/integration-story/assets',{method:'POST',body:readFileSync(image),admin:true,headers:{'X-Blog-Asset-Kind':'image','X-Blog-Asset-Visibility':'public','X-Blog-Asset-Name':'test.png'}}));
  assert.match(asset.path,/^\/blog\/media\/[a-f0-9]{32}$/);
  assert.equal((await request(asset.path)).status,404);
  assert.equal((await request('/blog/integration-story/')).status,404);
  assert.equal((await request('/blog/integration-story/preview')).status,401);
  record=await value(await api('admin/blog/integration-story',{method:'PUT',body:{data:{...record.draft,heroImage:asset.path},revision:record.revision},admin:true}));
  const preview=await request('/blog/integration-story/preview',{admin:true});const html=await preview.text();assert.equal(preview.status,200);assert.match(preview.headers.get('x-robots-tag'),/noindex/);assert.doesNotMatch(html,/PRIVATE TRAINING SENTINEL/);assert.match(html,/\/blog\/api\/admin\/blog\/assets\//);assert.match(html,/width="1600"/);
  const stale=await api('admin/blog/integration-story',{method:'PUT',body:{data:{...record.draft,title:'Stale overwritten title'},revision:1},admin:true});assert.equal(stale.status,409);
});
test('publication emits initial HTML, accurate branding/schema/images and searchable surface',async()=>{
  record=await value(await api('admin/blog/integration-story/publish',{method:'POST',body:{revision:record.revision},admin:true}));
  const response=await request('/blog/integration-story/');const html=await response.text();assert.equal(response.status,200);
  assert.match(html.replace(/<[^>]*>/g,''),/Readers need clear examples/);assert.doesNotMatch(html,/PRIVATE TRAINING SENTINEL/);assert.match(html,/rel="canonical" href="http:\/\/127.0.0.1:4380\/blog\/integration-story\/"/);assert.match(html,/og:image:alt/);assert.match(html,/twitter:image:alt/);assert.match(html,/BlogPosting/);assert.match(html,/width="1600"/);assert.match(html,/srcset=/);
  const publicImageResponse=await request(asset.path);assert.equal(publicImageResponse.status,200);assert.equal(publicImageResponse.headers.get('content-type'),'image/jpeg');assert.equal((await request(asset.path+'/variants/640.jpg')).status,200);
  assert.match(await (await request('/blog/sitemap.xml')).text(),/integration-story/);
  assert.match(await (await request('/blog/feed.xml')).text(),/integration-story/);
  assert.match(await (await request('/robots.txt')).text(),/Disallow: \/blog\/api\//);
  assert.equal((await request('/blog/?page=999')).status,404);
  const filtered=await request('/blog/?q=practical');assert.match(filtered.headers.get('x-robots-tag'),/noindex/);
});
test('draft changes preserve published snapshot, missing alt blocks publish, rename keeps permanent redirect',async()=>{
  const publishedTitle=record.published.title;
  record=await value(await api('admin/blog/integration-story',{method:'PUT',body:{data:{...record.draft,title:'An improved story after editing',heroAlt:'',heroImage:'/blog/api/admin/blog/assets/'+asset.id},revision:record.revision},admin:true}));
  assert.match(await (await request('/blog/integration-story/')).text(),new RegExp(publishedTitle));
  assert.equal((await api('admin/blog/integration-story/publish',{method:'POST',body:{revision:record.revision},admin:true})).status,400);
  record=await value(await api('admin/blog/integration-story',{method:'PUT',body:{data:{...record.draft,slug:'renamed-story',heroAlt:'A blue local test illustration.',heroImage:asset.path},revision:record.revision},admin:true}));
  record=await value(await api('admin/blog/integration-story/publish',{method:'POST',body:{revision:record.revision},admin:true}));
  const old=await fetch(base+'/blog/integration-story/',{redirect:'manual'});assert.equal(old.status,301);assert.equal(old.headers.get('location'),'/blog/renamed-story/');
});
test('social pack is actual downloadable images, private, idempotent and stale after edits',async()=>{
  const input={expectedRevision:record.revision,idempotencyKey:'social-integration-1'};
  const pack=await value(await api('admin/blog/renamed-story/social',{method:'POST',body:input,admin:true}));assert.equal(pack.state,'ready');assert.equal(pack.images.length,4);assert.ok(pack.files.filter(f=>f.mime==='image/jpeg').length>=4);assert.equal(pack.zipPath,undefined);assert.ok(pack.files.every(f=>f.path===undefined));
  const download=await request(pack.exportUrl,{admin:true});assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/zip');assert.ok((await download.arrayBuffer()).byteLength>1000);
  assert.equal((await request(pack.exportUrl)).status,401);
  assert.equal((await value(await api('admin/blog/renamed-story/social',{method:'POST',body:input,admin:true}))).id,pack.id);
  record=await value(await api('admin/blog/renamed-story',{method:'PUT',body:{data:{...record.draft,summary:record.draft.summary+' An additional editorial sentence.'},revision:record.revision},admin:true}));
  const status=await value(await api('admin/blog/renamed-story/status',{admin:true}));assert.equal(status.social.state,'stale');
});
test('AI imports real images, validates safely, deduplicates, and cannot publish or read other drafts',async()=>{
  const token=credentials.integrationToken,body={data:{...draft('ai-story'),trainingDoc:undefined},idempotencyKey:'integration-create-01'};
  const caps=await value(await api('integration/capabilities',{token}));assert.equal(caps.brand.id,'cnerd');assert.equal(caps.connectedPosting,false);
  const first=await value(await api('integration/drafts',{method:'POST',body,token}),201),second=await value(await api('integration/drafts',{method:'POST',body,token}));assert.equal(first.id,second.id);assert.match(first.editorUrl,/\/blog\/admin\//);
  const upload=()=>api('integration/drafts/'+first.id+'/assets?kind=image',{method:'POST',body:readFileSync(join(dir,'fixture.png')),token,headers:{'X-Blog-Asset-Name':'actual.png'}});
  const image=await value(await upload(),201),repeat=await value(await upload());assert.equal(image.id,repeat.id);
  const updated=await value(await api('integration/drafts/'+first.id,{method:'PUT',body:{data:{...first.data,heroImage:image.path},expectedRevision:first.revision,idempotencyKey:'integration-update-01'},token}));
  assert.equal((await value(await api('integration/validate',{method:'POST',body:{data:updated.data},token}))).passed,true);
  assert.equal((await value(await api('integration/validate',{method:'POST',body:{data:{...updated.data,heroImage:'/wrong/media/'+image.id}},token}))).passed,false);
  assert.equal((await api('integration/drafts/'+record.id,{token})).status,404);
  assert.equal((await api('integration/drafts/'+first.id+'/publish',{method:'POST',body:{},token})).status,404);
  const scopedPack=await value(await api('integration/drafts/'+first.id+'/social',{method:'POST',body:{expectedRevision:updated.revision,idempotencyKey:'scoped-social-package-01'},token}));assert.ok(scopedPack.images.every(i=>i.url.includes('/api/integration/drafts/')));assert.equal((await request(scopedPack.images[0].url,{token})).status,200);
  const status=await value(await api('integration/drafts/'+first.id+'/status',{token}));
  const job=await value(await api('integration/drafts/'+first.id+'/narration',{method:'POST',body:{voiceId:'heart',expectedRevision:updated.revision,idempotencyKey:'narration-request-01',sourceFingerprint:status.audio.draftSourceFingerprint},token}),202);
  assert.equal(job.producer.available,false);assert.equal(job.state,'waiting_for_producer');
  const producer=credentials.producerToken;
  assert.equal((await api('integration/drafts',{method:'POST',body,token:producer})).status,403);
  assert.equal((await api('integration/drafts/'+first.id+'/narration-jobs/'+job.id,{token:producer})).status,200);
  assert.equal((await api('integration/drafts/'+first.id+'/narration-jobs/'+job.id+'/import',{method:'POST',body:{},token})).status,403);
});
test('saved MP3 discovery, public manifest/ranges, activation and draft isolation work through actual server',async()=>{
  source=await value(await api('admin/narration/'+record.id+'/export?source=published',{admin:true}));
  const file=join(dir,'fixture.mp3');const ff=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=12','-c:a','libmp3lame',file],{encoding:'utf8'});assert.equal(ff.status,0,ff.stderr);
  const audio=readFileSync(file),duration=12,step=10/source.spokenWords.length;
  const words=source.spokenWords.map((w,i)=>({...w,start:i*step,end:(i+1)*step-.001,score:1}));
  const chapters=source.chapters.map((c,i)=>({id:c.id,start:words.find(w=>w.tokenId===c.firstTokenId).start,end:i+1<source.chapters.length?words.find(w=>w.tokenId===source.chapters[i+1].firstTokenId).start:duration}));
  const manifest={schema:source.schema,articleId:record.id,sourceFingerprint:source.sourceFingerprint,visibility:'published',voiceId:'heart',audioSha256:createHash('sha256').update(audio).digest('hex'),duration,words,chapters,settings:{engine:'test-fixture',model:'tone',alignment:'synthetic-test-only'}};
  recording=await value(await api('admin/narration/'+record.id+'/import',{method:'POST',body:{manifest,audioBase64:audio.toString('base64')},admin:true}));
  assert.equal((await request('/blog/narration/'+recording.id+'/audio')).status,404);
  await value(await api('admin/narration/'+recording.id+'/activate',{method:'POST',body:{active:true,expectedSourceFingerprint:source.sourceFingerprint,expectedActiveId:null},admin:true}));
  const list=await value(await api('narration/renamed-story'));assert.equal(list.voices.length,1);
  const range=await request(list.voices[0].audioUrl,{headers:{Range:'bytes=0-99'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
  assert.equal((await request(list.voices[0].manifestUrl)).status,200);
  const invalid=await request(list.voices[0].audioUrl,{headers:{Range:'bytes=99999999-'}});assert.equal(invalid.status,416);
  // This fixture tests transport/clock mapping only, never custom voice or acoustic quality.
  record=await value(await api('admin/blog/renamed-story',{method:'PUT',body:{data:{...record.draft,title:'A new draft title changes spoken content'},revision:record.revision},admin:true}));
  assert.equal((await value(await api('narration/renamed-story'))).voices.length,1);
  record=await value(await api('admin/blog/renamed-story/publish',{method:'POST',body:{revision:record.revision},admin:true}));
  assert.equal((await value(await api('narration/renamed-story'))).voices.length,0);
  assert.equal((await request(list.voices[0].audioUrl)).status,404);
});
test('same engine runs other brands with isolated tokens/data and a same-origin independent host mount',async()=>{
  const other=join(dir,'other'),target='http://127.0.0.1:4382',hostBase='http://127.0.0.1:4383';
  const otherEnv={...env,BRAND_CONFIG:resolve('config/landworkspro.local.json'),DATA_DIR:other,PUBLIC_ORIGIN:hostBase,PORT:'4382'};
  const setup=spawnSync(process.execPath,['scripts/setup.mjs'],{cwd:root,env:otherEnv,encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
  const demo=spawnSync(process.execPath,['scripts/demo.mjs'],{cwd:root,env:otherEnv,encoding:'utf8'});assert.equal(demo.status,0,demo.stderr);
  const otherCredentials=JSON.parse(readFileSync(join(other,'local-credentials.json')));
  const instance=await start(process.execPath,['src/server.mjs'],{cwd:root,env:otherEnv});
  const host=await start(process.execPath,['scripts/host-fixture.mjs'],{cwd:root,env:{...env,HOST_FIXTURE_PORT:'4383',BLOG_TARGET:target}});
  try{
    assert.equal((await fetch(hostBase+'/blog/api/integration/capabilities',{headers:{Authorization:'Bearer '+credentials.integrationToken}})).status,401);
    const caps=await (await fetch(hostBase+'/blog/api/integration/capabilities',{headers:{Authorization:'Bearer '+otherCredentials.integrationToken}})).json();assert.equal(caps.brand.id,'landworkspro');
    assert.match(await (await fetch(hostBase+'/')).text(),/independent website/);
    const html=await (await fetch(hostBase+'/blog/welcome-to-your-blog/')).text();assert.match(html,/LandworksPro/);assert.doesNotMatch(html,/THE CNERD JOURNAL/);
    assert.ok(html.includes('rel="canonical" href="'+hostBase+'/blog/welcome-to-your-blog/"'));
    assert.equal((await fetch(hostBase+'/blog/assets/editor/blog-editor.js')).status,200);
    const login=await fetch(hostBase+'/blog/api/auth',{method:'POST',headers:{'Content-Type':'application/json',Origin:hostBase},body:JSON.stringify({password:otherCredentials.password})});assert.equal(login.status,200);
    assert.match(login.headers.get('set-cookie'),/^blog_landworkspro_session=/);
    const pub=html.match(/class="blog-hero-image" src="([^"]+)"/)[1];assert.equal((await fetch(hostBase+pub)).status,200);
    assert.match(await (await fetch(hostBase+'/sitemap.xml')).text(),/\/blog\/sitemap.xml/);
    const bad=spawnSync(process.execPath,['scripts/setup.mjs'],{cwd:root,env:{...otherEnv,DATA_DIR:dir},encoding:'utf8'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/another brand/);
  }finally{host.kill();instance.kill();}
});
test('backup and restore preserve articles, media and recordings without overwriting directories',async()=>{
  const backup=join(dir,'..',dir.split('/').at(-1)+'-backup'),restored=backup+'-restored';
  try{
    const b=spawnSync(process.execPath,['scripts/backup.mjs',backup],{cwd:root,env,encoding:'utf8'});assert.equal(b.status,0,b.stderr);
    const r=spawnSync(process.execPath,['scripts/restore.mjs',backup,restored],{cwd:root,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
    const db=new DatabaseSync(join(restored,'site.sqlite'));assert.equal(db.prepare('SELECT COUNT(*) n FROM blogs').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM blog_narrations').get().n,1);db.close();
    const manifest=JSON.parse(readFileSync(join(backup,'backup-manifest.json')));for(const f of manifest.files)assert.equal(createHash('sha256').update(readFileSync(join(restored,f.path))).digest('hex'),f.sha256);
    const refused=spawnSync(process.execPath,['scripts/restore.mjs',backup,restored],{cwd:root,env,encoding:'utf8'});assert.notEqual(refused.status,0);
  }finally{rmSync(backup,{recursive:true,force:true});rmSync(restored,{recursive:true,force:true});}
});
