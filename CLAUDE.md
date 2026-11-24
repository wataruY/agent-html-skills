# agent-html-skills — conventions for Claude Code

## Versioning (required)

**Always bump the plugin version on every update — never ship changed code under the
same version string.**

- The version lives in `plugins/html-skills/.claude-plugin/plugin.json` → `"version"`.
- Every skill's `SKILL.md` frontmatter carries the same version in `metadata.version`
  (ecosystem sites read individual skills, so per-skill versions must match the plugin
  version). Don't edit the 19 files by hand — run
  `python3 scripts/sync-skills.py --set X.Y.Z` to bump plugin.json and stamp every skill
  in one step (or `--write` to re-sync after a manual plugin.json bump). The script has no
  third-party dependencies.
- Bump the **minor** (`x.Y.0`) for new skills or any behaviour/instruction change; bump the
  **patch** (`x.y.Z`) for small fixes (typos, tiny tweaks). Never reuse a released version.
- Update `plugins/html-skills/CHANGELOG.md` in the same change.
- After the release merges to `main`, tag it: `git tag vX.Y.Z && git push origin vX.Y.Z`
  (matches the existing `v1.0.0` tag convention).
- This bump is also load-bearing for **skills.sh**: it re-audits a skill only when the
  version string changes, so bumping is what refreshes the security badges.
- Do **not** confuse this with the submit-payload `version: 1` inside the interactive
  skills' `SKILL.md` / `submit-handler.js` — that is the JSON envelope schema version and
  is unrelated to the plugin release version.

## Shared skill sections (single-sourced)

Every content skill repeats the same `## Pre-flight`, `## HTML output foundation`, and
(interactive skills only) `## Submit pipeline` sections verbatim, because skills load
independently and skills.sh reads one `SKILL.md` at a time. Don't edit those copies:

- The templates live in `plugins/html-skills/assets/blocks/{preflight,foundation,submit}.md`.
- Each copy sits between `<!-- block:NAME -->` … `<!-- /block:NAME -->` markers.
- Edit the template, then run `python3 scripts/sync-skills.py --write` to push it into
  every skill. `--check` (run by CI) fails on any drift, on an unbraced
  `$CLAUDE_PLUGIN_ROOT`, on a `name` that doesn't match the skill directory, on a
  `description` over 1,024 characters (skills.sh limit), or on `description` +
  `when_to_use` over 1,536 characters (Claude Code truncates the pair in the skill listing).

## Skill descriptions

`description` is what every agent reads (skills.sh, `npx skills`, Cursor, Codex…), so it
keeps the strongest trigger phrases. `when_to_use` is Claude-Code-only extra trigger text
read alongside the description; keep the pair under the 1,536-character listing limit.
Descriptions are deliberately pushy — don't soften them. Changing wording in the
data/research/editor skills can re-trigger the skills.sh Snyk scan (W007 is
wording-sensitive); see `plugins/html-skills/SECURITY.md` and re-scan before tagging.

## CI

`.github/workflows/version-check.yml` runs on every PR to `main`: a version-bump +
changelog check, `scripts/sync-skills.py --check`, and `claude plugin validate --strict`
on the marketplace manifest, the plugin, and the skills directory.

`.github/workflows/snyk-agent-scan.yml` runs Snyk Agent Scan (the skills.sh engine) on PRs
that touch the skills, on pushes to `main`, weekly, and on demand, using the `SNYK_TOKEN`
repository secret. `scripts/snyk-gate.py` fails the job on any finding that isn't in its
`ACCEPTED` list; that list and the "Accepted (inherent)" section of
`plugins/html-skills/SECURITY.md` must be updated together.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:cdcea925 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for durable project facts — not per-tool memory files, which fragment across accounts; keep per-operator preferences in your harness's own memory

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
