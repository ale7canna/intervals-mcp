# intervals-mcp

MCP server (stdio) over the [intervals.icu](https://intervals.icu) public API. Two jobs: read the
athlete's training data, and write structured workouts to the calendar that intervals.icu pushes
to the athlete's watch (Garmin Forerunner is the target device here).

## Commands

```bash
npm run build       # tsc -> dist/ (dist/index.js is the MCP entrypoint)
npm run typecheck   # src + scripts (tsconfig.check.json)
npm run dev         # run from source with tsx
npm run smoke              # end-to-end read checks against the real API
npm run smoke -- --write   # also create/verify/delete a test workout tomorrow
python3 scripts/fitdump.py w.fit   # decode a workout FIT and show each step's target
```

Registered in Claude Code as the `intervals` MCP server pointing at `dist/index.js`, so
**rebuild after changing `src/`** or the running server keeps the old behaviour.

## Architecture

- `src/index.ts` — server bootstrap, `.env` loading, MCP instructions, `intervals://workout-syntax`
  resource. Never write to stdout: stdio is the protocol channel, logs go to stderr.
- `src/client.ts` — HTTP client. Basic auth (username is the literal `API_KEY`), athlete-id
  resolution and caching, error messages that name the likely cause.
- `src/format.ts` — payload shaping. `Activity` has 183 fields and `Athlete` 158, so responses are
  reduced to curated field sets and enriched with readable forms (pace, durations).
- `src/tools/{athlete,activities,wellness,events}.ts` — each exports `register…Tools(server, client)`.
  Adding a tool means adding it there and calling the register function from `index.ts`.
- `src/workout-syntax.ts` — the workout text format: a compact cheat sheet inlined into tool
  descriptions (so the model always sees it) and a full guide for the resource/tool.

Tool descriptions are in English on purpose (model-facing); README is in Italian (user-facing).

## intervals.icu API notes

- OpenAPI spec: <https://intervals.icu/api/v1/docs/> — 117 endpoints. Field descriptions are
  mostly empty, but the enums are authoritative (`category`, `target`, activity types, `pace_units`).
- Auth: Basic, `API_KEY:<key>`. `/athlete/0` resolves to the authenticated athlete.
- Dates are the athlete's **local** dates, never with a timezone: `2026-08-20T00:00:00`.
- List endpoints accept `fields=` to trim the payload; `GET /athlete/{id}/events` accepts
  `resolve=true` to convert % targets into watts / bpm / m·s⁻¹.
- `workout_doc` has no published schema. Code that reads it must be defensive — recognise the
  common shape (`steps[]`, `reps`, `power|hr|pace: {value|start|end, units}`) and ignore the rest.

## Hard-won gotchas

These were all found empirically; don't rediscover them.

1. **A missing threshold silently kills device targets.** If the sport has no `threshold_pace`
   (pace targets) or no `ftp` (power targets), intervals.icu strips those targets from the file it
   pushes to the watch — *even for absolute targets like `4:30/km Pace`*, where no threshold is
   needed to compute anything. `workout_doc` still looks correct, so the API gives no hint; the
   FIT shows `target=open` on every step. `create_workout` pre-flights this and returns
   `device_export_warning`. HR targets are safe as long as LTHR or max HR is set.
2. **Step cues must come before the duration.** `- Stay relaxed 5m 80%` keeps the note;
   `- 5m 80% Stay relaxed` parses without error and drops the text.
3. **`m` means minutes.** Metres are `mtr` (`400mtr`). `2km`/`1mi` also work.
4. **The device upload is triggered by a change to the event**, not by a fixed schedule. Fixing a
   threshold does not re-push an already-uploaded workout: touch the event to make it go again.
   `icu_garmin_last_upload` on the athlete is account-level (when the job last ran, for anything);
   `push_errors` on the event is the per-workout signal, and only appears on failure.
5. **A step with no target is valid** (`- 60s Recupero camminando`) — that is how a free recovery
   between reps is written.
6. Absence of `push_errors` is not proof the workout reached the watch, only that nothing failed
   loudly. The definitive check is decoding the FIT (`scripts/fitdump.py`).

## Secrets

`INTERVALS_API_KEY` grants full read **and write** access to the account, with no scopes — treat it
as a password. It lives in `.env` (gitignored, never committed) and the server loads it itself, so
it does not need to appear in any MCP client config. It can be regenerated on intervals.icu at any
time.
