import React,{useEffect,useState} from 'react';
import {apiPath,engineConfig} from '../paths';
import {request} from './use-article-session';

export type LibraryItem={id:string;name:string;kind:string;source:string;visibility:string;url:string;previewUrl:string|null;uses:Array<{articleId:string;slug:string;title:string;section:string}>;canSelect:boolean;canDelete:boolean};
type Listing={items:LibraryItem[];total:number;offset:number;nextOffset:number|null;previousOffset:number|null};
type Props={slug?:string;mode?:'manage'|'body'|'featured'|'social';onSelected?:(items:LibraryItem[])=>Promise<void>;uploadFile?:(file:File)=>Promise<string>};

const toBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read image.'));reader.readAsDataURL(file);});
export function MediaLibrary({slug,mode='manage',onSelected,uploadFile}:Props){
 const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[source,setSource]=useState('all'),[type,setType]=useState('all'),[privateView,setPrivateView]=useState(false),[offset,setOffset]=useState(0);
 const [listing,setListing]=useState<Listing|null>(null),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failures,setFailures]=useState<File[]>([]),[uploadResults,setUploadResults]=useState<Array<{name:string;state:string}>>([]);
 const refresh=async()=>{const params=new URLSearchParams({search:query,source,type,privateView:String(privateView),offset:String(offset)});setListing(await request<Listing>('admin/media-library?'+params));};
 useEffect(()=>{let live=true;setBusy(true);refresh().catch(error=>{if(live)setMessage(error.message);}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[query,source,type,privateView,offset]);
 const upload=async(files:File[])=>{setBusy(true);setMessage('');const failed:File[]=[];let success=0;const results=files.map(file=>({name:file.name,state:'Waiting'}));setUploadResults([...results]);for(let index=0;index<files.length;index++){
   const file=files[index];setMessage(`Uploading ${index+1} of ${files.length}: ${file.name}`);
   results[index].state='Uploading';setUploadResults([...results]);try{if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5_000_000)throw Error('Choose JPEG, PNG, or WebP under 5 MB.');
    if(slug&&uploadFile)await uploadFile(file);else await request('admin/media','POST',{name:file.name,base64:await toBase64(file)});success++;results[index].state='Uploaded';}
   catch(error:any){failed.push(file);results[index].state='Failed — '+error.message;}setUploadResults([...results]);
  }setFailures(failed);setMessage(`${success} uploaded; ${failed.length} failed.`);setOffset(0);try{await refresh();}catch(error:any){setMessage(error.message);}setBusy(false);};
 const choose=async()=>{if(!onSelected||!listing)return;setBusy(true);try{await onSelected(selected.map(id=>listing.items.find(item=>item.id===id)!).filter(Boolean));setSelected([]);setMessage('Image selection added to the article.');}catch(error:any){setMessage(error.message);}finally{setBusy(false);}};
 return <section className="blog-media-library" aria-label="Media library">
  <div className="blog-media-library-nav"><h2>Media library</h2>{engineConfig().brandId==='cnerd'&&<a href="/admin?section=media" target="_blank" rel="noopener noreferrer">Website Admin ↗</a>}</div>
  <p>Browse website images and article uploads together. External images are references; no remote file is downloaded.</p>
  <form onSubmit={event=>{event.preventDefault();setSelected([]);setOffset(0);setQuery(search);}}><label>Search images<input value={search} onChange={event=>setSearch(event.target.value)}/></label><button type="submit">Search</button></form>
  <div className="blog-media-filters"><label>Source<select value={source} onChange={event=>{setSelected([]);setOffset(0);setSource(event.target.value);}}>{['all','Website upload','Library upload','Article upload','Bundled image','External reference'].map(value=><option key={value} value={value}>{value==='all'?'All sources':value}</option>)}</select></label><label>Type<select value={type} onChange={event=>{setSelected([]);setOffset(0);setType(event.target.value);}}>{['all','image','video','download'].map(value=><option key={value} value={value}>{value==='all'?'All types':value}</option>)}</select></label><label><input type="checkbox" checked={privateView} onChange={event=>{setOffset(0);setPrivateView(event.target.checked);setSelected([]);}}/> Private training assets</label></div>
  <label>Upload images<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={event=>{const files=[...(event.target.files||[])];event.target.value='';if(files.length)void upload(files);}}/></label>
  {failures.length>0&&<button type="button" disabled={busy} onClick={()=>void upload(failures)}>Retry {failures.length} failed upload{failures.length===1?'':'s'}</button>}
  <p role="status" aria-live="polite">{message}{busy&&!message?'Loading…':''}</p>
  {uploadResults.length>0&&<ul aria-label="Image upload results">{uploadResults.map((item,index)=><li key={index}>{item.name}: {item.state}</li>)}</ul>}
  {!busy&&listing?.items.length===0&&<p>No media matches this view.</p>}
  <div className="blog-media-grid">{listing?.items.map(item=><article key={item.id} className="blog-media-card">
   {item.previewUrl&&item.kind==='image'&&<img src={item.previewUrl} alt="" loading="lazy"/>}
   <h3>{item.name}</h3><p>{item.source} · {item.kind}{item.visibility==='training'?' · Private training':''}</p>
   {item.uses.length>0?<details><summary>Used in {item.uses.length} article view{item.uses.length===1?'':'s'}</summary><ul>{item.uses.map((use,index)=><li key={index}><a href={engineConfig().basePath+'/admin/?article='+encodeURIComponent(use.articleId)} target="_blank" rel="noopener noreferrer">{use.title||use.slug}</a> · {use.section}</li>)}</ul></details>:<p>Not referenced by an article</p>}
   {mode!=='manage'&&item.canSelect&&!privateView&&<label><input type="checkbox" checked={selected.includes(item.id)} onChange={event=>setSelected(previous=>event.target.checked?(mode==='body'?[...previous,item.id]:[item.id]):previous.filter(id=>id!==item.id))}/> Select image</label>}
  </article>)}</div>
  {mode!=='manage'&&<button type="button" disabled={busy||selected.length===0} onClick={()=>void choose()}>{mode==='body'?'Insert selected images':'Use selected image'}</button>}
  {listing&&<nav aria-label="Media library pages"><span>Showing {listing.total?listing.offset+1:0}–{listing.offset+listing.items.length} of {listing.total}</span><button type="button" disabled={busy||listing.previousOffset===null} onClick={()=>{setSelected([]);setOffset(listing.previousOffset!);}}>Previous</button><button type="button" disabled={busy||listing.nextOffset===null} onClick={()=>{setSelected([]);setOffset(listing.nextOffset!);}}>Next</button></nav>}
 </section>;
}
