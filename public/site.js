// Standalone blog enhancements: reading works without this module.
const blogConfig=window.BLOG_ENGINE||{};
const blogBasePath=String(blogConfig.basePath||'/blog').replace(/\/$/,'');
const readerPreferenceKey=['cnerd','cnerd-ai'].includes(blogConfig.id)?'cnerd-reader-preferences':`blog-reader-preferences:${blogConfig.id||blogBasePath}`;
const motion=matchMedia('(prefers-reduced-motion: reduce)');
export async function copy(text){try{await navigator.clipboard.writeText(text);return true;}catch{return false;}}
document.querySelectorAll('.copy-text').forEach(button=>button.addEventListener('click',async()=>{const ok=await copy(button.dataset.copy||'');const status=document.querySelector('#toast');if(status)status.textContent=ok?'Copied.':'Copy unavailable. Select the text and copy it manually.';}));
function validPlaybackManifest(data){
 if(!Number.isFinite(data.duration)||data.duration<=0||!Array.isArray(data.words)||!data.words.length||!Array.isArray(data.chapters)||!data.chapters.length)return false;
 let previous=0;
 for(const word of data.words){if(!/^t\d+$/.test(word.tokenId)||![word.start,word.end].every(Number.isFinite)||word.start<previous-.001||word.end<=word.start||word.end>data.duration+.05)return false;previous=word.end;}
 return data.chapters.every(chapter=>[chapter.start,chapter.end].every(Number.isFinite)&&chapter.start>=0&&chapter.end>chapter.start&&chapter.end<=data.duration+.05);
}

// The section map follows the viewport, independently of narration and speech support.
document.querySelectorAll('.blog-article').forEach(article=>{
 const body=article.querySelector('.blog-body'),links=[...article.querySelectorAll('[data-section-link]')],header=document.querySelector('.site-header');
 if(!body||!links.length)return;
 const sections=links.map(link=>({link,target:document.getElementById(link.dataset.sectionLink)})).filter(section=>section.target&&article.contains(section.target));
 if(!sections.length)return;
 let activeSection=null,frame=0;
 const update=()=>{
  frame=0;
  const offset=(header?.getBoundingClientRect().height||0)+16;
  article.style.setProperty('--blog-anchor-offset',`${offset}px`);
  let section=sections[0];
  for(const candidate of sections.slice(1)){
   if(candidate.target.getBoundingClientRect().top>offset+1)break;
   section=candidate;
  }
  // At the document end a short final section may never reach the reading line.
  if(scrollY>0&&scrollY+innerHeight>=document.documentElement.scrollHeight-1&&body.getBoundingClientRect().top<offset)section=sections.at(-1);
  if(activeSection===section)return;
  activeSection=section;
  links.forEach(link=>{
   const active=link===section.link;
   link.classList.toggle('active',active);
   if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
  });
 };
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 window.addEventListener('scroll',schedule,{passive:true});
 ['resize','hashchange','popstate','pageshow','load'].forEach(event=>window.addEventListener(event,schedule));
 // Recompute after fonts, reader settings, media, or responsive layout change geometry.
 if('ResizeObserver'in window){const observer=new ResizeObserver(schedule);observer.observe(article);if(header)observer.observe(header);}
 article.addEventListener('load',schedule,true);
 document.fonts?.ready.then(schedule);
 update();
 // Safari may resolve a fresh hash before article images and fonts finish shifting it.
 // Finish that initial navigation once, unless the visitor has started interacting.
 const initialHash=location.hash;
 let initialTarget=null;
 try{initialTarget=document.getElementById(decodeURIComponent(initialHash.slice(1)));}catch{}
 if(initialTarget&&article.contains(initialTarget)){
  let interrupted=false;
  const interrupt=()=>{interrupted=true;};
  const inputs=['wheel','touchstart','pointerdown','keydown','hashchange','popstate'];
  inputs.forEach(event=>window.addEventListener(event,interrupt,{passive:true}));
  let onLoad,timer;
  const loaded=document.readyState==='complete'?Promise.resolve():new Promise(resolve=>{onLoad=resolve;window.addEventListener('load',onLoad,{once:true});});
  const ready=Promise.all([loaded,document.fonts?.ready]).then(()=>true);
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);});
  Promise.race([ready,timeout]).then(settled=>{
   clearTimeout(timer);
   if(onLoad)window.removeEventListener('load',onLoad);
   inputs.forEach(event=>window.removeEventListener(event,interrupt));
   if(settled&&!interrupted&&location.hash===initialHash){update();initialTarget.scrollIntoView({block:'start',behavior:'instant'});}
   schedule();
  });
 }
});

// Follow existing highlighted text without repeatedly moving visible words.
function narratorFollower(isActive){
 let pending=null,timer=0,lastScroll=-Infinity,scrolling=false,freezeFrame=0;
 const cancel=()=>{
  clearTimeout(timer);timer=0;pending=null;lastScroll=-Infinity;cancelAnimationFrame(freezeFrame);freezeFrame=0;
  if(scrolling){const top=scrollY;window.scrollTo({top,behavior:'instant'});
   // Chrome can finish one queued animation step after an instant cancellation.
   freezeFrame=requestAnimationFrame(()=>{freezeFrame=0;window.scrollTo({top,behavior:'instant'});});
  }scrolling=false;
 };
 const flush=()=>{
  timer=0;if(!isActive()||document.hidden){cancel();return;}
  const target=pending;pending=null;if(!target?.isConnected)return;
  const rect=target.getClientRects()[0];if(!rect)return;
  const header=document.querySelector('.site-header')?.getBoundingClientRect();
  const top=Math.max(0,header?.bottom||0)+20,bottom=innerHeight-40,available=bottom-top;
  if(available<=0||rect.top>=top&&(rect.bottom<=bottom||rect.height>available))return;
  lastScroll=performance.now();scrolling=!motion.matches;
  window.scrollTo({top:Math.max(0,scrollY+rect.top-top-available/3),behavior:motion.matches?'instant':'smooth'});
 };
 const request=target=>{
  if(!isActive()||document.hidden){if(pending||timer||scrolling)cancel();return;}if(!target)return;cancelAnimationFrame(freezeFrame);freezeFrame=0;pending=target;
  if(timer)return;const delay=Math.max(0,500-(performance.now()-lastScroll));
  if(delay)timer=setTimeout(flush,delay);else flush();
 };
 return {request,cancel};
}

// Explicit fallback uses the browser's speech service and its available voices.
function initializeBrowserReader(reader){
 const article=reader.closest('.blog-article'),listen=reader.querySelector('[data-reader-action="listen"]'),listenLabel=reader.querySelector('[data-reader-listen-label]'),back=reader.querySelector('[data-reader-action="back"]'),forward=reader.querySelector('[data-reader-action="forward"]'),status=reader.querySelector('[data-reader-status]'),seek=reader.querySelector('[data-reader-seek]'),time=reader.querySelector('[data-reader-time]'),units=[...article.querySelectorAll('[data-reader-unit]')],supported='speechSynthesis'in window&&'SpeechSynthesisUtterance'in window;
 const preferenceKey=readerPreferenceKey;let preferences={font:0,spacing:false,contrast:false,rate:1,followNarrator:true};try{preferences={...preferences,...JSON.parse(localStorage.getItem(preferenceKey)||'{}')}}catch{}
 let current=0,reading=false,paused=false,startedAt=0,elapsedBeforePause=0,timer=0;
 const follow=reader.querySelector('[data-reader-follow]'),follower=narratorFollower(()=>preferences.followNarrator!==false&&reading&&!paused);
 const textFor=unit=>{const copy=unit.cloneNode(true);copy.querySelectorAll('button,input,video,[aria-hidden="true"]').forEach(item=>item.remove());return copy.textContent.replace(/\s+/g,' ').trim();};
 const nameFor=unit=>unit.querySelector('h2')?.textContent.trim()||`Part ${current+1}`;
 const savePreferences=()=>{try{localStorage.setItem(preferenceKey,JSON.stringify(preferences))}catch{}};
 const format=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
 const estimate=Math.max(1,Math.ceil(units.map(textFor).join(' ').split(/\s+/).filter(Boolean).length/(150*preferences.rate)*60));
 const applyPreferences=()=>{follow.checked=preferences.followNarrator!==false;article.classList.toggle('reader-spacious',Boolean(preferences.spacing));article.classList.toggle('reader-high-contrast',Boolean(preferences.contrast));article.style.setProperty('--reader-font-scale',String(1+preferences.font*.1));reader.querySelector('[data-reader-spacing]').setAttribute('aria-pressed',String(Boolean(preferences.spacing)));reader.querySelector('[data-reader-contrast]').setAttribute('aria-pressed',String(Boolean(preferences.contrast)));reader.querySelectorAll('[data-reader-rate]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.readerRate)===preferences.rate)));};
 const updateProgress=()=>{const value=units.length?Math.min(100,Math.round((current/units.length)*100)):0;seek.value=String(value);time.textContent=`${format(elapsedBeforePause+(reading&&!paused?(Date.now()-startedAt)/1000:0))} / ~${format(estimate)}`;};
 const clearCurrent=()=>{units.forEach(unit=>{unit.classList.remove('reader-current');unit.querySelectorAll('.reader-word-current').forEach(word=>word.classList.remove('reader-word-current'));});};
 const clearTimer=()=>{if(timer)clearInterval(timer);timer=0;};
 const updateControls=()=>{listenLabel.textContent=reading?(paused?'▶':'Ⅱ'):'▶';listen.setAttribute('aria-label',reading?(paused?'Resume reading':'Pause reading'):'Listen to this article');};
 const highlightWord=(unit,wordIndex)=>{const words=[...unit.querySelectorAll('[data-reader-word]')];words.forEach(word=>word.classList.remove('reader-word-current'));words[wordIndex]?.classList.add('reader-word-current');follower.request(words[wordIndex]);};
 const prepareWords=unit=>{if(unit.dataset.readerPrepared)return [...unit.querySelectorAll('[data-reader-word]')];let count=0;const walker=document.createTreeWalker(unit,NodeFilter.SHOW_TEXT,{acceptNode(node){return node.parentElement.closest('button,script,style')?NodeFilter.FILTER_REJECT:node.nodeValue.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}}),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);nodes.forEach(node=>{const fragment=document.createDocumentFragment();node.nodeValue.split(/(\s+)/).forEach(part=>{if(!part)return;if(/^\s+$/.test(part)){fragment.append(part);return;}const word=document.createElement('span');word.dataset.readerWord=String(count++);word.textContent=part;fragment.append(word);});node.replaceWith(fragment);});unit.dataset.readerPrepared='true';return [...unit.querySelectorAll('[data-reader-word]')];};
 const finish=message=>{follower.cancel();reading=false;paused=false;clearTimer();clearCurrent();status.textContent=message;updateControls();};
 const stopReading=message=>{if(supported)window.speechSynthesis.cancel();finish(message);current=0;elapsedBeforePause=0;updateProgress();};
 const readNext=()=>{
  if(!reading)return;
  if(current>=units.length){finish('Finished reading');current=units.length;updateProgress();return;}
  const unit=units[current],text=textFor(unit);
  if(!text){current++;readNext();return;}
  clearCurrent();unit.classList.add('reader-current');prepareWords(unit);status.textContent=`Listening: ${nameFor(unit)}`;updateProgress();
  follower.request(unit.querySelector('[data-reader-word]')||unit);
  const utterance=new SpeechSynthesisUtterance(text);utterance.rate=preferences.rate;
  utterance.onboundary=event=>{if(event.name!=='word'||!reading)return;highlightWord(unit,text.slice(0,event.charIndex).trim().split(/\s+/).filter(Boolean).length);};
  utterance.onend=()=>{if(!reading)return;current++;readNext();};
  utterance.onerror=event=>{if(!reading||event.error==='canceled'||event.error==='interrupted')return;finish('Reading stopped.');};
  window.speechSynthesis.speak(utterance);
 };
 applyPreferences();updateProgress();
 follow.addEventListener('change',()=>{preferences.followNarrator=follow.checked;savePreferences();if(follow.checked)follower.request(article.querySelector('.reader-word-current')||units[current]?.querySelector('[data-reader-word]')||units[current]);else follower.cancel();});
 reader.querySelectorAll('[data-reader-font]').forEach(button=>button.addEventListener('click',()=>{preferences.font=Math.max(-2,Math.min(3,preferences.font+Number(button.dataset.readerFont)));applyPreferences();savePreferences();}));
 reader.querySelector('[data-reader-spacing]').addEventListener('click',()=>{preferences.spacing=!preferences.spacing;applyPreferences();savePreferences();});
 reader.querySelector('[data-reader-contrast]').addEventListener('click',()=>{preferences.contrast=!preferences.contrast;applyPreferences();savePreferences();});
 reader.querySelectorAll('[data-reader-rate]').forEach(button=>button.addEventListener('click',()=>{preferences.rate=Number(button.dataset.readerRate);savePreferences();if(reading)stopReading('Speed updated. Choose listen to restart.');applyPreferences();}));
 if(!supported){listen.disabled=true;back.disabled=true;forward.disabled=true;status.textContent='Listening is not available in this browser.';return;}
 listen.addEventListener('click',()=>{if(reading){if(paused){window.speechSynthesis.resume();paused=false;follower.request(article.querySelector('.reader-word-current')||units[current]?.querySelector('[data-reader-word]')||units[current]);startedAt=Date.now();timer=setInterval(updateProgress,500);status.textContent=`Listening: ${nameFor(units[current])}`;}else{window.speechSynthesis.pause();paused=true;follower.cancel();elapsedBeforePause+=(Date.now()-startedAt)/1000;clearTimer();status.textContent='Reading paused.';}updateControls();return;}if(current>=units.length)current=0;reading=true;paused=false;startedAt=Date.now();timer=setInterval(updateProgress,500);updateControls();readNext();});
 back.addEventListener('click',()=>{current=Math.max(0,current-1);if(reading){window.speechSynthesis.cancel();readNext();}else{units[current]?.scrollIntoView({block:'center',behavior:motion.matches?'auto':'smooth'});}updateProgress();});
 forward.addEventListener('click',()=>{current=Math.min(units.length-1,current+1);if(reading){window.speechSynthesis.cancel();readNext();}else{units[current]?.scrollIntoView({block:'center',behavior:motion.matches?'auto':'smooth'});}updateProgress();});
 seek.addEventListener('input',()=>{current=Math.min(units.length-1,Math.floor(Number(seek.value)/100*units.length));if(reading){window.speechSynthesis.cancel();readNext();}updateProgress();});
 const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting||reading)return;const index=units.indexOf(entry.target);if(index>=0){current=index;updateProgress();}}),{rootMargin:'-18% 0px -65% 0px',threshold:0});units.forEach(unit=>observer.observe(unit));
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&reading&&!paused){window.speechSynthesis.pause();paused=true;follower.cancel();elapsedBeforePause+=(Date.now()-startedAt)/1000;clearTimer();status.textContent='Reading paused.';updateControls();}});
}
// Copy code only after the clipboard confirms success; retain exact node text.
document.addEventListener('click',async event=>{const button=event.target.closest?.('.code-copy');if(!button||button.closest('.cnerd-workspace'))return;const window=button.closest('.cnerd-code'),status=window.querySelector('.code-feedback');try{await navigator.clipboard.writeText(window.querySelector('code').textContent);if(status)status.textContent='Copied';setTimeout(()=>{if(status)status.textContent='';},2500);}catch{if(status)status.textContent='Copy failed. Select the code and copy it manually.';}});

// Saved narration uses the browser audio clock and imported word alignment times.
function initializeSavedReader(reader){
 const article=reader.closest('.blog-article'),listen=reader.querySelector('[data-reader-action="listen"]'),label=reader.querySelector('[data-reader-listen-label]'),status=reader.querySelector('[data-reader-status]'),seek=reader.querySelector('[data-reader-seek]'),time=reader.querySelector('[data-reader-time]'),select=reader.querySelector('[data-reader-voice]'),fallback=reader.querySelector('[data-reader-browser]'),buttons=[listen,...reader.querySelectorAll('[data-reader-action="back"],[data-reader-action="forward"],[data-reader-rate]')];
 let audio=null,manifest=null,epoch=0,request=null,frame=0,highlight=null,highlightNode=null,voices=[],restore=null;reader.dataset.readerMode='saved';
 let preferences={font:0,spacing:false,contrast:false,rate:1,followNarrator:true};try{preferences={...preferences,...JSON.parse(localStorage.getItem(readerPreferenceKey)||'{}')}}catch{}
 if(![1,1.25,1.5,2].includes(preferences.rate))preferences.rate=1;
 const follow=reader.querySelector('[data-reader-follow]'),follower=narratorFollower(()=>reader.dataset.readerMode==='saved'&&preferences.followNarrator!==false&&audio&&!audio.paused&&!audio.ended);
 const format=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
 const save=()=>{try{localStorage.setItem(readerPreferenceKey,JSON.stringify(preferences))}catch{}};
 const apply=()=>{follow.checked=preferences.followNarrator!==false;article.classList.toggle('reader-spacious',!!preferences.spacing);article.classList.toggle('reader-high-contrast',!!preferences.contrast);article.style.setProperty('--reader-font-scale',String(1+preferences.font*.1));reader.querySelector('[data-reader-spacing]').setAttribute('aria-pressed',String(!!preferences.spacing));reader.querySelector('[data-reader-contrast]').setAttribute('aria-pressed',String(!!preferences.contrast));reader.querySelectorAll('[data-reader-rate]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.readerRate)===preferences.rate)));};apply();
 const clear=()=>{article.querySelectorAll('.reader-word-current').forEach(n=>n.classList.remove('reader-word-current'));highlight=null;highlightNode=null;};
 const stop=()=>{follower.cancel();epoch++;request?.abort();request=null;cancelAnimationFrame(frame);frame=0;if(audio){audio.pause();audio.removeAttribute('src');audio.load();audio.remove();audio=null;}manifest=null;clear();label.textContent='▶';listen.setAttribute('aria-label','Listen to this article');seek.value='0';time.textContent='0:00 / —';};
 const enabled=value=>{buttons.forEach(b=>b.disabled=!value);seek.disabled=!value;};
 const unavailable=message=>{enabled(false);status.textContent=message;fallback.hidden=false;};
 const update=()=>{if(!audio||!manifest)return;const clock=audio.currentTime||0;seek.value=String(clock);time.textContent=`${format(clock)} / ${format(manifest.duration)}`;let lo=0,hi=manifest.words.length-1,word=null;while(lo<=hi){const mid=(lo+hi)>>1,w=manifest.words[mid];if(clock<w.start)hi=mid-1;else if(clock>=w.end)lo=mid+1;else{word=w;break;}}if(word?.tokenId!==highlight){clear();if(word){highlight=word.tokenId;article.querySelectorAll(`[data-narration-token="${word.tokenId}"]`).forEach(n=>{n.classList.add('reader-word-current');highlightNode||=n;});}}follower.request(highlightNode);};
 const tick=()=>{update();if(audio&&!audio.paused&&!audio.ended)frame=requestAnimationFrame(tick);};
 const loadVoice=async (voice,position=0)=>{stop();select.value=voice.id;reader.dataset.readerMode='saved';fallback.hidden=true;enabled(false);status.textContent='Loading saved narration…';const generation=epoch;request=new AbortController();try{const response=await fetch(voice.manifestUrl,{signal:request.signal});if(!response.ok)throw new Error('Saved narration could not be loaded.');const data=await response.json();if(generation!==epoch)return;if(data.sourceFingerprint!==article.dataset.narrationSource||data.articleId!==article.dataset.narrationArticle||!validPlaybackManifest(data))throw new Error('Saved narration does not match this article.');manifest=data;const player=new Audio();player.hidden=true;player.dataset.savedNarration='';reader.append(player);audio=player;player.preload='metadata';player.defaultPlaybackRate=preferences.rate;player.playbackRate=preferences.rate;
   const active=()=>generation===epoch&&audio===player&&reader.dataset.readerMode==='saved';
   player.addEventListener('loadedmetadata',()=>{if(!active())return;if(!Number.isFinite(player.duration)||Math.abs(player.duration-data.duration)>.25){stop();unavailable('Saved audio duration is invalid.');return;}select.value=voice.id;player.defaultPlaybackRate=preferences.rate;player.playbackRate=preferences.rate;seek.max=String(data.duration);seek.step='0.01';if(position>0)player.currentTime=Math.min(position,data.duration);enabled(true);status.textContent=`Ready · ${voice.label}`;update();});
   player.addEventListener('play',()=>{if(!active())return;label.textContent='Ⅱ';listen.setAttribute('aria-label','Pause narration');status.textContent=`Listening · ${voice.label}`;cancelAnimationFrame(frame);tick();});
   player.addEventListener('pause',()=>{if(!active())return;follower.cancel();cancelAnimationFrame(frame);frame=0;label.textContent='▶';listen.setAttribute('aria-label','Resume narration');status.textContent=player.ended?'Finished listening':'Narration paused';update();});
   player.addEventListener('ended',()=>{if(!active())return;follower.cancel();cancelAnimationFrame(frame);clear();label.textContent='▶';listen.setAttribute('aria-label','Replay narration');status.textContent='Finished listening';seek.value=String(data.duration);time.textContent=`${format(data.duration)} / ${format(data.duration)}`;});
   for(const event of ['timeupdate','seeked','ratechange','playing','waiting','stalled'])player.addEventListener(event,()=>{if(!active())return;update();if(['waiting','stalled'].includes(event))status.textContent='Buffering saved narration…';if(event==='playing')status.textContent=`Listening · ${voice.label}`;});
   player.addEventListener('error',()=>{if(!active())return;stop();unavailable('Saved audio is unavailable. Try again or choose browser reading.');});player.src=voice.audioUrl;player.load();
  }catch(error){if(generation!==epoch||error.name==='AbortError')return;stop();unavailable(error.message||'Saved narration is unavailable.');}};
 listen.addEventListener('click',async()=>{if(reader.dataset.readerMode!=='saved'||!audio)return;if(!audio.paused){audio.pause();return;}if(audio.ended)audio.currentTime=0;try{await audio.play();}catch{status.textContent='Playback could not start. Choose Listen to retry.';}});
 seek.addEventListener('input',()=>{if(reader.dataset.readerMode==='saved'&&audio){audio.currentTime=Math.min(manifest.duration,Math.max(0,Number(seek.value)));update();}});
 const chapterJump=direction=>{if(reader.dataset.readerMode!=='saved'||!audio)return;const t=audio.currentTime,chapters=manifest.chapters;let index=chapters.findLastIndex(c=>c.start<=t+.01);index=direction<0&&t-(chapters[Math.max(0,index)]?.start||0)>3?index:Math.max(0,Math.min(chapters.length-1,index+direction));audio.currentTime=chapters[index].start;update();};
 reader.querySelector('[data-reader-action="back"]').addEventListener('click',()=>chapterJump(-1));reader.querySelector('[data-reader-action="forward"]').addEventListener('click',()=>chapterJump(1));
 reader.querySelectorAll('[data-reader-rate]').forEach(b=>b.addEventListener('click',()=>{if(reader.dataset.readerMode!=='saved')return;preferences.rate=Number(b.dataset.readerRate);if(audio){audio.defaultPlaybackRate=preferences.rate;audio.playbackRate=preferences.rate;}save();apply();update();}));
 reader.querySelectorAll('[data-reader-font]').forEach(b=>b.addEventListener('click',()=>{if(reader.dataset.readerMode!=='saved')return;preferences.font=Math.max(-2,Math.min(3,preferences.font+Number(b.dataset.readerFont)));save();apply();}));
 reader.querySelector('[data-reader-spacing]').addEventListener('click',()=>{if(reader.dataset.readerMode!=='saved')return;preferences.spacing=!preferences.spacing;save();apply();});reader.querySelector('[data-reader-contrast]').addEventListener('click',()=>{if(reader.dataset.readerMode!=='saved')return;preferences.contrast=!preferences.contrast;save();apply();});
 follow.addEventListener('change',()=>{if(reader.dataset.readerMode!=='saved')return;preferences.followNarrator=follow.checked;save();if(follow.checked)follower.request(highlightNode);else follower.cancel();});
 select.addEventListener('change',()=>loadVoice(voices.find(v=>v.id===select.value)));
 fallback.addEventListener('click',()=>{stop();reader.dataset.readerMode='browser';reader.querySelector('[data-reader-kind]').textContent='BROWSER READING';fallback.hidden=true;select.disabled=true;seek.max='100';seek.step='1';enabled(true);initializeBrowserReader(reader);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)follower.cancel();else update();});window.addEventListener('pagehide',event=>{if(event.persisted&&reader.dataset.readerMode==='saved')restore={voiceId:select.value,position:audio?.currentTime||0};stop();enabled(false);});window.addEventListener('pageshow',event=>{if(!event.persisted)return;if(reader.dataset.readerMode==='browser'){enabled(true);return;}const previous=restore;restore=null;const voice=voices.find(v=>v.id===previous?.voiceId)||voices.find(v=>v.default)||voices[0];if(voice)loadVoice(voice,previous?.position||0);else discover();});
 const discover=async()=>{status.textContent='Loading narration options…';enabled(false);try{const response=await fetch(`${blogBasePath}/api/narration/${encodeURIComponent(article.dataset.narrationSlug)}`);if(!response.ok)throw new Error('Saved narration is unavailable.');const data=await response.json();if(reader.dataset.readerMode!=='saved')return;voices=data.voices||[];if(!voices.length){unavailable('No saved narration is available.');return;}select.innerHTML='';for(const v of voices){const option=document.createElement('option');option.value=v.id;option.textContent=v.label;select.append(option);}reader.querySelector('[data-reader-voice-label]').hidden=false;await loadVoice(voices.find(v=>v.default)||voices[0]);}catch{unavailable('Saved narration is unavailable.');}};discover();
}
document.querySelectorAll('[data-reader]').forEach(reader=>{const article=reader.closest('.blog-article');if(article.dataset.narrationArticle)initializeSavedReader(reader);else{reader.querySelector('[data-reader-kind]').textContent='BROWSER READING';initializeBrowserReader(reader);}});

// Escape releases following without interrupting playback or word highlighting.
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'))return;const follow=document.querySelector('[data-reader-follow]');if(!follow?.checked)return;follow.checked=false;follow.dispatchEvent(new Event('change'));window.scrollTo({top:window.scrollY,left:window.scrollX,behavior:'instant'});const status=document.querySelector('[data-follow-status]');if(status)status.textContent='Follow narrator disabled. Audio continues. You can browse freely.';});
for(const row of document.querySelectorAll('[data-blog-share]')){const status=row.querySelector('[data-share-status]'),url=row.dataset.shareUrl,title=row.dataset.shareTitle;row.querySelector('[data-share-action="device"]')?.toggleAttribute('hidden',typeof navigator.share!=='function');row.querySelectorAll('[data-share-action]').forEach(button=>button.addEventListener('click',async()=>{const action=button.dataset.shareAction;status.textContent='';try{if(action!=='copy'&&typeof navigator.share==='function'){await navigator.share({title,url});return;}await navigator.clipboard.writeText(url);status.textContent=action==='instagram'?'Link copied. Open Instagram and paste it into your message or story.':'Link copied.';}catch(error){if(error.name==='AbortError')return;status.textContent=action==='instagram'?'Copy this article link and paste it into Instagram: '+url:'Copy this article link: '+url;}}));}
