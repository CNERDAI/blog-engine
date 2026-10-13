# CNERD Blog Engine local acceptance

Version: 0.1.0. Date: October 13, 2026. Scope: standalone app, local installations and testing. No live deployment, source push, search-tool mutation, paid generation or real social publication was performed.

## Delivered candidate

- Separate Node/SQLite runtime and reused React/Tiptap editor, without CNERD website content seeds.
- Three isolated local brand configurations, independently protected data roots, owner sessions, draft tokens and producer tokens.
- Initial HTML articles, brand publisher/author metadata, canonical URLs, social image descriptions/dimensions, published sitemap/RSS, redirects and negative routes.
- Actual decoded image validation, resized variants, sanitized public delivery, meaningful/decorative descriptions, optional logo, configured time zone, social overrides and focal points.
- Private JPEG/ZIP social exports for Facebook, LinkedIn, X and Instagram, source/revision identity and manual-caption preservation.
- AI capability discovery, document validation, resumable real-asset imports, protected registry, OpenAPI and portable article skill.
- Saved MP3 transport/player, explicit activation, source matching, durable narration requests and scoped producer handoff.
- Independent website reverse-proxy fixture, reproducible install/build archive and verified backup/restore.

## Current verification

| Evidence | Observed result |
| --- | --- |
| Existing CNERD baseline | 17 document/source tests and 4 isolated draft API tests passed; initial restricted HTTP attempt could not connect and passed with local server access |
| Candidate combined tests | 50/50 passed, including actual decoded images, crops/ZIPs, scoped imports, privacy, stale/conflict behavior, saved MP3 ranges and backup/restore |
| Fresh install | Archive extracted into a new directory; `npm ci --offline --ignore-scripts --no-audit --no-fund` installed 166 packages with no original dependency symlink |
| Packaged tests | 50/50 passed from that independent install |
| Final mounted-media regression | 9/9 integrated tests passed after the last public asset route validation change; 14/14 affected integration/presentation checks also passed from the final independent package |
| Independent host | Its own homepage, mounted blog, host-origin canonical URL, authenticated Origin check, static assets and media worked through the proxy |
| Three final local instances | 39/39 read-only runtime, SEO, private-access and brand checks passed; final public in-app-browser console had zero errors |
| Real AI client | Local topic/image package saved a private editable draft, revision 2, with social state ready and audio waiting for producer |
| Editor browser checks | Chrome save/reload, 409 conflict, 401 expired session, typing during a slow save, recovery download, preview, settings, social files and audio availability passed with zero page errors |
| Responsive/browser presentation | Desktop, 390px mobile and 200% zoom inspected; public article also inspected in the Codex in-app browser |
| Saved-audio browser | Actual audio clock, seeking, highlighting, speed, chapters, follow-scroll and Escape behavior passed using a synthetic tone fixture |
| Preservation | All 660 recorded original CNERD source/private fingerprints matched |
| Documentation | OpenAPI JSON parsed and 158 local references resolved; skill frontmatter/reference validation passed using Ruby YAML because Python PyYAML was unavailable |

The final mounted-media change was also verified against the independently installed runtime with the affected integration suite. The unchanged broader tests retain their packaged-install evidence. Build warnings concern inherited library `use client` directives in the browser-only editor bundle; build and rendered editor checks passed.

Logs, original fingerprints, a reviewed source snapshot and screenshots are in `research/`. The package includes a file-hash manifest and has an external SHA-256 checksum. The local screenshots use synthetic test drafts, not customer content. The application directory is the independent source; its development dependency symlink is excluded from the installable archive.

## Local review

| Brand | Public demo | Editor |
| --- | --- | --- |
| CNERD AI | http://127.0.0.1:4310/blog/ | http://127.0.0.1:4310/blog/admin/ |
| LandworksPro | http://127.0.0.1:4311/blog/ | http://127.0.0.1:4311/blog/admin/ |
| RinkReations | http://127.0.0.1:4312/blog/ | http://127.0.0.1:4312/blog/admin/ |

Credentials are in each installation's protected `local-credentials.json`; use `private-cnerd`, `private-landworkspro` or `private-rinkreations`. They are absent from the release archive. These localhost links work only on the development machine while the corresponding process runs. README contains restart instructions.

## Remaining product boundaries

The local candidate covers the demonstrated first-release workflow. It is not a production readiness certification for the three real websites. Owner-approved logos/brand details, real host routing, current crawler/WAF behavior and external indexing remain to be verified before a launch. RinkReations' production domain is unknown.

Connected social-account posting is unavailable. Export files and share controls do not establish final social delivery. Review destination requirements and cropped images before posting.

No local voice-cloning engine is connected, Michael's replacement trained voice is unverified, and no narration subscription was created. Producer requests remain waiting. Synthetic tone/timing tests establish player/transport behavior only; they do not establish voice fidelity or production acoustic alignment.

Chrome/in-app-browser tests do not establish native Safari, Windows-browser or physical iPhone/Android behavior. The Docker recipe was provided but its image was not built or deployed during this local delivery. Native Mac, Windows, iOS and Android installers are unsupported by this web application.

Future CNERD migration must independently verify existing article IDs/URLs/assets/audio and root route compatibility. No existing CNERD data was copied into the brand demos or changed by this build.
