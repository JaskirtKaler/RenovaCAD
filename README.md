# RenovaCAD

A macOS kitchen-design workspace built with React, TypeScript, Electron, and Vite. This first milestone establishes the interface from the supplied design reference.

## Start

Use **Bun 1.3.8** for all JavaScript dependencies and scripts:

```sh
bun install
bun run dev
```

`dev` starts Electron **and** the local AI service (Go) together. Electron's main process spawns `go run ./services/api/cmd/server` on an ephemeral `127.0.0.1` port with a per-launch random `RENOVACAD_API_TOKEN`; the renderer talks to Go only through the isolated preload bridge (`window.renovacadApi`). If Go fails to start (missing `BASETEN_API_KEY`, port conflict, or `go` not on PATH), the assistant shows the error instead of pretending to be connected.

The initial scene contains a base cabinet, a wall cabinet, and a tall cabinet.

To run just the React interface in a browser (no Electron, no Go):

```sh
bun run dev:web
```

Use the local address printed by Vite. In `dev:web` the bridge is unavailable; the assistant shows an honest "No AI service connected" preview and the sample proposal still works.

For a production build and desktop preview:

```sh
bun run build
bun run preview
```

The build creates `out/main`, `out/preload`, and `out/renderer`. A distributable macOS app, signing, and an installer are not part of this milestone — see `docs/backend-design.md` for the packaging TODO (bundle a `renovacad-api` binary at `Resources/renovacad-api`).

Run the local editing, camera, and component interaction checks with `bun test`. `bun run build` also checks all TypeScript sources. Component tests use an in-memory React tree. They do not verify browser layout, native file dialogs, image decoding, or real pointer gestures.

### AI service setup (Baseten Muse Spark Open)

1. Copy `services/api/.env.example` to `services/api/.env` (ignored) or export in your shell:
   ```sh
   export BASETEN_API_KEY="..."   # hackathon key — separate from META_API_KEY
   export BASETEN_BASE_URL="https://inference.baseten.co/v1"   # default
   export BASETEN_MODEL="meta-models/muse-spark-open"          # default
   ```
   The Go service now reads `services/api/.env` automatically if you use the copy; you may also export `BASETEN_API_KEY` directly — exported vars win over the file. Never put `BASETEN_API_KEY` in a `VITE_` var or commit it.

2. Start the Go service alone (optional):
   ```sh
   cd services/api
   GOCACHE=/tmp/go-cache GOMODCACHE=/tmp/go-mod go run ./cmd/server
   # or with custom addr/token:
   RENOVACAD_API_ADDR=127.0.0.1:8787 RENOVACAD_API_TOKEN=secret go run ./cmd/server
   curl http://127.0.0.1:8787/health
   ```
   The service binds to loopback by default; if `RENOVACAD_API_TOKEN` is set, every `/api/*` request must carry `Authorization: Bearer <token>` (Electron does this via IPC, not the renderer).

3. Verify the cabinet-width flow:
   ```sh
   curl -s http://127.0.0.1:8787/api/ai/propose-edit -H 'Content-Type: application/json' -d '{
     "instruction": "Make this cabinet 6 inches wider",
     "selectedObjectId": "base-01",
     "sceneRevision": 0,
     "scene": {"objects": [{"id":"base-01","kind":"base-cabinet","name":"Base cabinet","dimensionsMm":{"width":914.4,"height":876.3,"depth":609.6},"rotationDegrees":0,"positionMm":{"x":-650,"y":0,"z":-300}}]}
   }' | jq
   ```
   Expected proposal: `afterMm` = 1066.8 (36 in → 42 in). Ambiguous input returns `kind: "clarification"`.

   One live Baseten request is enough to verify — do not auto-retry billable calls. If the key is rejected, the service returns `provider_error` without leaking the key.

## What works locally

- Three-panel inspector, design workspace, and assistant layout.
- Select cabinets from the illustration or object list.
- Change width, height, depth, and rotation in the inspector. Numeric fields commit on Enter or blur; Escape restores the previous value.
- Add cabinets, walls, and sinks; delete the selection; undo and redo scene edits.
- AI assistant: select a cabinet, type "Make this cabinet 6 inches wider", see a loading state, review before/after widths in your chosen units, then **Apply** (one undoable edit) or **Cancel**. Stale proposals (scene changed while pending) are flagged — request a new one. Ambiguous input shows the backend's clarification; provider, timeout, or service-unavailable errors are shown without changing the design. Sample resize still works as a fallback.
- Import a JPG, PNG, or WEBP reference photo and switch between Photo, 3D CAD, and AI Render views.
- Adjust preview zoom, grid visibility, and display units.
- Use the inspector's Position controls to move one 12-inch tile along X or Z, or raise and lower an object along Y. Negative Y is below the floor reference. Each step can be undone.
- Press `M` to use arrow keys for X/Z movement and Page Up or Page Down for height. Position readouts use your selected measurement units.
- Click the view cube's faces, edges, and corners. Its **All views** picker exposes six face views, twelve edge views, and eight corner views, including Bottom and eye-level diagonals.
- Drag the kitchen preview to orbit or scroll to zoom. Switch between Perspective and Orthographic projection.
- Use **Fit preview** to fit the current objects and reset zoom while keeping the angle. Use **Home view** to also restore the initial perspective. Moving, rotating, or resizing an object keeps the camera frame stationary until you fit it again.
- Hide either side panel or use **Focus viewport** to give the kitchen the full workspace width. Exit focus mode with its button or Escape.
- Keyboard shortcuts: `V` select, `M` move, `R` measure, `O` objects, `A` annotate, `⌘Z` undo, `⇧⌘Z` redo, and Delete/Backspace to delete a selected object. On non-Mac platforms, Ctrl replaces ⌘ for undo and redo.

The kitchen uses a local 3D model of rectangular objects projected into SVG. Dimensions, positions, and rotation affect the geometry. New objects receive a stored position and trigger a fit once. Deleting another object never rearranges survivors. The floor grid has fixed 12-inch tiles across the work area, with stronger major lines. Move mode adds a faint vertical guide and height reference. The viewport grid toggle controls both grid planes. This preview does not include a CAD engine or collision enforcement. Measure and annotation tools explain that their editor behavior comes next.

Object creation lives in the toolbar's **Objects** catalog. Camera orientation lives in the view cube. Zoom percentage is a readout, and the viewport has the single grid toggle.

The AI service has **no connected project storage and no photorealistic rendering** — those remain future milestones. The `POST /api/ai/propose-edit` endpoint only supports absolute cabinet width resize; `height`/`depth` and other objects are rejected. The Save control explains that saving is a later milestone. Scene edits, settings, and imported photos stay in memory and reset when the app reloads. Uploaded photos are viewed locally and are not sent anywhere. AI Render has a placeholder for the future integration. When `BASETEN_API_KEY` is missing or the service is unreachable, the assistant reports the error honestly.

Limitations in this milestone: only `width` on `base-cabinet` / `wall-cabinet` / `tall-cabinet`; Baseten `response_format: json_object` is treated as a hint — server-side validation rejects malformed model output; live Baseten calls are opt-in and sandboxed `Go` tests use a fake provider (run `GOCACHE=/tmp/go-cache GOMODCACHE=/tmp/go-mod go test ./...` from `services/api` if the default cache is sandboxed).

## Python

No Python packages are needed for this UI. For future Python work, use the existing **`musedev` Conda environment**:

```sh
conda run -n musedev python your_script.py
conda run -n musedev python -m pip install package_name
```

## Muse coding agent

The project includes a separate Muse Code development launcher and a local engineering playbook. Add your API key as `META_API_KEY` in the ignored root `.env`, then run `bun run muse:check` and `bun run muse`. The launcher uses Bun 1.3.8, checks the existing `musedev` Conda environment, and fixes Muse's workspace and human approval settings. See [the Muse setup guide](docs/muse-agent.md) for installation, scope controls, and verification.

The application assistant remains a disconnected UI prototype. No API credentials are exposed to its renderer.

## Structure

```text
electron/main.ts                 Window, Go lifecycle, per-launch token, IPC bridge
electron/preload.ts              Narrow contextBridge (window.renovacadApi)
src/App.tsx                     Workspace + AI assistant (loading, proposal, stale, clarification, errors)
src/workspace.ts                Scene model, proposals, undo/redo (includes ai-proposal)
src/ai.test.tsx                 Focused AI flow tests (apply/undo/redo, stale, clarification, errors, bridge, stale-late, secret)
src/viewport.ts                 Camera, projection, and box geometry
src/components/KitchenPreview.tsx Interactive kitchen preview
src/components/ViewCube.tsx     Camera preset controls
src/styles.css                  Layout, components, and AI states
docs/ui-architecture.md          State ownership and design decisions
docs/backend-design.md           Go service design + Electron wiring for this milestone
services/api/                   Go Chi service (loopback + token + Baseten)
```

The renderer remains isolated, sandboxed, and without Node integration. `electron/preload.ts` exposes a narrow bridge (`proposeEdit`, `getStatus`) — no filesystem, process, or unrestricted HTTP. The Go service binds to `127.0.0.1` with a per-launch token attached by the main process; the renderer never sees `BASETEN_API_KEY` or the loopback token. The window follows [Electron's context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation), and the desktop build uses [electron-vite](https://electron-vite.org/guide/). See `services/api/README.md` for the request contract and `docs/backend-design.md` for the threat model vs. local attackers.

The supplied [MVP plan](docs/mvp-plan.md) and [UI reference](docs/ui-reference.png) are preserved for the next milestones.
