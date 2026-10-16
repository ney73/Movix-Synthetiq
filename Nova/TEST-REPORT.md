# Nova (watchnova-v1) test report — 1.0.0-beta.1

Module ID/name/version: watchnova-v1 / Nova / 1.0.0-beta.1
ZIP: `Nova/dist/Nova-1.0.0-beta.1.zip`
ZIP SHA-256: `295d3735e28913a540594bed0ffb15fc3a1abb36b7ec829a23cee30a885c383b`
App version/device/OS: target = latest stable Synthetiq Player (NOT tested — no app/S2/device run).
Source permission and source URL (no tokens): public guest routes of https://watchnova.win only
(`GET /api/catalog?search=1`, `GET /api/titles/{id}/episodes`, public embed pages).
No login, no `/api/player/direct-link` (401 without session), no DRM/paywall/CAPTCHA bypass.
Test date/time and network type: 2026-10-16, direct broadband (Windows, Node 24.21.0 local harness).

## Coverage

| Exact title/year | Season/episode or chapter | Audio | Route/quality | Result | Evidence layer | Failure reason |
| --- | --- | --- | --- | --- | --- | --- |
| Vikings (2013) | S1E1 | FR | uqload HLS master -> variant -> ts | PASS | Local | — |
| Alien Predator (2018) | film | FR | uqload embed unpack -> HLS -> ts | PASS | Local | — |
| Girl in the Basement (2021) | film | FR | direct signed HLS -> ts | PASS | Local | — |
| Elize Surgie de l'Ombre | film | FR | vidmoly embed file: -> HLS -> ts | PASS | Local | — |
| Lucifer (2016) | S1E7 | FR | uqload HLS -> ts | PASS | Local | — |
| La Cité de Dieu | film | FR | direct signed HLS (u14.vidzy.cc) | FAIL | Local | HTTP 403 on all referers; source token stale (s~=50d old, e=48h), no public refresh |
| vidzy.org / movix / playmogo embeds | film | FR | unsupported hosts | PASS (honest empty) | Local | `{streams:[]}`; vidzy static decoy `fsvid.lol/troll` blocked (same clip for every title) |
| search/details/episodes incl. empty + bad-id | — | — | catalogue API | PASS | Local | bad ids throw; empty/gibberish search -> [] |
| Urgences (1994) | S1 x25 only | FR | episodes API | PASS (limit noted) | Local | source exposes season 1 only via public API |

Suggested release sampling (20 fixed + 10 seeded) was reduced to a 20-case matrix with a
documented reason: the source catalogue is 372 titles on a single dump endpoint and several
routes share the same three resolvers, so resolver coverage matters more than title count.

Attempted/pass/fail/blocked: kit offline 17/17/0/0; matrix 20/19/1/0; run_checks 4/4/0/0.
A resolution pass is not a playback pass. SUB/DUB not separately tested: source offers FR
audio only (no alternate audio to select; `lang` is accepted and ignored).

## Functional checks

- Home: not implemented (no paginated feed API on source; home rows are client-side slices).
  `config.capabilities` stays empty by design.
- Search/detail: exact identity kept (catalogue ids `movie-*`/`tv-*`); same-name check via
  year/type in cards; empty search and missing title covered.
- Lists: films = single entry with the film id in href; series mapped in S/E order with
  stable episode ids (`tv-*-sNeM`); signed media URLs re-resolved at play time, never cached.
- Video: NOT verified (no device/S2). Local sampler confirmed HLS variant -> media playlists
  and MPEG-TS container bytes on 5 routes; decode, language-by-ear and seeking unverified.
- Subtitles: none exposed (embeds carry only thumbnail tracks + empty caption placeholder).
- Controls / download / offline: NOT RUN.
- Errors: unsupported hosts -> `{streams:[]}`; unknown ids throw; no substituted content
  (decoy clip blocked); no leaked URLs/keys in this report.

## Final verdict

Local checks: PASS (with 1 documented source-stale failure)
S2 (video, maintainer tools): NOT RUN (blocked — needs maintainer)
Physical-device playback or reader test: NOT RUN
Download/offline: NOT RUN
Known limitations: guest routes only; some series expose S1 only; signed links can go stale
(movie-598); unsupported embed hosts return empty; FR audio only; no subtitles; no discovery;
development identity PENDING-OWNER-ALLOCATION / 0 — needs maintainer allocation + app import
test before any public release.
Release approved by: —
