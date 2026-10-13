# Blog Engine architecture

One maintained engine runs in a separate process/container and data directory per brand. The host website forwards a mounted path, normally `/blog`, without stripping the prefix. The engine returns complete article HTML on the host's configured public origin.

## Configuration and storage

`src/brand.mjs` validates the instance identity, public origin, mount, publisher/author identity, logo, theme, time zone, social destinations, pronunciation rules and approved voices. Local fixtures use loopback origins. Production configurations require HTTPS and owner verification of the domain.

`src/db.mjs` opens one SQLite database beneath DATA_DIR. A persistent brand marker rejects accidental reuse by another brand. The database bootstraps blog-only state and empty compatibility tables, without seeding another website's content. Media, saved recordings, social packs and narration jobs belong to that same installation.

## Editorial and public content

`src/blog-document.mjs` is the shared version-2 validation/rendering contract for the editor, integration API and public pages. Article content remains structured and editable; arbitrary HTML is rejected. `src/blog.mjs` manages drafts, immutable publication snapshots, revision checks, aliases and assets. Private training is removed from public snapshots.

`frontend/workspace/` contains the React/Tiptap editing session, preview, settings, outline, recovery and derivatives panels. Saving a draft and publishing are separate actions. Failed or conflicting saves preserve the user's in-memory edits and offer recovery.

`src/server.mjs` owns HTTP authentication, authorization, origin checks, request limits, mounted routing, static assets and byte ranges. `src/render.mjs` emits brand-aware page metadata, truthful article/publisher schema, sitemap and RSS. A request Host header cannot set canonical URLs. The host retains ownership of its root robots rules, sitemap and unrelated routes.

## Media, social and audio

`src/media.mjs` decodes actual uploaded images, caps dimensions, generates responsive JPEG variants and strips metadata from public derivatives. Private drafts and assets remain inaccessible to anonymous readers. `src/social.mjs` prepares real private image/caption/ZIP packages with revision/hash identity and manual-caption preservation. Exporting a package does not post to an account.

`src/narration*.mjs` preserve spoken-source fingerprints, measured word/chapter manifests, saved MP3s and explicit activation. Playback serves saved audio without triggering inference. Durable producer jobs are separate from article publishing; producer availability and voice provenance are reported accurately.

## AI connection

The integration API advertises capabilities and accepts scoped draft create/read/update, actual asset upload, validation, social preparation and narration requests. The CLI resolves an explicit brand connection, protects resumable state, applies idempotency/revision checks, and verifies server readback. The article skill teaches an external assistant how to compose focused content from a brief and actual supplied images.

Draft credentials cannot publish, delete, administer, access private training or edit published records. Producer credentials can only read and import narration jobs for owned drafts; they cannot edit articles or activate recordings. Credentials and personal voice references are never part of the repository or public configuration.

## Deliberate release limits

Version 0.1.0 is a locally tested candidate. Connected-account posting, a verified local custom-voice producer, live host integration and external indexing remain separate milestones. There is no multi-tenant control plane, theme builder, mandatory paid AI provider, or native installer.
