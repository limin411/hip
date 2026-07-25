# Open-source follow-ups

Scaffolding is in place (`SECURITY.md`, `CONTRIBUTING.md`, CoC, templates, etc.).  
Items below still need **maintainer input** before the public launch story is complete.

## Must fill later

### 1. Security contact

- [ ] Decide whether to publish a **security email** in `SECURITY.md` (currently GitHub Advisories only).
- [ ] If yes, provide the address allowed in the repo (e.g. `security@…` or personal).
- [ ] Enable GitHub **Private vulnerability reporting**:  
  Repo → Settings → Code security → Private vulnerability reporting.

### 2. Product screenshots / GIF

- [ ] Capture 2–4 images (suggested: Code surface, Chat, Settings/providers, agent run).
- [ ] Save under `docs/images/` (see `docs/images/README.md`).
- [ ] Wire filenames into `README.md` (and optionally locale READMEs) under **Screenshots**.

### 3. Releases & version narrative

- [ ] Confirm whether **v1.0.1** (or another tag) should exist on GitHub Releases.
- [ ] If tags/dates differ from `CHANGELOG.md`, update version + date sections.
- [ ] Attach macOS/Windows artifacts when ready; update **Download** section if the release URL pattern changes.

### 4. Author / identity display

- [ ] Confirm public author string: currently **`ljm`** in `NOTICE`, `package.json`, READMEs.
- [ ] Optionally add email form: `ljm <you@example.com>` (only if OK to publish).

### 5. Branch policy

- [ ] Confirm default contribution target: docs assume **PRs → `dev`**, stable **`main`**.
- [ ] If policy differs, update `CONTRIBUTING.md` + issue template links that point at `dev`.

## Nice to have (post-launch)

- [ ] Generate **`THIRD_PARTY_NOTICES`** (or CI step) for binary distributions — see `docs/release.md`.
- [ ] Soften marketplace “Official / Claude / Grok” UI copy if trademark review requests it.
- [ ] GitHub Topics, Discussions, first Release notes polish.
- [ ] Optional `SUPPORT.md` if support channels grow beyond Issues.

## Reference paths

| Topic | File |
|-------|------|
| Security policy | `SECURITY.md` |
| Contributing | `CONTRIBUTING.md` |
| Changelog | `CHANGELOG.md` |
| Config sample | `docs/examples/hip.toml.example` |
| Release steps | `docs/release.md` |
| Screenshot drop zone | `docs/images/` |
