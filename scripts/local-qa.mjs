import {mkdirSync,writeFileSync} from 'node:fs';

const targets=[['cnerd',4310,'CNERD AI'],['landworkspro',4311,'LandworksPro'],['rinkreations',4312,'RinkReations']];
const checks=[];
for(const [brand,port,name] of targets){
  const origin=`http://127.0.0.1:${port}`;
  const health=await fetch(origin+'/blog/api/health').then(r=>r.json());checks.push({brand,check:'runtime identity',passed:health.brand===brand&&health.version==='0.1.0'});
  const response=await fetch(origin+'/blog/welcome-to-your-blog/'),html=await response.text();
  for(const [check,passed] of [
    ['public article',response.status===200],['brand presentation',html.includes(name)],['canonical origin',html.includes(`rel="canonical" href="${origin}/blog/welcome-to-your-blog/"`)],
    ['initial article content',html.includes('Write')&&html.includes('review')],['structured data',html.includes('BlogPosting')],['social alt',html.includes('og:image:alt')&&html.includes('twitter:image:alt')],
    ['image dimensions',html.includes('width="1600"')&&html.includes('srcset=')],['private training excluded',!html.includes('PRIVATE DEMONSTRATION TRAINING')],['module reader',html.includes('type="module" src="/blog/assets/site.js"')]
  ])checks.push({brand,check,passed});
  const sitemap=await fetch(origin+'/blog/sitemap.xml').then(r=>r.text());checks.push({brand,check:'published sitemap',passed:sitemap.includes('welcome-to-your-blog/')});
  const feed=await fetch(origin+'/blog/feed.xml').then(r=>r.text());checks.push({brand,check:'RSS',passed:feed.includes('<rss')&&feed.includes(name)});
  checks.push({brand,check:'private administration',passed:(await fetch(origin+'/blog/api/admin/blog')).status===401});
}
mkdirSync('research',{recursive:true});writeFileSync('research/local-qa.json',JSON.stringify({version:'0.1.0',checkedAt:new Date().toISOString(),checks},null,2)+'\n');
const failures=checks.filter(c=>!c.passed);console.log(`${checks.length-failures.length}/${checks.length} local fixture checks passed.`);if(failures.length){console.error(failures);process.exitCode=1;}
