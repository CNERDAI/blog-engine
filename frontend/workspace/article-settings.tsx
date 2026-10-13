import { enginePath, privateAssetPath } from "../paths";
import React,{useEffect,useState} from "react";
import {request} from "./use-article-session";
import type { ArticleSession } from "./use-article-session";

export function ArticleSettings({ session }: { session: ArticleSession }) {
  const { data, mark, recover, restore, saved } = session;
  const [images,setImages]=useState<Array<{path:string;name:string}>>([]);
  useEffect(() => {
    let live = true;
    if (saved.current) request<any[]>('admin/blog/' + saved.current.slug + '/assets')
      .then(assets => { if (live) setImages(assets.filter(a => a.kind === 'image' && a.visibility === 'public')); })
      .catch(e => session.setStatus(e.message));
    return () => { live = false; };
  }, []);
  const preview = privateAssetPath(data.heroImage);
  const fields = [
    ["summary", "Summary"],
    ["slug", "Article URL"],
    ["author", "Author"],
    ["heroImage", "Hero image path"],
    ["heroAlt", "Hero image description"],
    ["socialImage", "Social image override path (optional)"],
    ["socialImageAlt", "Social image description (optional)"],
    ["seoTitle", "SEO title"],
    ["seoDescription", "SEO description"],
  ] as const;
  return (
    <section className="cnerd-article-settings" aria-label="Article settings">
      {fields.map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            value={data[key] || ""}
            onChange={(event) => mark({ [key]: event.target.value })}
          />
        </label>
      ))}
      <section className="cnerd-featured-image" aria-label="Featured and social image">
        <h3>Featured and social image</h3>
        {data.heroImage&&<img src={preview} alt={data.heroAlt || "Selected featured image preview"}/>}
        <label className="check-label"><input type="checkbox" checked={Boolean(data.heroDecorative)} onChange={e => mark({heroDecorative: e.target.checked})} />Hero image is decorative</label>
        <label>Choose a library image<select value={images.some(i=>i.path===data.heroImage)?data.heroImage:''} onChange={e=>mark({heroImage:e.target.value})}><option value="">Select image</option>{images.map(i=><option value={i.path} key={i.path}>{i.name}</option>)}</select></label>
        <label>Upload featured image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={session.busy} onChange={e=>{const file=e.target.files?.[0];if(file)session.run(async()=>{const path=await session.upload(file,'src',true);mark({heroImage:path});},'Uploading featured image…');}}/></label>
        <p>Social crops use this focal point. Review the exported images before posting.</p>
        {(['x', 'y'] as const).map(axis => <label key={axis}>{axis === 'x' ? 'Horizontal' : 'Vertical'} crop focus · {Math.round((data.focalPoint?.[axis] ?? .5) * 100)}%<input type="range" min="0" max="100" step="1" value={Math.round((data.focalPoint?.[axis] ?? .5) * 100)} onChange={e => mark({focalPoint: {...(data.focalPoint || {x:.5,y:.5}), [axis]: Number(e.target.value) / 100}})} /></label>)}
      </section>
      <label>
        Topics, separated by commas
        <input
          value={data.topics.join(", ")}
          onChange={(event) =>
            mark({
              topics: event.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <button onClick={recover}>Download recovery copy</button>
      {saved.current && (
        <>
          <a
            href={enginePath(saved.current.slug + "/preview")}
            target="_blank"
            rel="noreferrer"
          >
            Open saved preview ↗
          </a>
          <button disabled={session.busy} onClick={restore}>
            Restore revision
          </button>
        </>
      )}
    </section>
  );
}
