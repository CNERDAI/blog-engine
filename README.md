# CNERD Blog Engine

Version 0.1.0 is a standalone local release candidate. One maintained application runs as an isolated installation for each brand. It reuses the CNERD React/Tiptap editor, server-rendered articles, version-2 content contract, SQLite revisions, protected draft imports, and saved narration.

## Requirements and local installation

Clone the standalone repository first:

```sh
git clone https://github.com/CNERDAI/blog-engine.git
cd blog-engine
```

Use Node 22.13 or later, FFmpeg/FFprobe, and the `zip` command. Install dependencies from the lockfile. The repository excludes installed dependencies and runtime data; a normal npm install is independent of other website checkouts.

```sh
npm ci
npm run build
BRAND_CONFIG=config/cnerd.local.json DATA_DIR=private-cnerd node scripts/setup.mjs
BRAND_CONFIG=config/cnerd.local.json DATA_DIR=private-cnerd node scripts/demo.mjs
BRAND_CONFIG=config/cnerd.local.json DATA_DIR=private-cnerd node src/server.mjs
```

Open `http://127.0.0.1:4310/blog/` and `/blog/admin/`. Setup stores the owner login and separate draft/producer tokens in the mode-0600 `private-cnerd/local-credentials.json`. It does not print secrets or overwrite an existing owner. Do not commit or publicly serve this directory. The demo creates clearly labeled local sample content only.

The other local configurations use `config/landworkspro.local.json` / `private-landworkspro` on port 4311, and `config/rinkreations.local.json` / `private-rinkreations` on port 4312. Run the same setup/demo/start commands with those names. Each database has a persistent brand marker; using another brand's directory fails before opening the database.

## Branding and independent website integration

Configure name, publisher and default author identity, public origin, mount path, language/time zone, theme colors, navigation/footer, social destinations, approved voices, and pronunciation rules. Optional `logo` accepts `{src,alt,width,height}`; put its actual file in the public assets directory or use a verified public URL. Keep private voice references and secrets out of configuration.

The fixtures use wordmarks and sample colors. They are not approved final logos or verified production configurations. For production, use an HTTPS origin with `environment: "production"` and `domainVerified: true`; placeholder origins are rejected. RinkReations' production domain remains unverified. The engine credit does not change the publishing brand in metadata/schema.

Prefer `/blog` as the mount. A single safe path such as `/journal` is also supported. Set `PUBLIC_ORIGIN` separately from `PORT`: the origin is the website visible to readers, while the port may be an internal service endpoint. Proxy the mount intact, including the admin/API/media/audio/assets/sitemap/feed paths. Forward methods, query strings, cookies, Authorization, upload headers, HEAD and Range. Bypass shared caching for authentication/admin/API responses. Never point public article URLs at the internal service origin.

The host owns its root robots and sitemap. Reference the engine's mounted sitemap and exclude private control surfaces from indexing. Private content still requires authentication; robots is not access control. `/robots.txt` and `/sitemap.xml` on a standalone server are sample whole-host surfaces, not instructions to replace a real website's unrelated rules.

`scripts/host-fixture.mjs` demonstrates an independent homepage with mounted reverse proxy and root sitemap/robots coordination. Set the engine's `PUBLIC_ORIGIN` to the host fixture URL when testing mutation Origin checks and canonicals through the proxy. Automated integration checks verify that arrangement.

Existing CNERD article media and import paths have explicit compatibility aliases. This candidate has not migrated or changed the CNERD site. A future migration must inventory stored links, editor bookmarks, sessions, and audio fingerprints before activation; legacy root admin/static routes are not a blanket replacement for the existing site's administration.

## Editing and article quality

Drafts are saved explicitly. Preview, undo, revision restoration, recoverable input, expected-revision conflicts, private training, and a separate Publish action remain. The editor exposes feature/social-image descriptions, decorative intent, focal point, SEO fields, social exports and Audio status. In-flight saves preserve subsequent typing. The external article skill prepares editable content rather than screenshots or raw HTML.

Published articles include text in their first HTML response, canonical and social metadata, truthful publisher/author schema, breadcrumbs, image dimensions/variants, related links, sitemap and RSS. Meaningful images need descriptions. Private image URLs cannot be published. Uploaded originals remain private; public image delivery uses resized JPEG derivatives with metadata stripped. Local fixture illustrations are demonstration assets, not generated customer artwork.

The admin article list shows publication state, unpublished changes, publication/display and updated dates in the brand's time zone, categories/topics, and saved versus reader-available audio. Search and status filters help find articles. The pencil opens a quick edit for title, author, categories and display date; saving preserves content and private training and does not publish. Deletion requires the exact title and the existing revision/reference safeguards. Automatic scheduled publication is unavailable; a future display date does not schedule an article.

## AI article creation

Use [.agents/skills/blog-engine/SKILL.md](.agents/skills/blog-engine/SKILL.md) with your AI assistant. Provide a brand, topic, audience/references and actual images. The assistant composes accurate canonical article JSON, then the CLI handles upload, validation, idempotent draft saving, optional social preparation and readback.

```sh
BLOG_ENGINE_REGISTRY=private-cnerd/client-registry.json node --env-file=private-cnerd/client.env scripts/blog-client.mjs --brand cnerd capabilities
BLOG_ENGINE_REGISTRY=private-cnerd/client-registry.json node --env-file=private-cnerd/client.env scripts/blog-client.mjs --brand cnerd import /absolute/article.json /absolute/assets.json /absolute/import-state.json --social --narration heart
```

Setup's registry contains one local connection. To connect multiple brands, create a protected registry with a distinct token environment variable per installation. Never use the same credential across brands. The CLI verifies server identity and protects resumable state from changed images, wrong endpoints, stale revisions and human edits. No inference provider or paid AI account is required by this interface; your external assistant creates the draft.

Read [docs/openapi.json](docs/openapi.json) and the skill's document schema for the exact contract. Draft credentials cannot publish, administer, delete, read private training or edit published articles. Producer credentials can only read owned draft narration job packages and import matching audio; they cannot edit articles or activate recordings.

## Social and narration

Social preparation creates real landscape/square/portrait JPEG compositions, destination copies for Facebook/LinkedIn/X/Instagram, editable captions, image descriptions, a versioned manifest and a private downloadable ZIP. Manual captions survive regeneration. Changes mark packages stale; the owner reviews actual crops and platform-specific placement before use. Connected-account posting is unavailable in this release. A download is not evidence of delivery to a social account.

Saved MP3 playback includes seek, speed, sections, highlighting and follow-scroll. Listening performs no model inference or paid request. Current approved voice identities include stock voices and CNERD's saved ElevenLabs identity. No local custom-voice producer is connected or verified; requests persist as `waiting_for_producer`. They do not start a subscription. See [docs/narration.md](docs/narration.md) for job packaging, measured alignment, scoped import, activation and stale-source safeguards. Tests use explicitly synthetic tone/timing fixtures to verify plumbing, not voice fidelity.

## Build, verification and recovery

```sh
npm test
npm run build
npm run qa:local
```

`qa:local` reads the three running fixture instances. It does not create or publish content. The versioned archive is `releases/cnerd-blog-engine-0.1.0.tar.gz`, with a SHA-256 file and build manifest. It excludes installed dependencies, secrets, local databases, private media and voice references. The Docker recipe is supplied; no live container deployment or image push is performed.

Quiesce editor writes and generation before backing up the selected installation. SQLite uses `VACUUM INTO` for a consistent copy; the full private data is preserved and checksummed. Backups contain secrets and drafts, so keep them private.

```sh
DATA_DIR=private-cnerd node scripts/backup.mjs /absolute/new-backup-directory
node scripts/restore.mjs /absolute/new-backup-directory /absolute/new-data-directory
```

Restore requires a new destination, checks every file and SQLite integrity, and never overwrites an existing installation. An upgrade replaces the versioned runtime while preserving each instance's data. Keep the prior runtime artifact and a verified backup; do not restore an old database over newer editorial work.

Read [docs/LOCAL-ACCEPTANCE.md](docs/LOCAL-ACCEPTANCE.md) for current evidence and remaining limitations. Google/search indexing, real social publishing, custom-voice quality and the three real website launches are separate external outcomes. Native Mac/Windows/iOS/Android installers are not targets of this web application.

## License

The engine is available under the [MIT license](LICENSE). Bundled third-party UI and fonts retain their own notices in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
