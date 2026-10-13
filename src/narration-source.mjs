import {createHash} from 'node:crypto';
import {contentBlocks,renderBlock,esc} from './blog-document.mjs';
export const narrationSchema='cnerd-narration-v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const decode=s=>s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi,(_,v)=>v[0]==='#'?String.fromCodePoint(v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[v.toLowerCase()]));
const boundary=new Set(['p','h1','h2','h3','h4','pre','li','th','td','figcaption','summary','small','div','label','details','section','aside','br']);
// Parse only HTML emitted by the shared, escaped article renderer. Formatting tags
// never create words: a bold or linked fragment can remain inside one token.
export function narratedHtml(html,{tokenOffset=0,segmentId='s0'}={}){
 const pieces=[],stack=[];let text='',excluded=0;
 for(const part of html.match(/<[^>]*>|[^<]+/g)||[]){
  if(part[0]==='<'){
   const parent=stack.at(-1)?.tag;const end=/^<\//.test(part),tag=part.match(/^<\/?([\w-]+)/)?.[1]?.toLowerCase();
   if(!tag){pieces.push({raw:part});continue;}
   if(end){const entry=stack.pop();if(entry?.excluded)excluded--;}
   const omit=!end&&(['button','script','style','svg','video','iframe'].includes(tag)||/class="[^"]*\bcode-feedback\b/.test(part));
   if(!end&&!['img','input','br','hr','source','path','rect','circle','line','polyline','polygon'].includes(tag)&&!/\/>$/.test(part)){stack.push({tag,excluded:omit});if(omit)excluded++;}
   pieces.push({raw:part});if(!excluded&&(boundary.has(tag)||(end&&tag==='span'&&parent==='span'&&stack.at(-1)?.tag==='summary'))&&text&&!text.endsWith(' '))text+=' ';
  }else if(excluded){pieces.push({raw:part});}
  else{const value=decode(part);if(/^[↓⧉↗↺↻]$/.test(value.trim())){pieces.push({raw:part});continue;}pieces.push({text:value,offset:text.length,code:stack.some(e=>e.tag==='code')});text+=value;}
 }
 const tokens=[...text.matchAll(/\S+/gu)].map((m,i)=>({id:`t${tokenOffset+i}`,segmentId,text:m[0],code:pieces.some(p=>p.code&&p.offset<=m.index&&p.offset+p.text.length>m.index),start:m.index,end:m.index+m[0].length}));
 const annotated=pieces.map(p=>{if(p.raw!==undefined)return p.raw;let out='',last=0;for(const t of tokens){const start=Math.max(t.start-p.offset,0),end=Math.min(t.end-p.offset,p.text.length);if(end<=start)continue;out+=esc(p.text.slice(last,start))+`<span data-narration-token="${t.id}">${esc(p.text.slice(start,end))}</span>`;last=end;}return out+esc(p.text.slice(last));}).join('');
 return {html:annotated,tokens:tokens.map(({start,end,...t})=>t),text:tokens.map(t=>t.text).join(' ')};
}
const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
const numberWords=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n>=1e12)return [...value].map(d=>small[Number(d)]).join(' ');if(n<20)return small[n];if(n<100)return tens[Math.floor(n/10)]+(n%10?' '+small[n%10]:'');if(n<1000)return small[Math.floor(n/100)]+' hundred'+(n%100?' '+numberWords(n%100):'');for(const [size,name]of[[1e9,'billion'],[1e6,'million'],[1000,'thousand']])if(n>=size)return numberWords(Math.floor(n/size))+' '+name+(n%size?' '+numberWords(n%size):'');};
export const legacyPronunciations=Object.freeze({CNERD:'see nerd',Olean:'Olean'});
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function spokenToken(value,{code=false,pronunciations=legacyPronunciations}={}){
 let s=value;for(const [text,spoken]of Object.entries(pronunciations)){if(text&&text!==spoken)s=s.replace(new RegExp(escapePattern(text),'gi'),()=>spoken);}
 s=s.replace(/\bDXP4800\b/gi,'D X P four thousand eight hundred').replace(/\bNVMe\b/g,'N V M E').replace(/\.ugb\b/gi,'dot U G B');
 s=s.replace(/(?:\(\d{3}\)|\b\d{3}[-.])\s*\d{3}[-.]\d{4}\b/g,v=>[...v.replace(/\D/g,'')].map(d=>small[Number(d)]).join(' '));
 s=s.replace(/\$([\d,]+(?:\.\d{1,2})?)/g,(_,v)=>{const [a,b]=v.replaceAll(',','').split('.');return numberWords(a)+' dollars'+(b?' '+numberWords(b.padEnd(2,'0'))+' cents':'');});
 s=s.replace(/(\d+)(st|nd|rd|th)\b/g,(_,n)=>{const w=numberWords(n),a=w.split(' '),last=a.pop(),special={one:'first',two:'second',three:'third',five:'fifth',eight:'eighth',nine:'ninth',twelve:'twelfth'};return [...a,special[last]||(last.endsWith('y')?last.slice(0,-1)+'ieth':last+'th')].join(' ');});
 s=s.replace(/\d[\d,]*(?:\.\d+)?/g,v=>{const [a,b]=v.replaceAll(',','').split('.');return ' '+numberWords(a)+(b?' point '+[...b].map(d=>small[Number(d)]).join(' '):'')+' ';});
 s=s.replace(/%/g,' percent').replace(/([\p{Ll}])([\p{Lu}])/gu,'$1 $2').replace(/_/g,' ');
 if(/https?:\/\/|www\.|@/.test(s))s=s.replace(/https?:\/\//g,'').replace(/www\./g,'www dot ').replace(/@/g,' at ').replace(/\./g,' dot ').replace(/\//g,' slash ');
 s=s.replace(/([\p{L}])\.([\p{L}])/gu,'$1 dot $2');
 if(code)s=s.replace(/[^\p{L}\p{M}'’\s-]/gu,' ');
 s=s.replace(/[-–—]/g,' ').replace(/[^\p{L}\p{M}'’\s.,!?;:]/gu,' ').replace(/\s+/g,' ').trim();
 return /\p{L}/u.test(s)?s:'';
}
export function narrationSource(record,{visibility='published',pronunciations=legacyPronunciations}={}){
 if(!record?.id||!record.article)throw new Error('A stable article identity and article snapshot are required.');
 const article=record.article,segments=[],tokens=[];let chapterId='chapter-0';const chapters=[{id:chapterId,title:article.title,anchor:'article-start',firstTokenId:null}];
 const add=(html,kind,anchor)=>{const id=`s${segments.length}`,part=narratedHtml(html,{tokenOffset:tokens.length,segmentId:id});if(!part.tokens.length)return part.html;
  const phoneTail=t=>/^\D*\d{3}[-.]\d{4}\D*$/.test(t||''),phoneHead=t=>/^\D*\(?\d{3}\)?\D*$/.test(t||'');
  const mapped=part.tokens.map((t,i)=>{const phonePart=phoneHead(t.text)&&phoneTail(part.tokens[i+1]?.text)||phoneTail(t.text)&&phoneHead(part.tokens[i-1]?.text);return {...t,spoken:phonePart?[...t.text.replace(/\D/g,'')].map(d=>small[Number(d)]).join(' ')+(!t.code&&/[.!?]$/.test(t.text)?t.text.slice(-1):''):spokenToken(t.text,{code:t.code,pronunciations})};});
  for(const token of mapped){if(token.spoken&&!chapters.at(-1).firstTokenId)chapters.at(-1).firstTokenId=token.id;tokens.push(token);}
  segments.push({id,kind,anchor,chapterId,text:part.text,spokenText:mapped.map(t=>t.spoken).filter(Boolean).join(' '),tokenIds:mapped.map(t=>t.id)});return part.html;};
 const titleHtml=add(esc(article.title),'title','article-start'),introHtml=add(esc(article.summary),'intro','article-start');
 const blocks=contentBlocks(article).map((block,i)=>{if(block.heading){chapterId=`chapter-${chapters.length}`;chapters.push({id:chapterId,title:block.heading,anchor:block.id,firstTokenId:null});}return {id:block.id,html:add(renderBlock(block,i),block.heading?'heading':'body',block.id)};});
 const spokenWords=tokens.flatMap(t=>[...t.spoken.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)].map(m=>({id:`w${0}`,tokenId:t.id,text:m[0]}))).map((w,i)=>({...w,id:`w${i}`}));
 // Only spoken content and its token mapping define staleness. Article URL, image,
 // link destination, formatting, SEO, author and private training are excluded.
 const lexicalByToken=new Map();for(const word of spokenWords){if(!lexicalByToken.has(word.tokenId))lexicalByToken.set(word.tokenId,[]);lexicalByToken.get(word.tokenId).push(word.text);}
 const policy=JSON.stringify(Object.entries(pronunciations).sort(([a],[b])=>a.localeCompare(b)))===JSON.stringify(Object.entries(legacyPronunciations).sort(([a],[b])=>a.localeCompare(b)))?{}:{pronunciationPolicy:Object.fromEntries(Object.entries(pronunciations).sort(([a],[b])=>a.localeCompare(b)))};
 const fingerprint=hash(JSON.stringify({schema:narrationSchema,...policy,tokens:tokens.map(({id,text})=>({id,text,spoken:(lexicalByToken.get(id)||[]).join(' ')})),spokenWords}));
 return {schema:narrationSchema,articleId:record.id,slug:record.slug||article.slug,visibility,sourceFingerprint:fingerprint,pronunciations:{...pronunciations},nonspokenTokenIds:tokens.filter(t=>!t.spoken).map(t=>t.id),segments,chapters:chapters.filter(c=>c.firstTokenId),tokens,spokenWords,spokenText:segments.map(s=>s.spokenText).join('\n\n'),rendered:{titleHtml,introHtml,blocks}};
}
export function exportNarrationSource(record,options){const {rendered,...source}=narrationSource(record,options);return source;}
