import {createHash} from 'node:crypto';
export const voices=Object.freeze({heart:{label:'Heart · professional voice',default:true},michael:{label:'Michael · stock narrator',default:false},mike60s:{label:'Mike',default:false}});
export const audioLimit=40_000_000;
const fail=message=>Object.assign(new Error(message),{status:400});
export const checksum=buffer=>createHash('sha256').update(buffer).digest('hex');
export function validateManifest(manifest,source,audio,{approvedVoices=voices}={}){
 const m=manifest;
 if(!m||m.schema!==source.schema||m.articleId!==source.articleId||m.sourceFingerprint!==source.sourceFingerprint)throw fail('Narration does not match this article’s current spoken source. Export the source again.');
 if(!Object.hasOwn(approvedVoices,m.voiceId))throw fail('Choose an approved narration voice.');
 if(!Buffer.isBuffer(audio)||!audio.length||audio.length>audioLimit||m.audioSha256!==checksum(audio))throw fail('MP3 checksum or upload size is invalid.');
 if(!Number.isFinite(m.duration)||m.duration<=0||m.duration>7200)throw fail('Choose audio with a finite duration under two hours.');
 if(!Array.isArray(m.words)||m.words.length!==source.spokenWords.length||!m.words.length)throw fail('Every spoken source word needs an alignment time and score.');
 let previous=0;const words=m.words.map((w,i)=>{const expected=source.spokenWords[i];if(!w||w.id!==expected.id||w.tokenId!==expected.tokenId||w.text!==expected.text)throw fail('The word/token mapping does not match the exported source.');if(!Number.isFinite(w.score)||w.score<=0||w.score>1||![w.start,w.end].every(Number.isFinite)||w.start<0||w.end<=w.start||w.end>m.duration+.05||w.start<previous-.001)throw fail('Word timing or alignment score is invalid. Supply alignment measured from the final audio; timestamps alone do not prove acoustic alignment.');previous=w.end;return {id:w.id,tokenId:w.tokenId,text:w.text,start:w.start,end:w.end,score:w.score};});
 if(!Array.isArray(m.chapters)||m.chapters.length!==source.chapters.length)throw fail('Chapter mapping does not match the exported source.');
 const chapters=m.chapters.map((c,i)=>{const expected=source.chapters[i],first=words.find(w=>w.tokenId===expected.firstTokenId),next=source.chapters[i+1],end=next?words.find(w=>w.tokenId===next.firstTokenId)?.start:m.duration;if(!c||c.id!==expected.id||![c.start,c.end].every(Number.isFinite)||Math.abs(c.start-first.start)>.05||Math.abs(c.end-end)>.05||c.end<=c.start)throw fail('Chapter boundaries must follow the aligned source headings.');return {...expected,start:c.start,end:c.end};});
 const settings={};for(const [key,value]of Object.entries(m.settings||{})){if(!['engine','model','voice','speed','language','sampleRate','channels','alignment'].includes(key)||!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||String(value).length>200||(/[\\]/.test(String(value))||String(value).startsWith('/')||String(value).includes('://')||String(value).includes('..')||key!=='model'&&String(value).includes('/')))throw fail('Narration settings must not contain private references or file paths.');settings[key]=value;}
 return {schema:m.schema,visibility:source.visibility,articleId:m.articleId,sourceFingerprint:m.sourceFingerprint,voiceId:m.voiceId,audioSha256:m.audioSha256,duration:m.duration,settings,words,chapters};
}
