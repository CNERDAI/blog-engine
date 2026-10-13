import {DatabaseSync} from 'node:sqlite';
import {cpSync,existsSync,mkdirSync,readFileSync,statSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';

if(!process.argv[2]||!process.argv[3])throw Error('Usage: node scripts/restore.mjs BACKUP_DIR NEW_DATA_DIR');
const source=resolve(process.argv[2]),target=resolve(process.argv[3]);
if(existsSync(target))throw Error('Restore requires a new destination. Existing data will not be overwritten.');
const manifest=JSON.parse(readFileSync(resolve(source,'backup-manifest.json'),'utf8'));
if(manifest.schema!==1||!Array.isArray(manifest.files))throw Error('Invalid backup manifest.');
for(const file of manifest.files){const path=resolve(source,file.path);if(relative(source,path).startsWith('..')||!statSync(path).isFile()||createHash('sha256').update(readFileSync(path)).digest('hex')!==file.sha256)throw Error('Backup verification failed: '+file.path);}
mkdirSync(target,{recursive:true,mode:0o700});
for(const file of manifest.files){const dest=resolve(target,file.path);mkdirSync(resolve(dest,'..'),{recursive:true,mode:0o700});cpSync(resolve(source,file.path),dest);}
const db=new DatabaseSync(resolve(target,'site.sqlite'));const integrity=db.prepare('PRAGMA integrity_check').get();db.close();
if(Object.values(integrity)[0]!=='ok')throw Error('Restored database integrity check failed.');
console.log(`Verified restore completed at ${target}. Configure the matching brand before starting.`);
