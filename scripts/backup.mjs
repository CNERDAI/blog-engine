import {DatabaseSync} from 'node:sqlite';
import {cpSync,existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';

const source=resolve(process.env.DATA_DIR||'private'),target=resolve(process.argv[2]||`research/backups/${Date.now()}`);
if(!existsSync(resolve(source,'site.sqlite')))throw Error('No installation database exists at DATA_DIR.');
if(existsSync(target))throw Error('Choose a new backup directory. Existing data is preserved.');
if(target.startsWith(source+'/'))throw Error('Backup must be outside the data directory.');
mkdirSync(target,{recursive:true,mode:0o700});
// Quiesce generation/editor writes before running; VACUUM INTO makes SQLite consistent.
const db=new DatabaseSync(resolve(source,'site.sqlite'));
db.prepare('VACUUM INTO ?').run(resolve(target,'site.sqlite'));
db.close();
for(const name of readdirSync(source))if(!/^site\.sqlite(?:-wal|-shm)?$/.test(name))cpSync(resolve(source,name),resolve(target,name),{recursive:true});
function scan(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(resolve(dir,e.name)):[resolve(dir,e.name)]);}
const files=scan(target).map(file=>({path:relative(target,file),sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}));
writeFileSync(resolve(target,'backup-manifest.json'),JSON.stringify({schema:1,createdAt:new Date().toISOString(),files},null,2)+'\n',{mode:0o600});
console.log(`Consistent local backup saved at ${target}. Keep it private; it contains credentials and drafts.`);
