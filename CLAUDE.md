# intervals-mcp

MCP server (stdio) over the [intervals.icu](https://intervals.icu) public API. Two jobs: read the
athlete's training data, and write structured workouts to the calendar that intervals.icu pushes
to the athlete's watch (Garmin Forerunner is the target device here).

## Commands

```bash
npm run build       # tsc -> dist/ (dist/stdio.js is the stdio entrypoint)
npm run typecheck   # builds first, then checks src + scripts + test + api
npm test            # node:test via tsx — currently the HTTP auth logic
npm run dev         # run from source with tsx
npm run token       # generate MCP_AUTH_TOKEN for the remote deployment
npm run smoke              # end-to-end read checks against the real API
npm run smoke -- --write   # also create/verify/delete a test workout tomorrow
python3 scripts/fitdump.py w.fit   # decode a workout FIT and show each step's target
```

Registered in Claude Code as the `intervals` MCP server pointing at `dist/stdio.js`, so
**rebuild after changing `src/`** or the running server keeps the old behaviour.

## Architecture

Two transports over one server definition:

- `src/server.ts` — `buildServer(client)`, transport-agnostic: instructions, the
  `intervals://workout-syntax` resource, and all tool registrations. Both entrypoints use it.
- `src/stdio.ts` — stdio entrypoint: `.env` loading, then connect. Never write to stdout, that is
  the protocol channel; logs go to stderr. **Do not rename this back to `src/index.ts`** — see
  gotcha 8.
- `api/mcp.ts` — Vercel Node function: token auth, then a stateless Streamable HTTP transport
  (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) built per request.
- `src/auth.ts` — shared-secret check for the HTTP route. Accepts the token from
  `Authorization: Bearer`, `x-api-key`, `x-auth-token`, the path (`/mcp/<token>`) or `?token=`,
  because MCP clients differ in what they can send. Constant-time compare on SHA-256 digests;
  refuses to serve at all when `MCP_AUTH_TOKEN` is unset or shorter than 24 chars.
- `src/client.ts` — HTTP client. Basic auth (username is the literal `API_KEY`), athlete-id
  resolution and caching, error messages that name the likely cause.
- `src/format.ts` — payload shaping. `Activity` has 183 fields and `Athlete` 158, so responses are
  reduced to curated field sets and enriched with readable forms (pace, durations).
- `src/tools/{athlete,activities,wellness,events}.ts` — each exports `register…Tools(server, client)`.
  Adding a tool means adding it there and calling the register function from `server.ts`.
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
7. **Vercel auto-detects a Node server from conventional entrypoints.** With the stdio entrypoint
   at `src/index.ts`, Vercel ignored the `api/` + `public/` layout, deployed that file as a single
   server function and routed everything to it — every route answered 500
   (`FUNCTION_INVOCATION_FAILED`) and the build log showed `intervals-mcp ready on stdio` followed
   by "No exports found in module /var/task/src/index.mjs". Hence `src/stdio.ts`, no `bin` field in
   `package.json`, and `"framework": null` in `vercel.json`. Keep all three.
8. **`api/` must import from `../dist/*.js`, not `../src/`.** Vercel bundles the function with
   esbuild, which does not do TypeScript's `.js` → `.ts` resolution, so a `../src/server.js`
   import fails at build time. That is why `tsconfig.json` has `declaration: true` (the `.d.ts`
   files give `api/` its types) and why `typecheck` builds before checking.

## Secrets

`INTERVALS_API_KEY` grants full read **and write** access to the account, with no scopes — treat it
as a password. It lives in `.env` (gitignored, never committed) and the server loads it itself, so
it does not need to appear in any MCP client config. It can be regenerated on intervals.icu at any
time.
