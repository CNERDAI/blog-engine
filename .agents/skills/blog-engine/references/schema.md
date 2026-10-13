The server validates with `src/blog-document.mjs`; no HTML is accepted. Articles use `schemaVersion: 2`, metadata (`slug`, `title`, `summary`, `author`, `topics`, `heroImage`, `heroAlt`, `seoTitle`, `seoDescription`) and canonical `bodyDoc: {type:"doc", content:[...]}`. Do not send private training fields through imports.

Native nodes: paragraph, heading (levels 2–4), bulletList/orderedList/listItem, taskList/taskItem, blockquote, codeBlock, image, hardBreak, horizontalRule. Text nodes contain `text` and optional marks: bold, italic, underline, strike, code, highlight, subscript, superscript, link (safe HTTP(S) or known local assets). CodeBlock contains plain text only and `attrs.language` (bash, javascript, python, json, etc.). Native images use `attrs.src`, `alt`, `title` (caption), and optional `decorative`, `width`, `height`. Meaningful images require accurate alt text; decorative images explicitly set decorative and empty alt.

Structured node: `{type:"cnerdBlock",attrs:{id:"b_...",block:{id:"b_...",type:...}}}`. Block IDs are `b_` plus 8–40 lowercase alphanumeric characters. Supported block data:

- image/video: src, alt, caption; video supports actual MP4 uploads or valid HTTPS YouTube URLs normalized to youtube-nocookie.
- gallery: images array of src/alt/caption.
- prompt: title, content.
- workflow: outcome, prerequisites array, tools array, steps array. Each step has id, title, instructions, prompt, image, imageAlt, expected, review boolean.
- checklist: title, items array of label/details.
- callout: title, body, tone (note/tip/warning).
- table: headings array and rows array of equally sized string arrays.
- download: href, label, description.

Limits: document 300,000 characters, depth 16, 6,000 nodes; image 5 MB (PNG/JPEG/WebP), MP4 18 MB, download 8 MB (PDF/TXT/JSON). Use `asset://KEY` placeholders in prepared JSON; the helper replaces them with real upload paths. Manifest assets need key, absolute file path, kind. Manifest importId must remain stable across retries.

Engine API prefix `/blog/api/integration/` (replace `/blog` with the configured mount) requires a scoped Bearer token. POST drafts accepts data/idempotencyKey; GET drafts/UUID reads; PUT drafts/UUID accepts data/expectedRevision/idempotencyKey; POST drafts/UUID/assets?kind=image uploads octet-stream with encoded X-Blog-Asset-Name. Drafts remain private. POST validate receives `{data,articleId?}`. GET capabilities advertises instance identity, supported schema, limits and voices. Social/narration requests accept expectedRevision and idempotencyKey. See `docs/openapi.json` in the engine package for derivative/download routes. Changing an idempotency key to bypass a revision conflict is unsafe and unnecessary.


Choose content for the brief rather than filling every supported node type. `examples/article.json` demonstrates a focused article without uploads; its manifest can use an empty assets array. Use the API capabilities for brand defaults and supported features. Keep presentation state such as editor outlines, previews, and collapsed code out of article JSON.
