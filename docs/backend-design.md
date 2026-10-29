# RenovaCAD AI Backend — Design (Milestone: AI Proposal Foundation)

## Goal
End-to-end `POST /api/ai/propose-edit` that returns a validated cabinet-width proposal without mutating scene state. Keep backend independent of Electron UI for this task.

## Placed location
`services/api` — small, clear, matches requested `services/api` example. Alternative `backend/` would be less precise about service role. `services/` allows future services (render, storage) alongside.

## Compared boundaries

| Option | Owner | Pros | Cons | Verdict |
|--------|-------|------|------|---------|
| A: Go service owns proposal validation, model client thin | Go | Strict trust boundary, fake-able provider, UI stays thin | UI must still revalidate before `apply-proposal` | **Chosen** |
| B: Model output applied directly via UI reducer | UI | Minimal backend | Model can bypass dimension limits, trust violation | Rejected |
| C: Shared TypeScript/Go schema package | Both | DRY types | Second model too early, incompatible until versioned | Deferred — documented mapping |

## Ownership of scene state
- **UI reducer** (`src/workspace.ts`) owns authoritative scene, history, `revision`.
- **Backend** owns *proposal derivation*: it validates client snapshot, calls provider, validates provider JSON, returns `proposal` or `clarification`. It never stores or mutates the scene.
- **Future approval path** (out of scope): UI revalidates `sceneRevision` + `beforeMm` against current `state.revision` before dispatching `resize`; backend `sceneRevision` is echoed verbatim.

## Technology choices
- **Go + Chi**: requested; Chi gives lightweight routing, middleware, context timeouts without framework lock-in.
- **Baseten Muse Spark Open** via OpenAI-compatible `POST {baseURL}/v1/chat/completions`. Provider is the long-term risk; isolated behind `Provider` interface so tests use a fake without network.
- **Structured output**: Meta's hosted API documents `response_format: {type:"json_schema"}` with constrained decoding. Baseten's hosted docs confirm OpenAI-compatible endpoint (`https://inference.baseten.co/v1`, model `meta-models/muse-spark-open`) but do not publish Baseten-specific `response_format` support. Local runtimes (vLLM/TensorRT-LLM) document `response_format` + `xgrammar` guided decoding. Since Baseten support is unverified, backend requests a tightly specified JSON (`response_format: {"type":"json_object"}` when accepted, otherwise plain JSON instruction) and **strictly validates** on server regardless. Documented limitation below.

## Request / Response contract

Reuse existing `SceneObject` shape from `src/workspace.ts` to avoid a second model.

### POST /api/ai/propose-edit
Headers:
- `Content-Type: application/json`
- `Authorization: Bearer <RENOVACAD_API_TOKEN>` — required only if service configured with a token (future Electron per-launch token). Loopback-only binding is the first control.

Size limits: request body ≤ 256 KiB; provider response body ≤ 64 KiB.

Request JSON:
```json
{
  "instruction": "Make this cabinet 6 inches wider",
  "selectedObjectId": "base-01",
  "sceneRevision": 0,
  "scene": {
    "objects": [
      {
        "id": "base-01",
        "kind": "base-cabinet",
        "name": "Base cabinet",
        "dimensionsMm": {"width": 914.4, "height": 876.3, "depth": 609.6},
        "rotationDegrees": 0,
        "positionMm": {"x": -650, "y": 0, "z": -300}
      }
    ]
  }
}
```
Validation (trust boundary):
- `instruction`: 1–2000 chars, trimmed, non-empty.
- `selectedObjectId`: 1–128 chars, must exist in `scene.objects`.
- `scene.objects`: 1–50 items, each with required fields and finite numbers; dimensions in (0,10000], positions within ±10000.
- `selectedObject` kind must be a cabinet: `base-cabinet | wall-cabinet | tall-cabinet` (other kinds → 400 invalid_request).
- `sceneRevision` integer ≥0, echoed but not interpreted.
- Only `width` resize is supported; any other operation from model is rejected.

Success 200 — proposal:
```json
{
  "kind": "proposal",
  "proposal": {
    "objectId": "base-01",
    "objectName": "Base cabinet",
    "operation": "resize",
    "dimension": "width",
    "beforeMm": 914.4,
    "afterMm": 1066.8,
    "explanation": "Increased width by 6 inches (152.4 mm) from 36.00 in to 42.00 in.",
    "sceneRevision": 0
  }
}
```
Success 200 — clarification:
```json
{
  "kind": "clarification",
  "message": "How much wider should the cabinet be? Example: 'Make it 6 inches wider'.",
  "sceneRevision": 0
}
```

Error envelope (consistent):
```json
{"error": {"code": "invalid_request", "message": "instruction is required"}}
```
Codes:
- `invalid_request` → 400
- `invalid_provider_response` → 502 (malformed/unsupported/out-of-range provider JSON)
- `provider_error` → 502
- `provider_timeout` → 504

### GET /health
```json
{"status":"ok","service":"renovacad-api","version":"0.1.0"}
```
No credentials or config echoed. No auth required so orchestrators can probe.

## Dimension & conversion rules
- Storage unit is millimeters (authoritative). UI converts inches↔mm at boundary.
- Backend validates target width: finite, 25.4 ≤ afterMm ≤ 10000, rounded to 0.001 mm.
- Example: 36 in = 914.4 mm, +6 in = 152.4 mm → 1066.8 mm.
- Model is instructed to return absolute target (`afterMm`), not delta. Server recomputes `beforeMm` from snapshot and rejects mismatched objectId or dimension.

## Provider interaction
System prompt instructs model to return exactly one JSON object with either:
- `{"kind":"proposal","objectId":"...","afterMm":1066.8,"explanation":"..."}`
- `{"kind":"clarification","message":"..."}`
No tool calls, no code, no URLs. `temperature` low (0.2), `max_tokens` bounded. Request uses `context.WithTimeout` (default 12s). No automatic retry of billable calls; caller retries explicitly.

If Baseten later documents `response_format: {type:"json_schema", json_schema:{...}}` support, swap `json_object` for the schema below without changing validation:
```json
{"type":"json_schema","json_schema":{"name":"resize_proposal","strict":true,"schema":{...}}}
```
Until verified, treat `json_object` as hint only and keep strict server validation.

## Local access controls (implemented)
- Default bind: `127.0.0.1:8787` (loopback). Override via `RENOVACAD_API_ADDR`; Electron uses an ephemeral `127.0.0.1:<port>` to avoid conflicts.
- If `RENOVACAD_API_TOKEN` is set, require `Authorization: Bearer <token>` or `X-RenovaCAD-Token` / `X-API-Token` on every `/api/*` request; `/health` remains unauthenticated but still loopback-bound. Missing/invalid token → 401.
- **Electron integration (this milestone)**: `electron/main.ts` generates a per-launch 32-byte `base64url` token, picks an ephemeral loopback port with `net.createServer`, spawns Go as a child with `RENOVACAD_API_TOKEN` + `RENOVACAD_API_ADDR`, loads `services/api/.env` first (so `BASETEN_API_KEY` in the file works), polls `/health` for ~8 s, and cleans up on quit (`SIGTERM` → `SIGKILL`). `electron/preload.ts` exposes a narrow `window.renovacadApi` with `proposeEdit(payload)` + `getStatus()` via `contextBridge`; the renderer never sees `BASETEN_API_KEY` or the per-launch token — `main.ts` attaches the token when forwarding the single allowed `POST /api/ai/propose-edit` to loopback. Loopback-only binding is the first control; token is the second; another local process without the token cannot propose edits.
- `dev:web` (browser-only `vite --config vite.web.config.ts`) has no preload bridge; the assistant detects `!window.renovacadApi` and shows an honest "No AI service connected" preview instead of pretending to be live.
- Request contexts bounded: `ReadHeaderTimeout` 5s, `ReadTimeout` 10s, handler timeout 15s, provider timeout 12s.
- No mutation endpoint; proposals cannot change scene by themselves. Origin/host is loopback by construction since `main.ts` forwards via `fetch(http://127.0.0.1:…)` rather than exposing a CORS endpoint.

## Configuration
Env vars (non-secret defaults documented in `services/api/.env.example`):
- `BASETEN_API_KEY` — required for live provider (kept separate from `META_API_KEY`). Loaded from `services/api/.env` automatically if present (tiny parser in `internal/config/loadDotEnvIfPresent`) plus `export`; `export` wins. Never in `VITE_` vars. Example file contains a placeholder rejected by Baseten — replace with the hackathon key.
- `BASETEN_BASE_URL` — default `https://inference.baseten.co/v1`.
- `BASETEN_MODEL` — default `meta-models/muse-spark-open`.
- `RENOVACAD_API_ADDR` — default `127.0.0.1:8787`; Electron overrides with `127.0.0.1:<ephemeral>` to avoid conflicts.
- `RENOVACAD_API_TOKEN` — per-launch random when spawned by Electron; optional for manual `go run`.
- `RENOVACAD_PROVIDER_TIMEOUT` — default `12s`.

Secrets never logged, never committed, never sent to renderer. `health` never echoes config. `propose-edit` errors strip provider bodies (`truncate` + `provider_error` without raw body).

## Verification plan (this milestone)
- Fake provider + `httptest` covers: valid relative resize (6 in wider → 1066.8 mm), ambiguous input → clarification, wrong objectId, invalid dimensions, malformed provider JSON, provider 500, timeout, auth, health, size limits. `bun test` covers: valid AI proposal shown/applied via fake bridge, undo/redo after apply, cancel, stale after edit, clarification, provider errors, browser-bridge unavailable, stale-late ignored, secret non-exposure (`src/ai.test.tsx` 8 tests) plus `workspaceReducer` `ai-proposal` stale/before checks.
- `bun run build` + `tsc --noEmit` gate.
- Live Baseten call is opt-in, one request authorized for this milestone. With `BASETEN_API_KEY=b10_gXMffhfk.9q98G…` from `.env.example`, Baseten returned `{"error":"please check the api-key you provided"}` — placeholder is invalid; retry requires the real hackathon key in `services/api/.env`. No repeated billing; provider errors surface as `provider_error` without leaking the key.

## What shipped (this milestone)
- `internal/config/loadDotEnvIfPresent` so `services/api/.env` works without manual `export` (Go never auto-reads `.env`).
- `electron/preload.ts` + `electron/main.ts` per-launch token, ephemeral loopback, health poll, `ipcMain.handle('ai:propose-edit')` narrow forward, clean shutdown, `electron.vite.config.ts` preload build.
- `src/workspace.ts` `ai-proposal` action + `src/App.tsx` loading, proposal (unit-aware), stale detection (`revision` + `beforeMm`), Apply/Cancel, clarification, provider/service errors, late-response ignore, browser-only honest fallback, `src/vite-env.d.ts` bridge type, `src/styles.css` AI states.

## Open limitations
- Only `width` on cabinets; `height`/`depth` and other objects deferred.
- `response_format: json_object` is a hint — server validation rejects invalid output; `invalid_provider_response` path is 502.
- No persistence, no project storage, no photorealistic rendering. Packaging still needs a bundled `renovacad-api` binary (dev uses `go run`); signing/installer deferred. Native visual interaction was not verified in the sandboxed CI (build succeeded, `bun test` 106 pass, `go test` pass with `GOCACHE` workaround).
