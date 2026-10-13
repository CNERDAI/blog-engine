import React, { useEffect, useState } from 'react';
import { apiPath, engineConfig, enginePath } from '../paths';
import { request, type ArticleSession } from './use-article-session';

const allDestinations = ['facebook', 'linkedin', 'x', 'instagram'];
function mountedUrl(value: string): string {
  if (value?.startsWith('/blog/')) return enginePath(value.slice(6));
  if (value?.startsWith('/api/')) return enginePath(value);
  return value;
}
function audioBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the audio file.'));
    reader.readAsDataURL(file);
  });
}
export function DerivativesPanel({ kind, session }: { kind: 'social' | 'audio'; session: ArticleSession }) {
  const destinations = allDestinations.filter(destination => !engineConfig().socialDestinations || engineConfig().socialDestinations!.includes(destination));
  const [captionsDirty, setCaptionsDirty] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [pack, setPack] = useState<any>(null);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [recordings, setRecordings] = useState<any>(null);
  const [voiceId, setVoiceId] = useState(engineConfig().approvedVoices?.[0]?.id || '');
  const [manifest, setManifest] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
  const record = session.saved.current;
  const refresh = async () => {
    if (!record) return;
    const state = await request<any>('admin/blog/' + record.slug + '/status');
    setStatus(state);
    if (kind === 'social') {
      const value = state.social || { state: 'not_requested' };
      setPack(value);
      setCaptions(Object.fromEntries(destinations.map(destination => [destination, value.captions?.[destination]?.text || value.captions?.[destination] || ''])));
    } else setRecordings(await request<any>('admin/narration/' + record.id));
  };
  useEffect(() => { let live = true; refresh().catch(error => { if (live) setFeedback(error.message); }); return () => { live = false; }; }, [kind, record?.id]);
  const run = async (action: () => Promise<void>) => {
    setPending(true); setFeedback('');
    try { await action(); }
    catch (error: any) { setFeedback(error.message); }
    finally { setPending(false); }
  };
  if (!record) return <p>Save Draft first to prepare {kind === 'social' ? 'social exports' : 'audio'}.</p>;
  return <section className="blog-engine-derivatives" aria-label={kind === 'social' ? 'Social preparation' : 'Audio preparation'}>
    <p>Saved revision {record.revision}. {session.dirty && 'Newer edits are unsaved. Save Draft before preparing new assets.'}</p>
    <p role="status" aria-live="polite">{feedback}</p>
    <button disabled={pending} onClick={() => { if (!captionsDirty || confirm("Refresh and discard unsaved caption edits?")) { setCaptionsDirty(false); void run(refresh); } }}>Refresh status</button>
    {status?.validation && <div className="blog-engine-validation"><h3>Validation</h3>{[...(status.validation.errors || []), ...(status.validation.warnings || [])].map((item: any, index: number) => <p key={index}>{typeof item === 'string' ? item : (item.path ? item.path + ': ' : '') + (item.message || item.checkId)}</p>)}</div>}
    {kind === 'social' ? <>
      <p>Caption edits are saved with Prepare / save social package.</p>
      <p>Account posting is unavailable. Download the files and review them before posting.</p>
      <p>Package: {pack?.state || 'not requested'}{pack?.sourceRevision ? ' · Article revision ' + pack.sourceRevision : ''}</p>
      {destinations.map(destination => <label key={destination}>{destination === 'x' ? 'X' : destination[0].toUpperCase() + destination.slice(1)} caption<textarea disabled={pending} value={captions[destination] || ''} onChange={event => { setCaptions({ ...captions, [destination]: event.target.value }); setCaptionsDirty(true); }} /></label>)}
      <button disabled={pending || session.busy || session.dirty} onClick={() => run(async () => {
        const supplied = Object.fromEntries(Object.entries(captions).filter(([, text]) => text.trim()));
        const value = await request<any>('admin/blog/' + record.slug + '/social', 'POST', { expectedRevision: record.revision, idempotencyKey: 'editor-social:' + crypto.randomUUID(), captions: supplied });
        setPack(value);
        setCaptions(Object.fromEntries(destinations.map(destination => [destination, value.captions?.[destination]?.text || value.captions?.[destination] || ''])));
        setCaptionsDirty(false);
        setFeedback('Social files prepared. Review the exported images and captions.');
      })}>Prepare / save social package</button>
      {pack?.images?.map((image: any) => <figure key={image.destination}><img src={mountedUrl(image.url)} alt={image.alt || ''} width={image.width} height={image.height} /><figcaption>{image.destination} · {image.width} × {image.height}</figcaption></figure>)}
      {pack?.exportUrl && <a href={mountedUrl(pack.exportUrl)}>Download social ZIP</a>}
    </> : <>
      <h3>Saved recordings</h3>
      <p>{recordings?.recordings?.length ? `${recordings.recordings.length} saved recording${recordings.recordings.length === 1 ? '' : 's'}. Listening plays saved audio without contacting VoiceStudio.` : 'No saved recordings for this article.'}</p>
      <h3>VoiceStudio connection</h3>
      <p>{status?.audio?.producer?.available ? 'A local producer is connected.' : 'Manual export and import are available. Automatic VoiceStudio generation is not connected.'}</p>
      <p>Previous VoiceStudio/Kokoro recordings use stock Heart and Michael voices. They are not a custom Mike voice.</p>
      <p>Workflow: Save the article, export its spoken source, produce an approved voice in VoiceStudio, prepare measured timing for the final MP3, import both files, preview, and activate after the matching content is published.</p>
      {status?.audio?.jobs?.length > 0 && <p>Latest production request: {status.audio.state}. {status.audio.producer?.reason}</p>}
      <label>Approved voice<select value={voiceId} onChange={event => setVoiceId(event.target.value)}><option value="">Select voice</option>{engineConfig().approvedVoices?.map(voice => <option key={voice.id} value={voice.id}>{voice.name || voice.id}</option>)}</select></label>
      <button disabled={pending || session.dirty || !voiceId || !status?.audio?.producer?.available} onClick={() => run(async () => {
        const value = await request<any>('admin/blog/' + record.slug + '/narration', 'POST', { expectedRevision: record.revision, voiceId, idempotencyKey: 'editor-audio:' + crypto.randomUUID() });
        setFeedback(value.message || 'Narration request saved. Check producer status.');
        await refresh();
      })}>Request narration</button>
      <p><a href={apiPath('admin/narration/' + record.id + '/export?source=draft')}>Download spoken source for local producer</a></p>
      <label>Producer manifest<input type="file" accept="application/json,.json" onChange={event => setManifest(event.target.files?.[0] || null)} /></label>
      <label>Saved MP3<input type="file" accept="audio/mpeg,.mp3" onChange={event => setAudio(event.target.files?.[0] || null)} /></label>
      <button disabled={pending || !manifest || !audio} onClick={() => run(async () => {
        await request('admin/narration/' + record.id + '/import', 'POST', { manifest: JSON.parse(await manifest!.text()), audioBase64: await audioBase64(audio!) });
        setFeedback('Recording imported for review.'); await refresh();
      })}>Import saved recording</button>
      {recordings?.recordings?.map((recording: any) => <article key={recording.id}><h3>{recording.label || recording.voiceId}</h3><p>{recording.active ? 'Active' : recording.stale ? 'Stale source' : 'Ready for review'} · {Math.floor(Number(recording.duration || 0) / 60)}:{String(Math.round(Number(recording.duration || 0) % 60)).padStart(2, '0')}</p>{recording.voiceId === 'mike60s' && <p>Source: ElevenLabs saved recording.</p>}{!recording.active && recording.sourceFingerprint !== recordings.publishedSourceFingerprint && <p>Publish the matching content before activating this recording.</p>}<audio controls preload="none" src={mountedUrl(recording.audioUrl || apiPath('admin/narration/' + recording.id + '/audio'))} /><button disabled={pending || (!recording.active && (recording.stale || recording.sourceFingerprint !== recordings.publishedSourceFingerprint))} onClick={() => run(async () => {
        await request('admin/narration/' + recording.id + '/activate', 'POST', { active: !recording.active, expectedSourceFingerprint: recording.sourceFingerprint, expectedActiveId: recordings.recordings.find((item: any) => item.active && item.voiceId === recording.voiceId)?.id || null });
        setFeedback(recording.active ? 'Recording deactivated.' : 'Recording activated.'); await refresh();
      })}>{recording.active ? 'Deactivate' : 'Activate for published article'}</button></article>)}
    </>}
  </section>;
}
