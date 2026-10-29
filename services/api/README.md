# RenovaCAD API (Go)

Small Chi service that turns a natural-language cabinet resize request into a validated proposal. Stateless, no persistence, no scene mutation.

## Configure

Copy `services/api/.env.example` to `services/api/.env` (ignored) or export vars. The Go program **does** read `services/api/.env` automatically if it exists (no `godotenv` dep; a tiny parser checks `services/api/.env` and `.env` without overriding exported vars). The earlier assumption that Go ignores `.env` is now fixed — `BASETEN_API_KEY` in the file works for `go run ./cmd/server` as well as for Electron.

```sh
cp services/api/.env.example services/api/.env
# edit services/api/.env — set your hackathon BASETEN_API_KEY
export BASETEN_API_KEY="..."   # optional: exported vars win over file
# defaults below are already set; override only if needed
export BASETEN_BASE_URL="https://inference.baseten.co/v1"
export BASETEN_MODEL="meta-models/muse-spark-open"
export RENOVACAD_API_ADDR="127.0.0.1:8787"
export RENOVACAD_API_TOKEN=""   # optional; when set, clients must send it
```

`BASETEN_API_KEY` is separate from `META_API_KEY` (Muse Code). Never log or commit keys. The committed `services/api/.env.example` contains a placeholder key that Baseten rejects with `please check the api-key you provided` — replace it with the hackathon key from your instructions; do not paste keys into chat. `VITE_` vars are forbidden for secrets.

## Run

```sh
cd services/api
go run ./cmd/server
# or
go build -o /tmp/renovacad-api ./cmd/server && /tmp/renovacad-api
```

Health:
```sh
curl http://127.0.0.1:8787/health
```

## API

### `GET /health`
No auth. Returns `{"status":"ok","service":"renovacad-api","version":"0.1.0"}`. Never exposes secrets.

### `POST /api/ai/propose-edit` (also `/api/v1/ai/propose-edit`)
Loopback-only by default (`127.0.0.1:8787`). If `RENOVACAD_API_TOKEN` is set, send:

```
Authorization: Bearer <token>
# or
X-RenovaCAD-Token: <token>
```

Request body ≤ 256 KiB, JSON:

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

**Example requests**

Valid relative resize (36 in → 42 in):
```sh
curl -s http://127.0.0.1:8787/api/ai/propose-edit -H 'Content-Type: application/json' -d '{
  "instruction": "Make this cabinet 6 inches wider",
  "selectedObjectId": "base-01",
  "sceneRevision": 0,
  "scene": {"objects": [{"id":"base-01","kind":"base-cabinet","name":"Base cabinet","dimensionsMm":{"width":914.4,"height":876.3,"depth":609.6},"rotationDegrees":0,"positionMm":{"x":-650,"y":0,"z":-300}}]}
}' | jq
```

Ambiguous → clarification:
```sh
curl -s http://127.0.0.1:8787/api/ai/propose-edit -H 'Content-Type: application/json' -d '{
  "instruction": "Make it bigger",
  "selectedObjectId": "base-01",
  "sceneRevision": 0,
  "scene": {"objects": [{"id":"base-01","kind":"base-cabinet","name":"Base cabinet","dimensionsMm":{"width":914.4,"height":876.3,"depth":609.6},"rotationDegrees":0,"positionMm":{"x":-650,"y":0,"z":-300}}]}
}' | jq
```

Success — proposal (200):
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

Success — clarification (200):
```json
{
  "kind": "clarification",
  "message": "How much wider should the cabinet be? Example: 'Make it 6 inches wider'.",
  "sceneRevision": 0
}
```

Error envelope:
```json
{"error": {"code": "invalid_request", "message": "instruction is required"}}
```

| Code | HTTP | When |
|------|------|------|
| `invalid_request` | 400 | Bad fields, unsupported kind, out-of-range dims, too large body, unknown field |
| `unauthorized` | 401 | Missing/bad token when `RENOVACAD_API_TOKEN` set |
| `invalid_provider_response` | 502 | Provider JSON malformed, wrong objectId, out-of-range afterMm, no change |
| `provider_error` | 502 | Provider 5xx / network |
| `provider_timeout` | 504 | Provider exceeded `RENOVACAD_PROVIDER_TIMEOUT` |

**Stale-proposal note**: `sceneRevision` is echoed verbatim; the UI must revalidate `beforeMm` + `revision` against current `state.revision` before dispatching `apply-proposal` (mirrors `workspaceReducer` checks). The backend does not revalidate at apply time — proposals cannot mutate the scene.

## Baseten Muse Spark Open

- Base URL default `https://inference.baseten.co/v1`, model `meta-models/muse-spark-open` (per https://dev.meta.ai/docs/muse-spark-open/deploy).
- Both values configurable via `BASETEN_BASE_URL` / `BASETEN_MODEL`.
- Auth: `Authorization: Bearer $BASETEN_API_KEY` (server-side only).
- Structured output: Meta docs guarantee `response_format: json_schema` on hosted API, but Baseten OpenAI-compat support for that mode is not published. Service sends `response_format: {"type":"json_object"}` as a hint and **strictly validates** either way. See `docs/backend-design.md` for swap-in schema.
- Timeouts: handler 15s, provider `RENOVACAD_PROVIDER_TIMEOUT` default 12s, `ReadHeaderTimeout` 5s. No auto-retry of billable calls.
- Timeouts and provider failures surface as 502/504 with no raw provider body.

## Electron wiring (this milestone)

`electron/main.ts` now does the work described above:

- Generates a 32-byte per-launch `RENOVACAD_API_TOKEN` (`base64url`), picks an ephemeral `127.0.0.1:<port>` via `net.createServer({})`, and spawns the Go service as a child (`go run ./services/api/cmd/server` in dev; `Resources/renovacad-api` in a packaged build). `services/api/.env` is loaded first so `BASETEN_API_KEY` in the file works without manual `export`.
- Binds strictly to loopback; warns if `RENOVACAD_API_ADDR` is non-loopback without a token.
- Handles startup failures visibly: health is polled for ~8 s; if the Go process exits early or `health` never becomes 200, `ai:status` reports `error` and the renderer shows "AI service is not reachable."
- Cleans up on quit: `SIGTERM` then `SIGKILL` after 2 s. Port conflicts are avoided by ephemeral allocation; if a chosen port is taken between allocation and bind, the child exits with `bind: ...` and the error is surfaced.
- Preload `electron/preload.ts` exposes a **narrow** bridge: `window.renovacadApi.proposeEdit(payload)` and `getStatus()`. The renderer never sees `BASETEN_API_KEY` or the per-launch token — `main.ts` attaches `Authorization: Bearer <token>` when forwarding the single allowed `POST /api/ai/propose-edit` to `127.0.0.1`. Origin/host checks remain loopback-only; another local process without the token gets `401`.

In `dev:web` (browser-only `bun run dev:web`) the bridge is `undefined`; the assistant shows an honest preview message instead of pretending to be connected.

## Tests

```sh
cd services/api
GOCACHE=/tmp/go-cache GOMODCACHE=/tmp/go-mod go test ./...   # if default /Library/Caches is sandboxed
# or
go test ./...
```

Uses a fake provider (no network, no billing). Covers valid resize, ambiguous clarification, wrong objectId, invalid dims, malformed provider output, provider failures, timeout, auth, health, size limits. Live Baseten call is opt-in and never required for `go test`. One manual live Baseten request (with `BASETEN_API_KEY` from `services/api/.env`) was attempted for this milestone and returned `please check the api-key you provided` for the placeholder in `.env.example` — replace with the real hackathon key before retrying.

## Versioning
`/api/ai/propose-edit` is v0. `/api/v1/ai/propose-edit` is an alias for future versioning without breaking clients.
