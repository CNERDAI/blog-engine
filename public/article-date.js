export const articleTimeZone='America/New_York';
export function validPublicationDate(value){
 if(value===null||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw Error('Use an ISO publication timestamp with a timezone.');
 const [year,month,day]=value.slice(0,10).split('-').map(Number),date=new Date(value),calendar=new Date(Date.UTC(year,month-1,day));
 if(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19)||0)>59||year<1900||calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||!Number.isFinite(date.getTime()))throw Error('Choose a valid article date and time.');
 return date.toISOString();
}
const configuredZone=()=>globalThis.BLOG_ENGINE?.timeZone||articleTimeZone;
export function easternInput(value,timeZone=configuredZone()){
 if(!value)return '';
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 const get=key=>parts.find(part=>part.type===key)?.value;
 return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function easternCandidates(value,timeZone=configuredZone()){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return [];
 const naive=Date.parse(value+'Z');if(!Number.isFinite(naive))return [];
 // Sample both sides of a possible DST boundary; no guessed fixed zone offsets.
 const offsets=new Set([-36,-12,0,12,36].map(hours=>{
  const at=naive+hours*3600000;
  return Date.parse(easternInput(new Date(at).toISOString(),timeZone)+'Z')-at;
 }));
 return [...offsets].map(offset=>new Date(naive-offset).toISOString()).filter(iso=>easternInput(iso,timeZone)===value).sort().map(iso=>({value:iso,label:new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'longOffset',hour:'numeric',minute:'2-digit'}).format(new Date(iso))}));
}
export function formatArticleDate(value,timeZone=configuredZone()){
 if(!value)return '';
 return new Intl.DateTimeFormat('en-US',{timeZone,month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
}
