import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';

test('saved MP3 clock drives seek, highlighting, speed, chapters, follow and explicit fallback',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'blog-player-fixture-'));process.env.DATA_DIR=dir;
 const config=JSON.parse(readFileSync(new URL('../config/cnerd.local.json',import.meta.url),'utf8'));
 config.voices=[{id:'heart',label:'Heart · stock fixture',approved:true,kind:'stock'}];config.pronunciations={CNERD:'see nerd',Olean:'Olean'};
 process.env.BRAND_CONFIG=join(dir,'brand.json');writeFileSync(process.env.BRAND_CONFIG,JSON.stringify(config));
 const {db}=await import('../src/db.mjs'),blog=await import('../src/blog.mjs'),n=await import('../src/narration.mjs'),{checksum}=await import('../src/narration-validation.mjs');
 let browser,server;
 try{
  const article={title:'Saved narration fixture',summary:'This is synthetic test audio, not a production voice.',topics:[],author:'Fixture',slug:'player-fixture',blocks:[0,1,2].map(i=>({id:`b_playerblock${i}`,type:'text',heading:`Section ${i+1}`,body:Array.from({length:45},(_,j)=>`Fixture word ${j+1}.`).join('\n\n')}))};
  let b=blog.saveBlog(article.slug,article,0);b=blog.publishBlog(b.slug,b.revision);const source=n.narrationExport(b.id),audioPath=join(dir,'tone.mp3');
  assert.equal(spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=30','-ar','24000','-ac','1','-c:a','libmp3lame',audioPath]).status,0);
  const audio=readFileSync(audioPath),duration=Number(JSON.parse(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',audioPath],{encoding:'utf8'}).stdout).format.duration);
  // Deliberately synthetic mapping verifies transport/player behavior only.
  const words=source.spokenWords.map((word,i)=>({...word,start:.1+i*.04,end:.13+i*.04,score:1}));
  const manifest={schema:source.schema,visibility:'published',articleId:b.id,sourceFingerprint:source.sourceFingerprint,voiceId:'heart',audioSha256:checksum(audio),duration,settings:{engine:'test-fixture',model:'sine-tone',alignment:'synthetic-fixture-only'},words,chapters:source.chapters.map((chapter,i)=>({id:chapter.id,start:words.find(w=>w.tokenId===chapter.firstTokenId).start,end:i+1<source.chapters.length?words.find(w=>w.tokenId===source.chapters[i+1].firstTokenId).start:duration}))};
  const recording=await n.importNarration(b.id,manifest,audio);n.activateNarration(recording.id,true,{sourceFingerprint:source.sourceFingerprint,activeId:null});
  let missing=false;const ranges=[];
  server=createServer((req,res)=>{
   if(req.url==='/blog/site.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(new URL('../public/site.js',import.meta.url)));return;}
   if(req.url===`/blog/api/narration/${b.slug}`){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(missing?{voices:[]}:n.publicNarrations(b.slug)));return;}
   if(req.url===recording.manifestUrl.replace('/api/admin','')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(n.narrationAsset(recording.id).manifest));return;}
   if(req.url===`/blog/narration/${recording.id}/manifest`){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(n.narrationAsset(recording.id).manifest));return;}
   if(req.url===`/blog/narration/${recording.id}/audio`){res.setHeader('Content-Type','audio/mpeg');res.setHeader('Accept-Ranges','bytes');if(req.headers.range){ranges.push(req.headers.range);const match=req.headers.range.match(/bytes=(\d+)-(\d*)/);const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),audio.length-1):audio.length-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${audio.length}`,'Content-Length':end-start+1});res.end(audio.subarray(start,end+1));}else{res.setHeader('Content-Length',audio.length);res.end(audio);}return;}
   res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:18px sans-serif;margin:24px}.blog-reader{position:fixed;right:12px;top:12px;background:white;border:1px solid;padding:12px;width:300px;z-index:2}.blog-body{width:min(50%,600px)}.reader-word-current{background:yellow}button{min-height:30px}</style></head><body>${blog.blogArticle({...blog.publishedBlog(b.slug).article,...blog.publishedBlog(b.slug)})}<script>window.BLOG_ENGINE={id:${JSON.stringify(config.id)},basePath:'/blog'}</script><script type="module" src="/blog/site.js"></script></body></html>`);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  const base=`http://127.0.0.1:${server.address().port}`;await page.goto(base+'/blog/player-fixture/');await page.waitForFunction(()=>document.querySelector('[data-reader-status]').textContent.startsWith('Ready'));
  const desired=words.find(w=>w.tokenId===source.chapters[2].firstTokenId);
  await page.locator('[data-reader-seek]').evaluate((seek,time)=>{seek.value=String(time);seek.dispatchEvent(new Event('input'));},desired.start+.01);
  assert.equal(await page.locator('.reader-word-current').first().getAttribute('data-narration-token'),desired.tokenId);
  await page.locator('[data-reader-rate="1.5"]').click();assert.equal(await page.locator('audio').evaluate(audio=>audio.playbackRate),1.5);
  await page.locator('[data-reader-action="forward"]').click();assert(Math.abs(await page.locator('audio').evaluate(audio=>audio.currentTime)-manifest.chapters[3].start)<.02);
  await page.locator('[data-reader-action="listen"]').click();await page.waitForFunction(()=>!document.querySelector('audio').paused);await page.waitForFunction(()=>window.scrollY>100);
  await page.keyboard.press('Escape');assert.equal(await page.locator('[data-reader-follow]').isChecked(),false);assert.equal(await page.locator('audio').evaluate(audio=>audio.paused),false);
  await page.locator('[data-reader-action="listen"]').click();assert.equal(await page.locator('audio').evaluate(audio=>audio.paused),true);
  assert(ranges.length>0,'browser requested real audio bytes');assert.deepEqual(errors,[]);
  missing=true;await page.goto(base+'/blog/player-fixture/');await page.waitForFunction(()=>document.querySelector('[data-reader-status]').textContent==='No saved narration is available.');
  assert(await page.locator('[data-reader-browser]').isVisible());assert(await page.locator('[data-reader-action="listen"]').isDisabled());
  await page.locator('[data-reader-browser]').click();assert.equal(await page.locator('[data-reader-kind]').textContent(),'BROWSER READING');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}db.close();rmSync(dir,{recursive:true,force:true});}
});
