# CNERD host compatibility in 0.1.1

`config/cnerd.production.json` configures the verified `https://cnerd.ai/blog/` mount, CNERD logo/navigation and existing approved voice identities. Host traffic forwards to an internal engine service. Brand configuration does not itself deploy anything.

An opt-in `CNERD_HOST_SESSION=1` bridge accepts existing `cnerd_session` cookies against the same CNERD SQLite session table. Other brand IDs reject this setting at startup. Standalone installations keep their namespaced authentication. Login now accepts a username, preserving existing website accounts as well as the standalone `owner` default.

For this first CNERD host integration only, the website and its engine intentionally share the existing private volume. The host reads blog snapshots for its homepage/sitemap and retains its existing draft-creation integrations. Blog reader/editor, publication and narration HTTP operations route to the engine. This preserves one editorial source of truth and avoids migrating or duplicating existing production content. It is not cross-brand shared storage. Keep unrelated brand databases and credentials isolated.

Detailed host routing, release scope, validation and recovery are documented in the CNERD website's `docs/blog-engine-integration.md`. A standalone deployment continues to use its own private data directory and does not enable this compatibility mode.
