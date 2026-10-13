import {randomBytes} from 'node:crypto';
import {existsSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {db, dataDir, hash, passwordHash} from '../src/db.mjs';
import {issueBlogToken} from '../src/blog-import.mjs';
import {brand} from '../src/brand.mjs';

const target=resolve(dataDir,'local-credentials.json');
if(existsSync(target)||db.prepare('SELECT username FROM users LIMIT 1').get())throw Error('This installation is already configured. Existing credentials were preserved.');
const password=process.env.BLOG_ADMIN_PASSWORD||randomBytes(24).toString('base64url');
if(password.length<14)throw Error('Use an administrator password of at least 14 characters.');
db.prepare('INSERT INTO users VALUES(?,?)').run('owner',passwordHash(password));
const integration=issueBlogToken().token,producer='cnerd_producer_'+randomBytes(32).toString('hex');
db.prepare('INSERT INTO blog_producer_tokens VALUES(?,?)').run(hash(producer),'codex-blog');
writeFileSync(target,JSON.stringify({brand:brand.id,editorUrl:brand.publicOrigin+brand.basePath+'/admin/',username:'owner',password,integrationToken:integration,producerToken:producer},null,2)+'\n',{mode:0o600,flag:'wx'});
writeFileSync(resolve(dataDir,'client.env'),`BLOG_ENGINE_TOKEN=${integration}\nBLOG_ENGINE_PRODUCER_TOKEN=${producer}\n`,{mode:0o600,flag:'wx'});
writeFileSync(resolve(dataDir,'client-registry.json'),JSON.stringify({[brand.id]:{url:brand.publicOrigin+brand.basePath,tokenEnv:'BLOG_ENGINE_TOKEN'}},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(`Configured ${brand.name}. Local credentials saved privately at ${target}.`);
db.close();
