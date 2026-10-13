# Saved narration and private producer handoff

The standalone engine copies the existing source extractor, MP3 storage, explicit activation guard and saved player. Playback fetches a saved manifest and MP3; it never invokes inference or a paid provider. Article reading works without JavaScript. When no saved narration is available, the reader explicitly chooses **Use browser reading**; it does not silently change voices.

## Voice identity and pronunciation

Instance configuration approves voices by stable ID. Historical IDs remain `heart` (stock Heart), `michael` (stock Michael), and `mike60s` (existing ElevenLabs identity). None establishes Michael's locally trained custom voice. An unconfigured or unverified local producer reports `available: false` and `customVoiceVerified: false`.

The `pronunciations` mapping belongs to the spoken-source identity. CNERD's legacy `{CNERD: 'see nerd', Olean: 'Olean'}` retains historical fingerprints exactly. Any different policy participates in the fingerprint. Style, link destinations, article URL, images, authors and private training remain excluded from spoken content. Draft-only edits preserve public playback against the published snapshot; publishing changed spoken text hides stale recordings until a matching recording is reviewed and activated.

## Server contract

The application server owns authentication, article ownership, revision checks and request limits. Helpers in `src/narration.mjs` never grant authorization. All paths below start with the configured blog mount, currently `/blog`.

| Helper | Contract |
| --- | --- |
| `narrationCapabilities()` | Approved voice IDs/labels/kinds, saved playback mode, producer availability. No secrets or reference audio. |
| `narrationExport(articleId, visibility)` | Published or private draft source with exact tokens/words, chapters and source fingerprint. |
| `narrationStatus(articleId)` | Recordings, published/draft fingerprints, jobs and current state. |
| `requestNarration(articleIdOrRecord, options)` | Requires approved `voiceId`, current `sourceFingerprint`, and 8–120 character `idempotencyKey`; defaults to draft. Saves a job and returns `id`/`jobId`, state and producer availability. |
| `narrationJobStatus(articleIdOrRecord)` | `not_requested`, `waiting_for_producer`, `generating`, `ready_for_review`, `failed`, `stale`, or `active`; detailed private jobs. |
| `narrationJobPackage(jobId)` | Current source and public engine/model/settings IDs for the private producer. Stale packages fail with 409. |
| `updateNarrationJob(jobId, state)` | Producer can mark only `generating` or `failed`; errors contain no producer paths. |
| `importProducedNarration(jobId, manifest, audio)` | Verifies job source, visibility, voice, engine/model; requires named acoustic alignment and rejects synthetic/fixture alignment labels. Returns `ready_for_review`; never publishes or activates. |
| `importNarration(articleId, manifest, audio)` | Existing manual/admin import contract, decoded MP3/checksum/source/alignment validation and duplicate protection. |
| `activateNarration(recordingId, active, expected)` | Explicit owner action with source fingerprint and previous active recording ID; published source must match. |

Job cache identity includes brand, article, visibility, source fingerprint, approved voice, engine/model and sorted settings. Idempotency keys cannot be reused with different inputs. Jobs and retry mappings persist in the instance SQLite database. Source packages and recordings remain private until the article is published and an owner activates a matching recording.

The first candidate deliberately has no connected producer execution. Requesting a job returns `waiting_for_producer` with the unavailable reason. Do not label that as completed generation. A private local producer can read the handoff, generate once, acoustically align the **final decoded MP3**, and upload its manifest. Confirm engine/license/hardware, private voice material, and an owner-approved sample before claiming a custom-voice workflow.

## HTTP and CLI

Public discovery: `GET /blog/api/narration/:slug`. Public assets: `GET/HEAD /blog/narration/:recordingId/audio` and `/manifest`. The server must preserve MP3 range requests, HEAD, content types and cache rules; legacy CNERD aliases are explicit compatibility routes.

Authenticated admin endpoints: `/blog/api/admin/narration/:articleId` for status, `/:articleId/export?source=draft`, `/:articleId/import`, and `/:recordingId/activate`, `/audio`, `/manifest`. The activation body is `{active, expectedSourceFingerprint, expectedActiveId}`.

Producer handoff endpoints: `GET /blog/api/integration/drafts/:articleId/narration-jobs/:jobId` and `POST .../:jobId/import`. The producer token must have only owned-draft source/job read and narration-import permissions; it must not receive a browser session, article editing, publication, deletion or private voice-reference access. The server supplies authorization before calling helpers. Import bodies contain `{expectedRevision, manifest, audioBase64}`.

`node scripts/narration-package.mjs` supports these commands:

- `export --base https://brand.example --cookie-file /private/session.txt --article-id ID --source draft --customer brand-id --project project-id --output /private/jobs`
- `import --base https://brand.example --cookie-file /private/session.txt --article-id ID --manifest /private/manifest.json --audio /private/audio.mp3`
- `activate --base https://brand.example --cookie-file /private/session.txt --article-id ID --recording-id ID --active true`
- `job-package --base https://brand.example --token-file /private/producer-token --article-id ID --job-id ID --output /private/job`
- `producer-import --base https://brand.example --token-file /private/producer-token --article-id ID --job-id ID --expected-revision 1 --manifest /private/manifest.json --audio /private/audio.mp3`

HTTPS is required outside loopback. Credential and output files are private; do not check them into the package. No command runs a model or stores training references. Use the current article revision, reconcile 409 before retrying, and leave failed work private for recovery.

## Validation, recovery and evidence limits

Install `ffmpeg` and `ffprobe` for audio import. `NARRATION_FFMPEG`/`NARRATION_FFPROBE` may point to installed trusted binaries. Upload limits are 40 MB and two hours. The final bytes must decode as one MP3 audio stream with matching duration and checksum. Every exported spoken word and chapter must have ordered finite timing with an alignment score. Settings reject private paths and references. Existing recordings survive invalid imports, and import deduplication preserves recording identity. Corrupted saved files are hidden from public delivery and retained privately for recovery.

Mathematical timestamp validation and a declared aligner do **not** prove that the words match the recording. Production producers must supply genuine acoustic alignment, followed by owner listening review. The engine cannot certify that a claimed aligner actually ran.

Back up the whole isolated `DATA_DIR`: consistent SQLite backup plus `instance.json`, `narrations/*.mp3`, and article/media storage. Stop the instance before making a filesystem copy of SQLite/WAL and media, or use the engine's consistent backup tooling. Restore into a fresh directory for the same brand, verify recording counts/checksums and current source fingerprints, then test playback and activation. Do not overwrite newer editorial work with an old backup.

Checks: `node --test tests/narration-source.test.mjs tests/narration.test.mjs tests/narration-player.test.mjs`. These create fresh temp databases and ffmpeg sine-tone MP3s. **Synthetic word times are test-only**, used to verify mapping, decoding, storage, seeking, highlighting, speed, chapter navigation, follow-scroll, Escape behavior, pause and explicit fallback in Chrome. They do not prove generated narration, custom voice, acoustic alignment quality, or listening quality. The player fixture's range server proves browser byte-range behavior; the full host integration test must separately verify the application's actual range handler.
