import test from 'node:test';
import assert from 'node:assert/strict';
import {easternCandidates,easternInput,formatArticleDate} from '../public/article-date.js';
import {articleQuality} from '../src/validation.mjs';
import {validateDoc} from '../src/blog-document.mjs';

test('configured time zones handle DST gaps, repeats, and fractional offsets',()=>{
  assert.equal(easternCandidates('2026-03-08T02:30','America/New_York').length,0);
  assert.equal(easternCandidates('2026-11-01T01:30','America/New_York').length,2);
  const india=easternCandidates('2026-10-13T12:30','Asia/Kolkata');assert.equal(india.length,1);assert.equal(india[0].value,'2026-10-13T07:00:00.000Z');
  assert.equal(easternInput(india[0].value,'Asia/Kolkata'),'2026-10-13T12:30');assert.match(formatArticleDate(india[0].value,'Asia/Kolkata'),/12:30/);
});
test('native, gallery and workflow descriptions preserve explicit decorative intent',()=>{
  const doc=validateDoc({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'A useful explanation.'}]},{type:'image',attrs:{src:'/blog/media/'+ 'a'.repeat(32),alt:'',decorative:true,width:800,height:600}}]});
  assert.equal(doc.content[1].attrs.decorative,true);assert.equal(doc.content[1].attrs.width,800);
  const draft={schemaVersion:2,title:'Descriptive article title',summary:'A useful introduction with enough context for our readers.',topics:['Examples'],bodyDoc:doc};assert.equal(articleQuality(draft).passed,true);
  doc.content[1].attrs.decorative=false;assert.equal(articleQuality(draft).passed,false);
});
