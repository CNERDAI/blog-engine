import {createLowlight,common} from 'lowlight';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const lowlight=createLowlight(common);
lowlight.register('bash', h=>{const grammar=common.bash(h);grammar.keywords={...(grammar.keywords||{}),built_in:(Array.isArray(grammar.keywords?.built_in)?grammar.keywords.built_in.join(' '):grammar.keywords?.built_in||'')+' npx npm node git python python3 curl'};return grammar;});
const html=node=>node.type==='text'?esc(node.value):`<span class="${esc((node.properties?.className||[]).join(' '))}">${(node.children||[]).map(html).join('')}</span>`;
export function highlightCode(text,language='plaintext'){
 if(text.length>30000)return esc(text);
 if(['bash','shell','sh'].includes(language)&&/^(npx|npm|node|git|python3?|curl)\s/.test(text)){const command=text.match(/^\S+/)[0];return `<span class="hljs-built_in">${esc(command)}</span>${esc(text.slice(command.length))}`;}
 try{return (language==='auto'?lowlight.highlightAuto(text):lowlight.registered(language)?lowlight.highlight(language,text):{children:[{type:'text',value:text}]}).children.map(html).join('');}catch{return esc(text);}
}
