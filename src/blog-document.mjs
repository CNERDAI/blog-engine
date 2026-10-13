import {highlightCode} from './code-highlight.mjs';
// Shared document contract: browser editor, server, AI and Codex imports.
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail = message => Object.assign(new Error(message), {status:400});
const clean = value => String(value || '').trim();
const bounded = (value, length=500) => clean(value).slice(0,length);
const blockIdOk = value => /^b_[a-z0-9]{8,40}$/.test(value);
export const safeUrl = value => {
 if (typeof value !== 'string' || value.length > 1000 || /[\x00-\x20<>"'\\]/.test(value)) return false;
 if (value.startsWith('/')) return (/^\/(?:[a-zA-Z0-9_-]+\/)*(?:media|api\/admin\/blog\/assets)\/[a-f0-9]{32}$/.test(value) && !value.split('/').includes('..')) || /^\/(?:assets|media|email)\/[a-zA-Z0-9._/-]+$/.test(value) && !value.split('/').includes('..') || /^\/(?:blog-media|api\/admin\/blog\/assets)\/[a-f0-9]{32}$/.test(value);
 try { const url=new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password; } catch {return false;}
};
const lines=(value,max=12,length=120) => (Array.isArray(value)?value:String(value||'').split('\n')).map(clean).filter(Boolean).slice(0,max).map(v=>v.slice(0,length));
export function normalBlock(block){
 if(!block||typeof block!=='object'||Array.isArray(block)||!blockIdOk(block.id)||!['text','image','gallery','video','prompt','workflow','checklist','callout','table','download'].includes(block.type))throw fail('One content block is malformed.');
 const id=block.id,type=block.type;
 if(type==='text'){const body=String(block.body||'').slice(0,30000);if(!body.trim())throw fail('Text blocks need content.');return {id,type,heading:bounded(block.heading,160),body};}
 if(type==='image'||type==='video'){const raw=bounded(block.src,1000),embed=type==='video'?youtubeEmbed(raw):'',src=embed||raw;if(!safeUrl(src)||type==='video'&&/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)(?:\/|$)/.test(raw)&&!embed)throw fail('Choose a valid image, MP4, or YouTube URL.');return {id,type,src,...(embed?{provider:'youtube'}:{}),alt:bounded(block.alt,220),decorative:block.decorative===true,caption:bounded(block.caption,500)};}
 if(type==='gallery'){const images=Array.isArray(block.images)?block.images.slice(0,8).map(image=>({src:bounded(image?.src,1000),alt:bounded(image?.alt,220),decorative:image?.decorative===true,caption:bounded(image?.caption,300)})):[];if(!images.length||images.some(image=>!safeUrl(image.src)))throw fail('A gallery needs one or more valid images.');return {id,type,images};}
 if(type==='prompt'){const content=String(block.content||'').slice(0,20000);if(!content.trim())throw fail('Prompt blocks need prompt text.');return {id,type,title:bounded(block.title,180),content};}
 if(type==='workflow'){const steps=Array.isArray(block.steps)?block.steps.slice(0,20).map((step,index)=>({id:blockIdOk(step?.id)?step.id:`b_step${String(index).padStart(8,'0')}`,title:bounded(step?.title,180),instructions:String(step?.instructions||'').slice(0,8000),prompt:String(step?.prompt||'').slice(0,12000),image:bounded(step?.image,1000),imageAlt:bounded(step?.imageAlt,220),imageDecorative:step?.imageDecorative===true,expected:String(step?.expected||'').slice(0,3000),review:Boolean(step?.review)})):[];if(!bounded(block.outcome,500)||!steps.length||steps.some(step=>!step.title||!step.instructions||(step.image&&!safeUrl(step.image))))throw fail('A workflow needs an outcome and complete ordered steps.');return {id,type,outcome:bounded(block.outcome,500),prerequisites:lines(block.prerequisites),tools:lines(block.tools),steps};}
 if(type==='checklist'){const items=Array.isArray(block.items)?block.items.slice(0,30).map(item=>({label:bounded(item?.label,300),details:String(item?.details||'').slice(0,2000)})):[];if(!items.length||items.some(item=>!item.label))throw fail('A checklist needs at least one item.');return {id,type,title:bounded(block.title,180),items};}
 if(type==='callout'){const body=String(block.body||'').slice(0,5000);if(!body.trim())throw fail('Callouts need text.');return {id,type,title:bounded(block.title,180),body,tone:['note','tip','warning'].includes(block.tone)?block.tone:'note'};}
 if(type==='table'){const headings=Array.isArray(block.headings)?block.headings.slice(0,8).map(item=>bounded(item,120)):[];const rows=Array.isArray(block.rows)?block.rows.slice(0,30).map(row=>Array.isArray(row)?row.slice(0,headings.length).map(cell=>bounded(cell,1000)):[]):[];if(!headings.length||headings.some(item=>!item)||!rows.length||rows.some(row=>row.length!==headings.length))throw fail('Tables need headings and complete rows.');return {id,type,headings,rows};}
 const href=bounded(block.href,1000);if(!safeUrl(href))throw fail('Downloads need a valid file.');return {id,type,label:bounded(block.label,180)||'Download file',description:bounded(block.description,1000),href};
}

export const emptyDoc = () => ({type:'doc',content:[{type:'paragraph'}]});
export function toDocument(article, training=false) {
 if(article.schemaVersion===2) return structuredClone(training?article.trainingDoc:article.bodyDoc);
 const content=[];
 for(const block of (training?article.training:article.blocks)||[]) {
  if(block.type==='text') {
   if(block.heading) content.push({type:'heading',attrs:{level:2,id:block.id},content:[{type:'text',text:block.heading}]});
   const paragraphs=block.body.split(/\n{2,}/);
   paragraphs.forEach((text,i)=>{const inline=[];text.split('\n').forEach((part,j)=>{if(j)inline.push({type:'hardBreak'});if(part)inline.push({type:'text',text:part});});content.push({type:'paragraph',attrs:{id:block.heading?block.id+'-p'+i:i===0?block.id:block.id+'-p'+i},content:inline});});
  } else content.push({type:'cnerdBlock',attrs:{id:block.id,block:structuredClone(block)}});
 }
 return {type:'doc',content:content.length?content:[{type:'paragraph'}]};
}
const types=new Set(['doc','text','paragraph','heading','bulletList','orderedList','listItem','taskList','taskItem','blockquote','codeBlock','hardBreak','horizontalRule','image','cnerdBlock']);
const highlightColors=['#ffffff','#f8f8f7','#f4eeee','#fbecdd','#fef9c3','#dcfce7','#e0f2fe','#f3e8ff','#fcf1f6','#ffe4e6'];
const highlightNames=['default','gray','brown','orange','yellow','green','blue','purple','pink','red'];
const highlightVariables=highlightNames.map(n=>n==='default'?'var(--tt-bg-color)':'var(--tt-color-highlight-'+n+')');
const highlightIndex=color=>highlightColors.includes(color)?highlightColors.indexOf(color):highlightVariables.indexOf(color);
const marks=new Set(['bold','italic','underline','strike','code','highlight','link','subscript','superscript']);
export function validateDoc(doc) {
 if(!doc || doc.type!=='doc' || !Array.isArray(doc.content) || JSON.stringify(doc).length>300000) throw fail('The article document is invalid or too large.');
 let count=0; const ids=new Set();
 const visit=(node,depth=0,parent='')=>{
  if(!node || !types.has(node.type) || ++count>6000 || depth>16) throw fail('Unsupported or excessively nested article content.');
  if(node.type==='doc' && depth>0)throw fail('Nested documents are not supported.');
  const out={type:node.type};
  if(node.type==='text') {if(typeof node.text!=='string'||!node.text.length)throw fail('Text content is invalid.');out.text=node.text;}
  if(node.text!==undefined&&node.type!=='text')throw fail('Text belongs in text nodes.');
  const attrs=node.attrs||{};out.attrs={};
  if(attrs.id) {if(!/^[a-zA-Z0-9_-]{1,90}$/.test(attrs.id)||ids.has(attrs.id))throw fail('Article block IDs must be valid and unique.');ids.add(attrs.id);out.attrs.id=attrs.id;}
  if(node.type==='heading') {if(![2,3,4].includes(attrs.level))throw fail('Use heading levels 2–4 inside an article.');out.attrs.level=attrs.level;}
  if(['paragraph','heading'].includes(node.type)&&attrs.textAlign) {if(!['left','center','right','justify'].includes(attrs.textAlign))throw fail('Invalid alignment.');out.attrs.textAlign=attrs.textAlign;}
  if(node.type==='orderedList')out.attrs.start=Math.max(1,Math.min(999,Number(attrs.start)||1));
  if(node.type==='taskItem')out.attrs.checked=attrs.checked===true;
  if(node.type==='codeBlock'){out.attrs.language=typeof attrs.language==='string'?attrs.language.slice(0,30):'plaintext';}
  if(node.type==='image'){if(!safeUrl(attrs.src))throw fail('Choose a valid image.');out.attrs.src=attrs.src;out.attrs.alt=bounded(attrs.alt,220);out.attrs.decorative=attrs.decorative===true;for(const key of ['width','height'])if(Number.isInteger(attrs[key])&&attrs[key]>0&&attrs[key]<=16000)out.attrs[key]=attrs[key];out.attrs.title=bounded(attrs.title,500);}
  if(node.type==='cnerdBlock') {out.attrs.block=normalBlock(attrs.block);const id=out.attrs.block.id;if(attrs.id&&attrs.id!==id)throw fail('Content block IDs do not match.');if(!attrs.id){if(ids.has(id))throw fail('Article block IDs must be unique.');ids.add(id);}out.attrs.id=id;}
  if(!Object.keys(out.attrs).length)delete out.attrs;
  if(node.marks){if(node.type!=='text'||!Array.isArray(node.marks))throw fail('Formatting belongs on text.');out.marks=node.marks.map(mark=>{if(!marks.has(mark.type))throw fail('Unsupported formatting.');if(mark.type==='link'){if(!safeUrl(mark.attrs?.href))throw fail('Invalid link.');return {type:'link',attrs:{href:mark.attrs.href,...(mark.attrs.target==='_blank'?{target:'_blank'}:{})}};}if(mark.type==='highlight'&&mark.attrs?.color){const color=String(mark.attrs.color).toLowerCase();if(highlightIndex(color)<0)throw fail('Choose an approved highlight color.');return {type:'highlight',attrs:{color}};}return {type:mark.type};});}
  if(node.content){if(!Array.isArray(node.content)||['text','hardBreak','horizontalRule','image','cnerdBlock'].includes(node.type))throw fail('Invalid node content.');out.content=node.content.map(child=>visit(child,depth+1,node.type));}
  if(['paragraph','heading'].includes(node.type)&&out.content?.some(n=>!['text','hardBreak'].includes(n.type)))throw fail('A text block contains unsupported content.');
  if(node.type==='codeBlock'&&out.content?.some(n=>n.type!=='text'||n.marks?.length))throw fail('Code must contain plain text.');
  if(['bulletList','orderedList'].includes(node.type)&&out.content?.some(n=>n.type!=='listItem'))throw fail('Invalid list.');
  if(node.type==='taskList'&&out.content?.some(n=>n.type!=='taskItem'))throw fail('Invalid checklist.');
  if(['text','hardBreak'].includes(node.type)&&!['paragraph','heading','codeBlock'].includes(parent))throw fail('Inline content belongs in a text block.');
  const blocks=['paragraph','heading','bulletList','orderedList','taskList','blockquote','codeBlock','image','horizontalRule','cnerdBlock'];if(['doc','blockquote','listItem','taskItem'].includes(node.type)&&out.content?.some(n=>!blocks.includes(n.type)))throw fail('Invalid block structure.');if(['listItem','taskItem'].includes(node.type)&&out.content?.[0]?.type!=='paragraph')throw fail('A list item starts with a paragraph.');
  return out;
 };
 return visit(doc);
}
export function nodeText(node) {
 if(node.type==='text')return node.text;
 if(node.type==='hardBreak')return '\n';
 if(node.type==='image')return [node.attrs?.alt,node.attrs?.title].filter(Boolean).join(' ');
 if(node.type==='cnerdBlock') {const b=node.attrs.block;return [b.title,b.outcome,b.body,b.content,b.caption,b.description,...(b.steps||[]).map(s=>[s.title,s.instructions,s.prompt,s.expected].filter(Boolean).join(' ')),...(b.items||[]).map(i=>[i.label,i.details].join(' ')),...(b.headings||[]),...(b.rows||[]).flat()].filter(Boolean).join(' ');}
 return (node.content||[]).map(nodeText).join(['paragraph','heading','codeBlock'].includes(node.type)?'':'\n');
}
export function contentBlocks(article,training=false) {
 if(article.schemaVersion!==2)return (training?article.training:article.blocks)||[];
 return ((training?article.trainingDoc:article.bodyDoc)?.content||[]).map((node,index)=>node.type==='cnerdBlock'?node.attrs.block:{id:node.attrs?.id||'rich-'+index,type:'rich',node,heading:node.type==='heading'?nodeText(node):'',body:nodeText(node)});
}
export function renderNode(node,renderBlock) {
 if(node.type==='text') {let text=esc(node.text);for(const mark of node.marks||[]){if(mark.type==='link')text=`<a href="${esc(mark.attrs.href)}"${mark.attrs.target==='_blank'?' target="_blank"':''} rel="noopener noreferrer">${text}</a>`;else {const tag={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code',highlight:'mark',subscript:'sub',superscript:'sup'}[mark.type];const css=mark.type==='highlight'&&mark.attrs?.color?' class="highlight-'+highlightNames[highlightIndex(mark.attrs.color)]+'"':'';text=`<${tag}${css}>${text}</${tag}>`;}}return text;}
 if(node.type==='image')return `<figure class="blog-media"><img src="${esc(node.attrs.src)}" alt="${esc(node.attrs.decorative?"":node.attrs.alt)}" ${node.attrs.width?`width="${node.attrs.width}"`:""} ${node.attrs.height?`height="${node.attrs.height}"`:""} loading="lazy">${node.attrs.title?`<figcaption>${esc(node.attrs.title)}</figcaption>`:''}</figure>`;
 if(node.type==='cnerdBlock')return renderBlock(node.attrs.block,0);
 if(node.type==='codeBlock')return `<div class="cnerd-code"><button type="button" class="code-copy" aria-label="Copy code" title="Copy code">${copyIcon}</button><pre><code>${highlightCode(nodeText(node),node.attrs?.language||'plaintext')}</code></pre><span class="code-feedback" role="status" aria-live="polite"></span></div>`;
 const tag={doc:'div',paragraph:'p',heading:'h'+node.attrs?.level,bulletList:'ul',orderedList:'ol',listItem:'li',taskList:'ul',taskItem:'li',blockquote:'blockquote',hardBreak:'br',horizontalRule:'hr'}[node.type];
 const classes=[node.attrs?.textAlign?'align-'+node.attrs.textAlign:'',node.type==='taskList'?'rich-tasks':''].filter(Boolean).join(' ');
 const body=(node.type==='taskItem'?`<input type="checkbox" ${node.attrs?.checked?'checked':''} aria-label="Checklist item">`:'')+(node.content||[]).map(n=>renderNode(n,renderBlock)).join('');
 return `<${tag}${classes?` class="${classes}"`:''}${node.type==='orderedList'?` start="${node.attrs?.start||1}"`:''}>${body}${['br','hr'].includes(tag)?'':`</${tag}>`}`;
}

const paragraph=value=>esc(value).split(/\n{2,}/).filter(Boolean).map(line=>`<p>${line.replace(/\n/g,"<br>")}</p>`).join("");
export function renderBlock(block,index){
 if(block.type==='rich')return renderNode(block.node,renderBlock);
 if(block.type==='text')return `<section class="blog-text-block">${block.heading?`<h2>${esc(block.heading)}</h2>`:''}${paragraph(block.body)}</section>`;
 if(block.type==='image')return `<figure class="blog-media"><img src="${esc(block.src)}" alt="${esc(block.decorative?"":block.alt)}" loading="lazy" decoding="async">${block.caption?`<figcaption>${esc(block.caption)}</figcaption>`:''}</figure>`;
 if(block.type==='gallery')return `<section class="blog-gallery" aria-label="Image gallery">${block.images.map(image=>`<figure><img src="${esc(image.src)}" alt="${esc(image.decorative?"":image.alt)}" loading="lazy" decoding="async">${image.caption?`<figcaption>${esc(image.caption)}</figcaption>`:''}</figure>`).join('')}</section>`;
 if(block.type==='video'&&block.provider==='youtube')return `<figure class="blog-video"><iframe src="${esc(block.src)}" title="${esc(block.alt||'YouTube video')}" loading="lazy" allow="fullscreen; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>${block.caption?`<figcaption>${esc(block.caption)}</figcaption>`:''}</figure>`;
 if(block.type==='video')return `<figure class="blog-video"><video controls preload="metadata" src="${esc(block.src)}">Your browser does not support this video.</video>${block.caption?`<figcaption>${esc(block.caption)}</figcaption>`:''}</figure>`;
 if(block.type==='prompt')return `<section class="blog-prompt"><div><p class="eyebrow">PROMPT</p><h2>${esc(block.title||'Copy and adapt')}</h2></div><button class="copy-text icon-copy" data-copy="${esc(block.content)}" aria-label="Copy prompt" title="Copy prompt">⧉</button><pre><code>${esc(block.content)}</code></pre></section>`;
 if(block.type==='workflow')return `<section class="blog-workflow"><p class="eyebrow">WORKFLOW</p><h2>${esc(block.outcome)}</h2>${block.prerequisites.length?`<p class="workflow-meta"><strong>Before you start:</strong> ${esc(block.prerequisites.join(' · '))}</p>`:''}${block.tools.length?`<p class="workflow-meta"><strong>Tools:</strong> ${esc(block.tools.join(' · '))}</p>`:''}<ol>${block.steps.map((step,stepIndex)=>`<li><details ${stepIndex===0?'open':''}><summary><span>${String(stepIndex+1).padStart(2,'0')}</span><strong>${esc(step.title)}</strong></summary><div class="workflow-step">${paragraph(step.instructions)}${step.image?`<img src="${esc(step.image)}" alt="${esc(step.imageDecorative?"":step.imageAlt)}" loading="lazy">`:''}${step.prompt?`<div class="workflow-prompt"><button class="copy-text icon-copy" data-copy="${esc(step.prompt)}" aria-label="Copy step prompt" title="Copy step prompt">⧉</button><pre><code>${esc(step.prompt)}</code></pre></div>`:''}${step.expected?`<p><strong>Expected result:</strong> ${esc(step.expected)}</p>`:''}${step.review?'<p class="review-point"><strong>Human review:</strong> Check this result before moving forward.</p>':''}</div></details></li>`).join('')}</ol></section>`;
 if(block.type==='checklist')return `<section class="blog-checklist" data-checklist="${esc(block.id)}"><h2>${esc(block.title||'Checklist')}</h2>${block.items.map((item,itemIndex)=>`<label><input type="checkbox" data-checklist-item="${itemIndex}"><span><strong>${esc(item.label)}</strong>${item.details?`<small>${esc(item.details)}</small>`:''}</span></label>`).join('')}</section>`;
 if(block.type==='callout')return `<aside class="blog-callout ${esc(block.tone)}"><h2>${esc(block.title||'A useful note')}</h2>${paragraph(block.body)}</aside>`;
 if(block.type==='table')return `<div class="blog-table-wrap"><table><thead><tr>${block.headings.map(item=>`<th>${esc(item)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 return `<a class="blog-download" href="${esc(block.href)}" download><span>↓</span><strong>${esc(block.label)}</strong>${block.description?`<small>${esc(block.description)}</small>`:''}</a>`;
}

export const copyIcon='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/></svg>';
export function youtubeEmbed(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)return '';let id='';if(url.hostname==='youtu.be')id=url.pathname.slice(1);if(['youtube.com','www.youtube.com'].includes(url.hostname))id=url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1];if(url.hostname==='www.youtube-nocookie.com')id=url.pathname.match(/^\/embed\/([^/]+)$/)?.[1];return /^[a-zA-Z0-9_-]{11}$/.test(id||'')?'https://www.youtube-nocookie.com/embed/'+id:'';}catch{return '';}}

export function assetReferences(article,training=false){
 const references=training?[]:[...(article.heroImage?[{url:article.heroImage,kind:'image'}]:[]),...(article.socialImage?[{url:article.socialImage,kind:'image'}]:[])];
 const block=b=>{if(b.type==='image'||b.type==='video')references.push({url:b.src,kind:b.type});if(b.type==='download')references.push({url:b.href,kind:'download'});for(const image of b.images||[])references.push({url:image.src,kind:'image'});for(const step of b.steps||[])if(step.image)references.push({url:step.image,kind:'image'});};
 const visit=n=>{if(n.type==='image')references.push({url:n.attrs.src,kind:'image'});if(n.type==='cnerdBlock')block(n.attrs.block);for(const mark of n.marks||[])if(mark.type==='link')references.push({url:mark.attrs.href,kind:''});for(const child of n.content||[])visit(child);};
 if(article.schemaVersion===2)visit((training?article.trainingDoc:article.bodyDoc)||emptyDoc());else for(const b of(training?article.training:article.blocks)||[])block(b);return references;
}

export const privateAssetUrl=url=>String(url).replace(/^\/blog-media\/([a-f0-9]{32})$/,'/api/admin/blog/assets/$1');
export const privateMediaHtml=html=>html.replace(/\b(src|href)="\/blog-media\/([a-f0-9]{32})"/g,'$1="/api/admin/blog/assets/$2"');
