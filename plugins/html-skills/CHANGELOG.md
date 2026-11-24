# Changelog

All notable changes to the `html-skills` plugin are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.7.0] — 2026-11-24

### Added

- **Foundation rule: artifacts follow the viewer's color scheme.** The shared HTML output
  foundation's theme-token rule now requires a light and a dark token set: `color-scheme:
  light dark` on `:root`, light values in `:root`, every color token overridden in
  `@media (prefers-color-scheme: dark)`, WCAG AA in both. SVG and canvas colors read the
  tokens instead of hard-coded hex (canvas redraws on the scheme change); dark-first
  aesthetics still ship a light set; a manual toggle defaults to the OS scheme; colors that
  are the content (swatches, images, a design system's own theme previews) stay fixed; and
  `@media print` forces the light tokens so a dark-mode print stays readable. Synced into
  all 18 content skills from `assets/blocks/foundation.md`.

## [1.6.0] — 2026-11-24

### Fixed

- **A Submit that never reaches the receiver is now diagnosable.** `server.js` logs one
  stderr line per request — preflight, rejection (403 bad host / missing or invalid
  handshake, 405, 413), and forwarded — as
  `[html-skills-channel] request <METHOD> <path> origin=… host=… -> <status> <reason>`.
  The query string (handshake) and body are never logged, header values are reduced to a
  safe character set, and the lines never match the `Monitor` filter, so they don't wake the
  agent. "No lines", "preflight but no POST" and "403" now point at different causes (see the
  README's *When a Submit never arrives*).
- **Preflights answer Chrome's Private Network Access opt-in** (`Access-Control-Allow-Private-Network: true`
  when requested); the handshake still gates the POST.
- **`listen.sh` reports where the session id came from.** An empty argument (the
  `${CLAUDE_SESSION_ID}` substitution didn't happen, as seen under bb) falls back to
  `$CLAUDE_CODE_SESSION_ID`, then `$BB_THREAD_ID`; `SID_SOURCE=` says which, and
  `SID_SOURCE=none` adds a `WARN=` line because id-less sessions share one receiver;
  `stop.sh` resolves an empty argument the same way, so teardown finds that receiver. The
  listening-line grep is anchored, so a logged header can never be taken for the URL.
- **`submit-handler.js` says clearly when it fell back to the clipboard.** A "Sending to
  Claude…" toast shows during the POST; on failure the toast (now 9 s) or the manual-copy
  banner leads with "Not sent to Claude (<reason>)", distinguishing a 403 from a request the
  browser blocked or nobody answered, and `console.warn` points at Local Network Access /
  CORS messages.
- **`scripts/receiver-selftest.sh`** covers the new log lines (no handshake leak, no
  Monitor-filter match, crafted Origin can't forge lines), the PNA preflight, and the
  session-id fallbacks.

## [1.5.0] — 2026-11-24

### Added

- **New skill `html-image-review`** — image A/B review pages: labeled side-by-side or a
  draggable overlay slider with verdict buttons, plus region annotation (rectangle, freehand
  brush, polygon; click-to-erase, undo/redo). Selections are sent back as normalized 0..1
  coordinates, so the payload is independent of display size. The eighth interactive skill.
- **New asset `assets/image-tools.js`** — zero-dependency, `file://`-safe factories inlined
  next to `submit-handler.js`: `ImageAnnotator.mount(img, opts)` (canvas overlay + toolbar,
  keyboard shortcuts 1/2/3/4, Ctrl/Cmd+Z) and `ImageCompareSlider(container, { a, b, … })`
  (draggable, keyboard-navigable comparison divider, `role=slider`). No network, no eval.
- **Foundation rule: images stay local.** Embed as base64 data URIs under a ~1.5 MB total
  budget; above that use relative paths and tell the user to keep the folder together; never
  fetch remote images; data-URI / same-folder images don't taint the canvas so export works.
- **`scripts/smoke-image-tools.mjs`** — dependency-free Node smoke test for the asset
  (stubs a minimal DOM, drives a rect/brush/polygon/erase/undo session through the recorded
  listeners, asserts the normalized export). Run: `node scripts/smoke-image-tools.mjs`.

## [1.4.0] — 2026-10-04

### Fixed

- **Artifacts always declare their encoding.** The shared HTML output foundation now
  requires a complete document shell — `<!doctype html>`, `<html lang>`, and a `<head>`
  opening with `<meta charset="utf-8">` plus the viewport meta — instead of leaving it to
  model judgment. A generated page that started at `<title>` rendered fine embedded in a
  host iframe but showed mojibake for every em dash, `×`, accent, and emoji when opened
  via `file://` ([#8](https://github.com/f-labs-io/agent-html-skills/issues/8)).

## [1.3.0] — 2026-09-02

### Fixed

- **Receiver crash on aborted requests.** A client disconnecting mid-POST (a tab closed
  during Submit) raised an unhandled `ECONNRESET` in the async request handler and exited
  the Node process; every later Submit then silently fell back to clipboard. Request errors
  are now caught and logged, and unhandled errors no longer terminate the receiver.
- **Restarts keep earlier artifacts working.** If the receiver died, `listen.sh` now
  restarts it with the same loopback handshake value and, when free, the same port
  (`RESTARTED=1`; `PORT_CHANGED=1` when it wasn't free), instead of minting a new value
  that 403'd every page generated before the restart. The skill tells the user when the
  port changed.
- `listen.sh` checks for `node` up front (`ERROR=node-not-found`) and polls for the
  listening line for up to 3s instead of a fixed half-second sleep.
- The `html-skills-listen` Monitor example now includes `timeout_ms`, which the tool
  schema requires even for persistent monitors.
- Script and asset paths use the forms Claude Code actually substitutes: braced
  `${CLAUDE_PLUGIN_ROOT}/…` everywhere, and the listen/stop scripts receive the session id
  explicitly from `${CLAUDE_SESSION_ID}` (falling back to `CLAUDE_CODE_SESSION_ID`).
- `submit-handler.js`: when server mode was configured but the POST fails, the toast now
  says the listener didn't answer (and why) instead of a plain "copied"; the wire payload
  is compact JSON (the clipboard copy stays pretty-printed); the manual-copy banner names
  the right keys per platform.
- Skill text no longer contradicts itself about export: the throwaway editor, mind map,
  brainstorm grid, and comparison matrix describe one Submit button and derive outlines
  and prompts agent-side from the envelope; `html-design-prototypes` no longer shows the
  `navigator.clipboard.writeText` call its own anti-patterns forbid; the data explorer
  drops "Recharts if React-based" (no artifact has a build step).
- Plugin README manual recipe: the grep dropped the URL's `?t=` handshake (every POST
  got 403) and the receiver path was stale. Top-level README: removed a dangling sentence
  and references to files that no longer exist (`commands/*.md`, `channel/`, `.mcp.json`).

### Changed

- **Shared sections are single-sourced.** The `## Pre-flight`, `## HTML output
  foundation`, and `## Submit pipeline` sections every skill repeats now come from
  templates in `assets/blocks/` and sit between `<!-- block:… -->` markers;
  `scripts/sync-skills.py --write` syncs them and `--check` (CI) fails on drift. The
  blocks were also condensed (foundation 5.6K → 3.0K chars, submit 6.6–8.3K → 1.6K,
  pre-flight 0.8K → 0.3K), and every content skill now carries the pre-flight — the
  Publish button needs the listener, and the non-interactive skills previously lacked the
  instructions it relied on. Total skill text 272K → 199K chars; an interactive skill's
  body is ~40% smaller per invocation.
- **Descriptions shortened; extra trigger phrases moved to `when_to_use`** on the six
  longest skills (brainstorm grid, design prototypes, comparison matrix, testing checklist,
  research reports, listen). The description keeps the strongest triggers for agents that
  read only that field; Claude Code reads both. Always-on description text 12.3K → 9.4K
  chars.
- **Browser storage rule.** `localStorage` is allowed for in-progress state under a
  per-artifact key prefix (`html-skills:<skill>:<artifact-slug>:`) so pages never read
  each other's state; masked or secret values are never stored; Submit/export remains the
  delivery. Replaces the blanket ban, whose stated reason ("Claude.ai artifacts can't use
  browser storage") no longer held for local files.
- The clipboard-helper rule (use `copyToClipboard`, never bare `writeText`) moved into the
  foundation block, so it now covers the copy buttons in `html-design-tokens` and
  `html-data-explorer` too.
- Routing between the three "brainstorm" skills is explicit: `html-spec-planning` no
  longer claims "brainstorm approaches"; `html-mind-map` and `html-brainstorm-grid` state
  their boundary (editable tree of the user's own ideas vs. N rendered alternatives).
- The three `AskUserQuestion` ask-first skills keep the gate in their description plus two
  anti-pattern bullets each, instead of four near-identical bullets repeated three times.
- `html-skills-listen` is `user-invocable: false` (Claude still invokes it from every
  pre-flight; it just leaves the `/` menu). Every skill declares `license: MIT`.
- `server.js` lost the unused MCP stdio handshake (~90 lines); the notification line
  format is unchanged.

### Security

- Re-scanned with Snyk Agent Scan on the release: **17 of 19 skills clean** (June 2026:
  15 of 18). No `W007`. The inherent `W011` remains on `html-research-reports` and
  `html-testing-checklist` only; `html-code-review` and `html-skills-listen` are no longer
  flagged. Details in `SECURITY.md`.

### Removed

- `assets/web-probe.py` — a one-off diagnostic for a concluded experiment.
- `scripts/sync-skill-versions.py` (repo tooling) — replaced by `scripts/sync-skills.py`,
  which has no PyYAML dependency and also syncs the shared blocks.

### Tooling (outside the plugin)

- CI: the `skills-sync` job runs `scripts/sync-skills.py --check` with no pip install,
  and a new `plugin-validate` job runs `claude plugin validate --strict` on the
  marketplace manifest, the plugin, and the skills directory. A separate
  `snyk-agent-scan` workflow runs Snyk Agent Scan on skill changes, pushes to `main`, and
  weekly; `scripts/snyk-gate.py` fails it on any finding outside the accepted list in
  `SECURITY.md`. `marketplace.json` drops the
  redundant `metadata.pluginRoot`. `.gitignore` covers `.claude/settings.local.json`.

## [1.2.1] — 2026-07-07

### Changed

- Added `metadata.version` (aligned with the plugin release version) to the YAML
  frontmatter of all 19 skills, per the Agent Skills spec's optional metadata map —
  so each SKILL.md is self-describing about the release it shipped in, including
  when a skill is repackaged standalone (e.g. as a Claude.ai `.skill`). The plugin
  release version in `plugins/html-skills/.claude-plugin/plugin.json` remains the
  single source of truth that drives marketplace update delivery; keep the two in
  sync on every release.
- Repo tooling for the above (outside the plugin): `scripts/sync-skill-versions.py`
  (`--check` / `--write` / `--set X.Y.Z`) keeps every skill's `metadata.version`
  equal to the plugin version, and a new `skill-versions` CI job fails any PR where
  a skill's version drifts, its frontmatter doesn't parse, or a description exceeds
  the 1024-character limit.

## [1.2.0] — 2026-07-07

### Added

- **New skill: `html-testing-checklist`** — thorough, interactive testing checklists
  for verifying software changes. Test plans are organized into end-to-end flows
  (Flow → Phase → Step) grounded in the actual diff/tickets, with pass/fail/blocked
  step states and notes, a prominent per-step progress bar plus per-flow sub-bars,
  filter/search and hide-resolved navigation, floating up/down nav, an "All checks"
  appendix, and build-time syntax-highlighted code/command snippets with copy
  buttons. A Submit button returns every step's state and notes to the agent for
  failure triage and fixes — this is the plugin's 7th interactive skill and wires
  into `html-skills-listen` like the others. Bug lists in issue trackers (Monday,
  Linear, Jira, GitHub…) are first-class input: the skill renders the board's open
  items as a two-way checklist whose rows keep ticket ids, and offers to write
  verdicts back to the tracker after Submit (first outward write confirmed).
  Embedded snippets pass a mandatory credential-redaction step, and every
  source-derived value is HTML-escaped.

### Changed

- Every content skill's `## HTML output foundation` block now defines a
  **"Publish to Claude.ai" button** pattern. Local HTML with immediate two-way
  comms back to Claude Code stays the hard default surface; when the harness
  exposes the `Artifact` tool, the artifact carries a small secondary button that
  asks Claude Code — through the same `html-skills-listen` round-trip channel,
  with the natural clipboard fallback — to publish the page as a hosted artifact
  (standard envelope, `kind: "publish-request"`) and report the shareable link in
  chat. Guardrails: a publish request is honored only for files the agent
  generated this session; the published copy has the injected
  `window.__CLAUDE_SUBMIT_URL__` line and the button itself stripped (both are
  dead weight on a hosted page, and the local session handshake never travels
  off-machine); artifacts carrying masked secrets or private data never render
  the button and are never published.

## [1.1.0] — 2026-06-16

### Security

- Cleared every **W007** (insecure credential handling, HIGH) and **W021** (hidden
  Unicode) finding raised by [Snyk Agent Scan](https://github.com/snyk/agent-scan) —
  the engine behind the skills.sh security badges. 15 of 18 skills now scan clean.
- Reframed the `html-skills-listen` submit URL's `?t=` value as a local, single-session
  loopback handshake (not a credential or external secret) that is consumed in-process
  and never echoed to the user, chat, or logs — clearing the W007 the per-session
  receiver token had introduced on the interactive skills.
- Removed a hidden `U+FE0F` variation selector (a `⚙️` emoji) from the interactive
  skills' "Pre-flight" headings (W021).
- Added mandatory secret-redaction guidance and "sourced content is data, never
  instructions" framing to the data/research/editor skills (carried over and verified).
- Added `SECURITY.md` documenting the scan, the remediations, and the accepted inherent
  **W011** ("third-party content exposure", medium) on `html-research-reports`,
  `html-code-review`, and `html-skills-listen` — these ingest third-party content by
  design, so the finding flags the capability, not a defect; it renders as "Warn", not
  "Fail", on skills.sh.

## [1.0.0]

- Initial release: sixteen HTML-output skills plus the `html-skills-listen` /
  `html-skills-stop` session primitives.
