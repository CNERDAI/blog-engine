import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBrandConfig, brand } from '../src/brand.mjs';
import { shell, articleSchema, sitemap, feed } from '../src/render.mjs';

const config = JSON.parse(readFileSync(new URL('../config/cnerd.local.json',import.meta.url)));
test('brand fixtures use isolated local origins and truthful identities', () => {
  const names=['cnerd','landworkspro','rinkreations'];
  const fixtures=names.map(name => loadBrandConfig(new URL(`../config/${name}.local.json`,import.meta.url).pathname));
  assert.equal(new Set(fixtures.map(fixture => fixture.publicOrigin)).size,3);
  assert.deepEqual(fixtures.map(fixture => fixture.port),[4310,4311,4312]);
  assert.equal(fixtures[1].defaultAuthor.type,'Organization');
  assert.equal(fixtures[2].domainVerified,false);
  assert.match(fixtures[2].previewNotice,/domain.*unverified/);
});
test('production rejects insecure, unverified, placeholder and malformed brand config', () => {
  for(const input of [
    {...config,environment:'production',publicOrigin:'http://cnerd.ai',domainVerified:true},
    {...config,environment:'production',publicOrigin:'https://cnerd.ai'},
    {...config,environment:'production',publicOrigin:'https://example.com',domainVerified:true},
    {...config,environment:'local',publicOrigin:'http://192.168.1.1:4310'},
    {...config,theme:{accent:'red;}</style>'}},
    {...config,basePath:'/../private'},
    {...config,pronunciations:{word:'/private/reference.wav'}}
  ]) assert.throws(()=>loadBrandConfig(input));
  assert.equal(loadBrandConfig({...config,environment:'production',publicOrigin:'https://cnerd.ai',domainVerified:true}).publicOrigin,'https://cnerd.ai');
  assert.equal(loadBrandConfig({...config,basePath:'/journal'}).basePath,'/journal');
});
test('shell escapes metadata and schema, has nonce-safe brand config and privacy controls', () => {
  const html=shell({title:'A <test> & "title"',description:'Description " > <',body:'<article><h1>Complete article</h1><p>Server rendered text.</p></article>',path:'/blog/test/',nonce:'abc',schema:[{'@type':'Thing',name:'</script><script>alert(1)</script>'}],image:{url:'/blog/media/abc',width:1200,height:630,mime:'image/jpeg'},imageAlt:'Mountain landscape',publishedAt:'2026-10-13T12:00:00Z'});
  assert.match(html,/<h1>Complete article<\/h1>/);
  assert.match(html,/og:image:alt" content="Mountain landscape/);
  assert.match(html,/og:image:width" content="1200/);
  assert.match(html,/<script nonce="abc">window.BLOG_ENGINE=/);
  assert.doesNotMatch(html,/<script>alert/);
  assert.match(html,/\\u003c\/script/);
  const preview=shell({title:'Private',body:'Draft content',admin:true,path:'/blog/admin/preview/',image:'/blog/media/abc'});
  assert.match(preview,/noindex, nofollow, noarchive/);
  assert.doesNotMatch(preview,/rel="canonical"|property="og:image"|application\/ld\+json/);
  assert.match(shell({title:'Page two',body:'Articles',path:'/blog/?page=2'}),/rel="canonical" href="http:\/\/127.0.0.1:4310\/blog\/\?page=2"/);
});
test('article schema distinguishes organizations and unknown authors without inventing type', () => {
  const article={slug:'truthful-author',title:'A clear article title',summary:'A summary.',author:'An editorial organization',authorType:'Organization',publishedAt:'2026-10-13T12:00:00Z'};
  const schema=articleSchema(article);
  assert.equal(schema[0].author['@type'],'Organization');
  assert.equal(schema[0].publisher.name,brand.publisher.name);
  assert.equal(schema[0].publisher['@type'],brand.publisher.type);
  assert.equal(articleSchema({...article,authorType:undefined})[0].author['@type'],undefined);
});
test('feed and sitemap expose only canonical public snapshots', () => {
  const blogs=[{slug:'published',state:'published',article:{},title:'Published & useful',summary:'Details <here>',publishedAt:'2026-10-13T12:00:00Z',modifiedAt:'2026-10-13T13:00:00Z'},{slug:'draft-secret',state:'draft',article:{},publishedAt:null},{slug:'archived-secret',state:'archived',article:{},publishedAt:'2026-10-12T00:00:00Z'}];
  for(const xml of [sitemap(blogs),feed(blogs)]){assert.match(xml,/published\//);assert.doesNotMatch(xml,/draft-secret|archived-secret/);}
  assert.match(sitemap(blogs),/<lastmod>2026-10-13T13:00:00Z<\/lastmod>/);
  assert.match(feed(blogs),/Published &amp; useful/);
});
