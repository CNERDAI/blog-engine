---
name: blog-engine
description: Create or update editable, private articles for a configured Blog Engine brand, upload actual supplied media, and prepare downloadable social assets or a local narration request. Use for Blog Engine article creation, not account posting or production deployment.
---

Resolve the requested brand through the owner's local registry; read the instance's capabilities before composing. Use verified defaults for author, locale, editorial style and approved voices. If brand identity is missing or mismatched, stop the affected import. The engine cannot switch brands through request content.

Use [the schema](references/schema.md) for canonical version-2 documents. The [focused article](examples/article.json) and [empty manifest](examples/assets.json) show a small usable draft; choose sections for the brief rather than filling every node type. Preserve code indentation, Unicode and useful teaching detail. Do not send private training or arbitrary HTML. Prepare private training separately for the owner to add manually.

Inspect actual supplied images before describing them. Match image descriptions to their use, include heroAlt when using a hero, and mark intentionally decorative images explicitly. Use actual authorized files in the manifest. Do not invent upload URLs, visual facts, replacement images or finished placeholder assets. Generated media needs a separate user request and an available generation tool. Keep article content editable.

Write recoverable article JSON, asset manifest and an import-state path before mutation. Manifest entries have key, absolute file path and kind (image/video/download); article references use `asset://KEY`. Review unsupported claims, redundant sections, heading order, links and image descriptions before import.

The local `BLOG_ENGINE_REGISTRY` environment variable names a mode-0600 JSON file mapping brand IDs to `{url,tokenEnv}`. Its URL includes the mount, for example `http://127.0.0.1:3100/blog`. Tokens come from the named environment variables and stay out of commands, chat, source control and article files. [Registry example](examples/registry.json) contains local fixture addresses, not verified production destinations. Configure real connections only with the owner's established authority. The engine's setup script can create a scoped token; creating/replacing credentials is separate from composing an article.

Run from the installed engine directory:

```sh
node scripts/blog-client.mjs --brand landworkspro capabilities
node scripts/blog-client.mjs --brand landworkspro import /absolute/article.json /absolute/assets.json /absolute/import-state.json --social
```

Reuse the stable manifest importId and state file to resume. The client binds state to server/brand and actual asset bytes, deduplicates uploads, validates after resolving placeholders, enforces expectedRevision and verifies readback. Completed imports are read without rewriting human edits. On a conflict, changed files or unknown network outcome, preserve state, read the current draft and reconcile before retrying. Do not clear state or mint keys to bypass a conflict. Report the failed step and recovery files.

For a reviewed update with uploaded media use `update ARTICLE_JSON ARTICLE_ID EXPECTED_REVISION`. `read ARTICLE_ID` and `status ARTICLE_ID` inspect only integration-owned drafts. `social ARTICLE_ID EXPECTED_REVISION [CAPTIONS_JSON]` prepares actual files; captions JSON maps destination to edited text. `--narration APPROVED_VOICE_ID` on import saves a narration request. That request may remain waiting for an unavailable producer. Saved playback never triggers inference. Do not call paid APIs, procure subscriptions or relabel a stock voice as a custom clone.

Return the verified editor link, saved revision, validation outcome, social export/status and narration availability. Publishing is the owner's distinct editor action. Social ZIP exports are not account posting; connected posting and an approved custom-voice engine are unavailable until configured and verified. Do not claim indexing, delivery or production launch from local API success.

Without a registry, legacy `CNERD_BLOG_URL`/`CNERD_BLOG_TOKEN` or the protected `private/cnerd-blog-credentials.json` retain the existing single-site importer path. For a standalone single instance, `BLOG_ENGINE_URL` (including mount), `BLOG_ENGINE_TOKEN`, and `BLOG_ENGINE_BRAND` (defaults to cnerd) select the modern contract.
