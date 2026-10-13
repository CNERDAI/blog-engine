import React, {useEffect,useState} from 'react';
import {easternInput,easternCandidates} from '../../public/article-date.js';
import type {ArticleSession} from './use-article-session';
export function ArticleDate({session}:{session:ArticleSession}){
 const zone=(window as any).BLOG_ENGINE?.timeZone||'America/New_York';
 const value=session.data.publishedAt;
 const [manual,setManual]=useState(Boolean(value)),[local,setLocal]=useState(easternInput(value)),[offset,setOffset]=useState(value||'');
 useEffect(()=>{setManual(Boolean(value));setLocal(easternInput(value));setOffset(value||'');session.dateError.current='';},[value]);
 const choices=easternCandidates(local);
 const change=(next:string,chosen='')=>{setLocal(next);const candidates=easternCandidates(next);const selected=candidates.length===1?candidates[0].value:chosen;setOffset(selected);if(!selected){session.dateError.current=candidates.length===2?`Choose an offset for this repeated time in ${zone}.`:`Choose a valid time in ${zone}. This time may not exist during a clock change.`;session.setStatus(session.dateError.current);}else{session.dateError.current='';session.mark({publishedAt:selected});}};
 return <div className="cnerd-article-date"><label>Article date and time — {zone}<select aria-label="Article date mode" disabled={session.busy} value={manual?'manual':'auto'} onChange={e=>{const enabled=e.target.value==='manual';setManual(enabled);if(enabled)change(local||easternInput(new Date().toISOString()));else{session.dateError.current='';session.mark({publishedAt:null});}}}><option value="auto">Set when first published</option><option value="manual">Set date and time</option></select></label>{manual&&<><input type="datetime-local" aria-label={"Article date and time — "+zone} disabled={session.busy} value={local} onChange={e=>change(e.target.value)}/>{choices.length===2&&<select aria-label={zone+" time offset"} value={offset} onChange={e=>change(local,e.target.value)}><option value="">Choose time offset</option>{choices.map(c=><option value={c.value} key={c.value}>{c.label}</option>)}</select>}<span className="cnerd-date-help">{session.dateError.current||'Display date only; publishing is immediate.'}</span></>}</div>;
}
