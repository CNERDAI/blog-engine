import {mkdirSync,writeFileSync,renameSync,unlinkSync,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {db,dataDir} from './db.mjs';import {brand} from './brand.mjs';import {getBlogById,publishedBlog} from './blog.mjs';import {exportNarrationSource} from './narration-source.mjs';import {voices,validateManifest,audioLimit,checksum} from './narration-validation.mjs';
const run=promisify(execFile),root=resolve(dataDir,'narrations');mkdirSync(root,{recursive:true,mode:0o700});
const approvedVoices=Object.fromEntries(brand.voices.filter(v=>v.approved).map(v=>[v.id,{...(voices[v.id]||{}),...v,default:v.id==='heart'}]));
const voiceIdentity=id=>({...voices[id],...brand.voices.find(v=>v.id===id),label:brand.voices.find(v=>v.id===id)?.label||voices[id]?.label||id,default:id==='heart'});
const validate=(manifest,source,audio)=>validateManifest(manifest,source,audio,{approvedVoices});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
db.exec(`CREATE TABLE IF NOT EXISTS blog_narrations(id TEXT PRIMARY KEY,article_id TEXT NOT NULL,source_fingerprint TEXT NOT NULL,voice_id TEXT NOT NULL,audio_sha256 TEXT NOT NULL,file TEXT NOT NULL,manifest_json TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(article_id,source_fingerprint,voice_id,audio_sha256));CREATE INDEX IF NOT EXISTS blog_narrations_article ON blog_narrations(article_id,active);`);
export function narrationExport(articleId,visibility='published'){
 const blog=getBlogById(articleId);if(!blog)throw fail('Article not found.',404);if(!['published','draft'].includes(visibility))throw fail('Choose published or draft source.');const article=visibility==='draft'?blog.draft:blog.state==='published'?blog.published:null;if(!article)throw fail('This article has no published source.',409);return exportNarrationSource({id:blog.id,slug:blog.slug,article},{visibility,pronunciations:brand.pronunciations});
}
function record(row,{publicOnly=false}={}){if(!row)return null;const m=JSON.parse(row.manifest_json);return {id:row.id,articleId:row.article_id,sourceFingerprint:row.source_fingerprint,voiceId:row.voice_id,label:voiceIdentity(row.voice_id).label,default:voiceIdentity(row.voice_id).default,duration:m.duration,active:!!row.active,createdAt:row.created_at,audioSha256:row.audio_sha256,audioUrl:publicOnly?`${brand.basePath}/narration/${row.id}/audio`:`${brand.basePath}/api/admin/narration/${row.id}/audio`,manifestUrl:publicOnly?`${brand.basePath}/narration/${row.id}/manifest`:`${brand.basePath}/api/admin/narration/${row.id}/manifest`};}
export function narrationStatus(articleId){const blog=getBlogById(articleId);if(!blog)throw fail('Article not found.',404);const source=blog.state==='published'?narrationExport(articleId):null,draft=narrationExport(articleId,'draft');return {articleId,publishedSourceFingerprint:source?.sourceFingerprint||null,draftSourceFingerprint:draft.sourceFingerprint,...narrationJobStatus(articleId),recordings:db.prepare('SELECT * FROM blog_narrations WHERE article_id=? ORDER BY created_at DESC,id').all(articleId).map(row=>({...record(row),stale:row.source_fingerprint!==(JSON.parse(row.manifest_json).visibility==='draft'?draft.sourceFingerprint:source?.sourceFingerprint)}))};}
const importing=new Map();
export async function importNarration(articleId,manifest,audio){const source=narrationExport(articleId,manifest?.visibility==='draft'?'draft':'published');const m=validate(manifest,source,audio),key=[articleId,m.sourceFingerprint,m.voiceId,m.audioSha256].join(':');if(importing.has(key))return {...await importing.get(key),duplicate:true};const promise=importNarrationOnce(articleId,manifest,audio);importing.set(key,promise);try{return await promise;}finally{if(importing.get(key)===promise)importing.delete(key);}}
async function importNarrationOnce(articleId,manifest,audio){
 const source=narrationExport(articleId,manifest?.visibility==='draft'?'draft':'published'),validated=validate(manifest,source,audio),existing=db.prepare('SELECT * FROM blog_narrations WHERE article_id=? AND source_fingerprint=? AND voice_id=? AND audio_sha256=?').get(articleId,validated.sourceFingerprint,validated.voiceId,validated.audioSha256);if(existing&&existsSync(resolve(root,existing.file))){if(checksum(readFileSync(resolve(root,existing.file)))!==existing.audio_sha256)throw fail('Existing saved audio failed its checksum. Preserve it for recovery before repair.',409);return {...record(existing),duplicate:true};}
 const id=randomUUID(),file=id+'.mp3',temporary=resolve(root,id+'.upload'),target=resolve(root,file);writeFileSync(temporary,audio,{mode:0o600,flag:'wx'});
 try{const probe=await run(process.env.NARRATION_FFPROBE||'ffprobe',['-v','error','-protocol_whitelist','file','-show_entries','format=duration,format_name:stream=codec_name,codec_type,sample_rate,channels','-of','json',temporary],{timeout:20000,maxBuffer:200000});const metadata=JSON.parse(probe.stdout),streams=metadata.streams||[],duration=Number(metadata.format?.duration);if(metadata.format?.format_name!=='mp3'||streams.length!==1||streams[0].codec_type!=='audio'||streams[0].codec_name!=='mp3'||!Number.isFinite(duration)||Math.abs(duration-validated.duration)>.2)throw fail('Upload a real MP3 whose decoded duration matches the manifest.');await run(process.env.NARRATION_FFMPEG||'ffmpeg',['-v','error','-xerror','-protocol_whitelist','file','-f','mp3','-i',temporary,'-map','0:a:0','-f','null','-'],{timeout:120000,maxBuffer:200000});
 // Revalidate immediately before committing: publication may have changed during decode.
 validate(validated,narrationExport(articleId,source.visibility),audio);if(existing){renameSync(temporary,resolve(root,existing.file));return {...record(existing),duplicate:true,repaired:true};}db.exec('BEGIN IMMEDIATE');try{const raced=db.prepare('SELECT * FROM blog_narrations WHERE article_id=? AND source_fingerprint=? AND voice_id=? AND audio_sha256=?').get(articleId,validated.sourceFingerprint,validated.voiceId,validated.audioSha256);if(raced){db.exec('COMMIT');unlinkSync(temporary);return {...record(raced),duplicate:true};}renameSync(temporary,target);db.prepare('INSERT INTO blog_narrations(id,article_id,source_fingerprint,voice_id,audio_sha256,file,manifest_json) VALUES(?,?,?,?,?,?,?)').run(id,articleId,validated.sourceFingerprint,validated.voiceId,validated.audioSha256,file,JSON.stringify(validated));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return record(db.prepare('SELECT * FROM blog_narrations WHERE id=?').get(id));
 }catch(error){if(existsSync(temporary))unlinkSync(temporary);if(existsSync(target))unlinkSync(target);if(error.status)throw error;throw fail('MP3 decoding failed. Existing recordings were preserved.');}
}
export function activateNarration(id,active=true,expected){const row=db.prepare('SELECT * FROM blog_narrations WHERE id=?').get(id);if(!row)throw fail('Recording not found.',404);const current=db.prepare('SELECT id FROM blog_narrations WHERE article_id=? AND voice_id=? AND active=1').get(row.article_id,row.voice_id)?.id||null;if(!expected||expected.sourceFingerprint!==row.source_fingerprint||expected.activeId!==current)throw fail('Narration activation changed in another window. Reload before choosing activation.',409);if(active){const source=narrationExport(row.article_id);if(source.sourceFingerprint!==row.source_fingerprint||!existsSync(resolve(root,row.file))||checksum(readFileSync(resolve(root,row.file)))!==row.audio_sha256)throw fail('Recording is stale or its audio is missing. Import the current source recording.',409);}db.exec('BEGIN IMMEDIATE');try{if(active)db.prepare('UPDATE blog_narrations SET active=0 WHERE article_id=? AND voice_id=?').run(row.article_id,row.voice_id);db.prepare('UPDATE blog_narrations SET active=? WHERE id=?').run(active?1:0,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return record({...row,active:active?1:0});}
export function publicNarrations(slug){const blog=publishedBlog(slug);if(!blog)return null;const source=narrationExport(blog.id);return {articleId:blog.id,sourceFingerprint:source.sourceFingerprint,voices:db.prepare('SELECT * FROM blog_narrations WHERE article_id=? AND source_fingerprint=? AND active=1').all(blog.id,source.sourceFingerprint).filter(row=>existsSync(resolve(root,row.file))&&checksum(readFileSync(resolve(root,row.file)))===row.audio_sha256).sort((a,b)=>Number(voiceIdentity(b.voice_id).default)-Number(voiceIdentity(a.voice_id).default)).map(row=>record(row,{publicOnly:true}))};}
export function narrationAsset(id,admin=false){const row=db.prepare('SELECT * FROM blog_narrations WHERE id=?').get(id);if(!row||!existsSync(resolve(root,row.file)))return null;if(!admin&&checksum(readFileSync(resolve(root,row.file)))!==row.audio_sha256)return null;if(!admin){const blog=getBlogById(row.article_id);if(!blog||blog.state!=='published'||!row.active||narrationExport(row.article_id).sourceFingerprint!==row.source_fingerprint)return null;}const m=JSON.parse(row.manifest_json);if(!admin){const source=narrationExport(row.article_id);m.chapters=source.chapters.map((c,i)=>({...c,start:m.words.find(w=>w.tokenId===c.firstTokenId).start,end:i+1<source.chapters.length?m.words.find(w=>w.tokenId===source.chapters[i+1].firstTokenId).start:m.duration}));}return {path:resolve(root,row.file),manifest:admin?m:{schema:m.schema,articleId:m.articleId,sourceFingerprint:m.sourceFingerprint,voiceId:m.voiceId,duration:m.duration,words:m.words,chapters:m.chapters}};}
let importRequests=0;
export async function adminNarrationRoutes(req,res,url,{readBody,json,rate,serveFile}){const pathname=url.pathname.startsWith(brand.basePath+'/api/admin/narration')?url.pathname.slice(brand.basePath.length):url.pathname;const m=pathname.match(/^\/api\/admin\/narration(?:\/([a-zA-Z0-9-]+))?(?:\/(export|import|activate|audio|manifest))?$/);if(!m)return false;res.setHeader('Cache-Control','private, no-store');const [,id,action]=m;if(!id)throw fail('Choose an article.',400);if(action==='export'&&req.method==='GET'){json(res,200,narrationExport(id,url.searchParams.get('source')||'published'));return true;}if(!action&&req.method==='GET'){json(res,200,narrationStatus(id));return true;}if(action==='import'&&req.method==='POST'){rate(req,'narration-import',6,60);if(importRequests>=2)throw fail('Two narration imports are already validating. Try again shortly.',429);importRequests++;try{const body=await readBody(req,Math.ceil(audioLimit*4/3)+2_000_000);json(res,200,await importNarration(id,body.manifest,Buffer.from(String(body.audioBase64||''),'base64')));return true;}finally{importRequests--;}}if(action==='activate'&&req.method==='POST'){const b=await readBody(req,4096);if(typeof b.active!=='boolean')throw fail('Choose an explicit activation state.');json(res,200,activateNarration(id,b.active,{sourceFingerprint:b.expectedSourceFingerprint,activeId:b.expectedActiveId}));return true;}if(['audio','manifest'].includes(action)&&['GET','HEAD'].includes(req.method)){const a=narrationAsset(id,true);if(!a)throw fail('Recording not found.',404);if(action==='audio')serveFile(req,res,a.path,'audio/mpeg',{cacheControl:'private, no-store'});else json(res,200,a.manifest);return true;}throw fail('Method not allowed.',405);}

// Durable handoff only. No inference, paid provider, private reference or model is
// invoked by requesting a job or by public playback.
db.exec(`CREATE TABLE IF NOT EXISTS blog_narration_jobs(
 id TEXT PRIMARY KEY, article_id TEXT NOT NULL, brand_id TEXT NOT NULL,
 source_fingerprint TEXT NOT NULL, visibility TEXT NOT NULL, voice_id TEXT NOT NULL,
 cache_key TEXT NOT NULL UNIQUE, request_key TEXT NOT NULL UNIQUE,
 request_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'waiting_for_producer',
 recording_id TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);CREATE TABLE IF NOT EXISTS blog_narration_requests(request_key TEXT PRIMARY KEY,cache_key TEXT NOT NULL,job_id TEXT NOT NULL);`);
const producer=()=>({available:false,mode:'manual-package',customVoiceVerified:false,reason:'No local narration producer is connected. Export the private source package and import audio with measured alignment.'});
export function narrationCapabilities(){return {approvedVoices:Object.entries(approvedVoices).map(([id,v])=>({id,label:v.label,kind:v.kind||'unverified',default:!!v.default})),producer:producer(),playback:'saved-audio',schema:'cnerd-narration-v1'};}
const articleId=value=>typeof value==='string'?value:value?.id;
function jobRecord(row){
 const blog=getBlogById(row.article_id);let state=row.state;
 let source;try{if(blog)source=narrationExport(row.article_id,row.visibility);}catch{}
 if(!source||source.sourceFingerprint!==row.source_fingerprint)state='stale';
 else if(row.recording_id&&db.prepare('SELECT active FROM blog_narrations WHERE id=?').get(row.recording_id)?.active)state='active';
 return {id:row.id,jobId:row.id,articleId:row.article_id,brandId:row.brand_id,sourceFingerprint:row.source_fingerprint,visibility:row.visibility,voiceId:row.voice_id,state,recordingId:row.recording_id||null,error:row.error||null,createdAt:row.created_at,updatedAt:row.updated_at};
}
export function narrationJobStatus(record){
 const id=articleId(record);if(!getBlogById(id))throw fail('Article not found.',404);
 const jobs=db.prepare('SELECT * FROM blog_narration_jobs WHERE article_id=? ORDER BY created_at DESC,rowid DESC').all(id).map(jobRecord);
 return {state:jobs[0]?.state||'not_requested',producer:producer(),jobs};
}
function requestSettings(options){
 const settings={engine:options.engine||'external-local',model:options.model||'unverified',...(options.settings||{})};
 const safe={};
 for(const [key,value]of Object.entries(settings).sort(([a],[b])=>a.localeCompare(b))){
  if(!['engine','model','voice','speed','language','sampleRate','channels','alignment'].includes(key)||!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||String(value).length>200||(/[\\]/.test(String(value))||String(value).startsWith('/')||String(value).includes('://')||String(value).includes('..')||key!=='model'&&String(value).includes('/')))throw fail('Producer settings must contain only public engine/model/settings identifiers.');
  safe[key]=value;
 }
 return safe;
}
export function requestNarration(record,options={}){
 const id=articleId(record),visibility=options.visibility||'draft',source=narrationExport(id,visibility);
 if(options.sourceFingerprint!==source.sourceFingerprint)throw fail('Narration source changed. Export the current spoken source before requesting generation.',409);
 if(!Object.hasOwn(approvedVoices,options.voiceId))throw fail('Choose a voice approved for this brand.',422);
 if(typeof options.idempotencyKey!=='string'||!/^[-a-zA-Z0-9_:.]{8,120}$/.test(options.idempotencyKey))throw fail('Provide an 8–120 character idempotency key.',422);
 const settings=requestSettings(options),request={brandId:brand.id,articleId:id,sourceFingerprint:source.sourceFingerprint,visibility,voiceId:options.voiceId,settings};
 const cacheKey=checksum(Buffer.from(JSON.stringify(request))),requestKey=checksum(Buffer.from(`${brand.id}:${id}:${options.idempotencyKey}`));
 const prior=db.prepare('SELECT j.* FROM blog_narration_jobs j JOIN blog_narration_requests r ON r.job_id=j.id WHERE r.request_key=?').get(requestKey);
 if(prior){if(prior.cache_key!==cacheKey)throw fail('This narration idempotency key belongs to different inputs.',409);return {...jobRecord(prior),duplicate:true,producer:producer()};}
 const cached=db.prepare('SELECT * FROM blog_narration_jobs WHERE cache_key=?').get(cacheKey);
 if(cached){db.prepare('INSERT INTO blog_narration_requests(request_key,cache_key,job_id) VALUES(?,?,?)').run(requestKey,cacheKey,cached.id);return {...jobRecord(cached),duplicate:true,producer:producer()};}
 const jobId=randomUUID();db.prepare('INSERT INTO blog_narration_jobs(id,article_id,brand_id,source_fingerprint,visibility,voice_id,cache_key,request_key,request_json) VALUES(?,?,?,?,?,?,?,?,?)').run(jobId,id,brand.id,source.sourceFingerprint,visibility,options.voiceId,cacheKey,requestKey,JSON.stringify(request));
 db.prepare('INSERT INTO blog_narration_requests(request_key,cache_key,job_id) VALUES(?,?,?)').run(requestKey,cacheKey,jobId);
 return {...jobRecord(db.prepare('SELECT * FROM blog_narration_jobs WHERE id=?').get(jobId)),duplicate:false,producer:producer()};
}
export function narrationJobPackage(id){
 const row=db.prepare('SELECT * FROM blog_narration_jobs WHERE id=?').get(id);if(!row)throw fail('Narration job not found.',404);
 const job=jobRecord(row);if(job.state==='stale')throw fail('Narration source changed. Request a new package.',409);
 return {schema:'cnerd-narration-job-v1',...job,...JSON.parse(row.request_json),source:narrationExport(row.article_id,row.visibility),policy:'Generate once locally in the approved voice. Measure alignment against the final decoded MP3. No private references or synthetic timing claims in production imports.'};
}
// Server must authenticate a scoped producer and check article ownership before
// calling this helper. The helper cannot publish or activate a recording.
export async function importProducedNarration(jobId,manifest,audio){
 const row=db.prepare('SELECT * FROM blog_narration_jobs WHERE id=?').get(jobId);if(!row)throw fail('Narration job not found.',404);
 const job=jobRecord(row);if(job.state==='stale')throw fail('Narration source changed.',409);
 const settings=JSON.parse(row.request_json).settings;
 if(manifest?.articleId!==row.article_id||manifest.sourceFingerprint!==row.source_fingerprint||manifest.voiceId!==row.voice_id||manifest.visibility!==row.visibility||manifest.settings?.engine!==settings.engine||manifest.settings?.model!==settings.model)throw fail('Producer output does not match the requested job.',409);
 if(!manifest.settings?.alignment||/synthetic|fixture|guessed|uniform/i.test(manifest.settings.alignment))throw fail('Production imports require an identified acoustic alignment method. Synthetic fixture timings are test-only.',422);
 const recording=await importNarration(row.article_id,manifest,audio);
 db.prepare("UPDATE blog_narration_jobs SET state='ready_for_review',recording_id=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(recording.id,jobId);
 return {...jobRecord(db.prepare('SELECT * FROM blog_narration_jobs WHERE id=?').get(jobId)),recording};
}
export function updateNarrationJob(id,state){
 if(!['generating','failed'].includes(state))throw fail('Producer may only mark generating or failed.',422);
 const row=db.prepare('SELECT * FROM blog_narration_jobs WHERE id=?').get(id);if(!row)throw fail('Narration job not found.',404);
 if(!['waiting_for_producer','generating','failed'].includes(jobRecord(row).state))throw fail('This job cannot change producer state.',409);
 db.prepare('UPDATE blog_narration_jobs SET state=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(state,state==='failed'?'The producer reported failure. Draft and recordings were preserved.':null,id);
 return jobRecord(db.prepare('SELECT * FROM blog_narration_jobs WHERE id=?').get(id));
}
