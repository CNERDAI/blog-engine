import {mkdirSync,cpSync,existsSync,readdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const pkg=JSON.parse(readFileSync('package.json','utf8')),root=`.build-${Date.now()}`;
mkdirSync(root);
const localDocs=new Set(['docs/extraction-provenance.json','docs/BLOG-ENGINE-PRD.md','docs/BLOG-ENGINE-IMPLEMENTATION.md']);
for(const folder of ['src','frontend','scripts','tests','config','.agents','docs'])if(existsSync(folder))cpSync(folder,resolve(root,folder),{recursive:true,filter:p=>!p.includes('sync-conflict')&&!localDocs.has(relative(resolve('.'),resolve(p)))});
for(const file of ['package.json','package-lock.json','README.md','LICENSE','Dockerfile','vite.config.mjs','tsconfig.json','THIRD-PARTY-NOTICES.md','AGENTS.md','.dockerignore'])if(existsSync(file))cpSync(file,resolve(root,file));
mkdirSync(resolve(root,'public'),{recursive:true});
for(const file of ['engine.css','site.js','article-date.js','ui-icons.js','admin/manage.js','admin/article-list.js','assets'])if(existsSync(resolve('public',file)))cpSync(resolve('public',file),resolve(root,'public',file),{recursive:true});
function scan(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(resolve(dir,e.name)):[resolve(dir,e.name)]);}
const files=scan(root).map(file=>({path:relative(resolve(root),file),bytes:readFileSync(file).length,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}));
if(files.some(f=>/(?:^|\/)(?:private[^/]*|node_modules|research|\.env)(?:\/|$)/.test(f.path)))throw Error('Private or local runtime data reached the build.');
writeFileSync(resolve(root,'manifest.json'),JSON.stringify({name:pkg.name,version:pkg.version,builtAt:new Date().toISOString(),files},null,2)+'\n');
if(existsSync('dist')){mkdirSync('research/build-backups',{recursive:true});renameSync('dist',`research/build-backups/${Date.now()}`);}
renameSync(root,'dist');
mkdirSync('releases',{recursive:true});
const archive=resolve('releases',`cnerd-blog-engine-${pkg.version}.tar.gz`);
const result=spawnSync('tar',['-czf',archive,'-C','dist','.'],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);
writeFileSync(archive+'.sha256',createHash('sha256').update(readFileSync(archive)).digest('hex')+'  '+archive.split('/').at(-1)+'\n');
console.log(`Built ${pkg.name} ${pkg.version}: ${files.length} files; ${archive}`);
