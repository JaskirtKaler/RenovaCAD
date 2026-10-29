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
- Lower-left **axis indicator** — three arrows (X red, Y green, Z blue) with labels at the tips, derived from the same camera projection as the viewport. Arrows update as you orbit; when an axis points toward/away from you its projection is short and is shown as a dot (filled if toward you, ring if away). Works in perspective and orthographic views (X width right, Y height up, Z depth forward). The view cube remains a separate camera-navigation control.
- **Draft field provenance (move):** Dragging in X/Z (`M` or `move-to`) only marks changed axes as `user-entered` (e.g., `x`/`z` false, `y` stays `approximate`). `nudge`/`set-position`/`rotate`/`resize` similarly per-field; undo/redo preserves it.
- **Kitchen photo analysis:** Import a JPG/PNG/WEBP photo, then explicitly click **Analyze photo**. A consent notice explains the photo will be sent to Baseten (Muse Spark) — only the photo is sent, only when you click Analyze (not on import). Image type/size are validated (≤5 MB), errors/timeouts are shown, and the response is a concise, labeled description of visible kitchen features plus 2–4 follow-up questions about missing dimensions. It does **not** claim accurate measurements and does **not** automatically change the 3D scene. If the provider is unavailable, local editing and project saving remain usable; analyze shows an honest error. In browser preview the bridge is absent and analysis shows “not available in browser preview”.
- In **Move** (`M`), click to select then drag the selected cabinet or sink in the X/Z plane at its current height to place it beside another object. Edges snap when aligned (within ~40 mm); hold **Shift** to bypass, drag empty space to orbit. Y is unchanged — use inspector or PageUp/PageDown for height. Edge-on views disable drag with a prompt to switch views. One drag = one undo.
- In **Measure** (`R`), crosshair shows; click floor or object tops for points, see world-space distance in your units. **Back one point** removes last, **Clear** or **Esc** removes all. Measurement is a temporary viewport annotation — not saved with the project. **Annotate** remains coming next.
- **Room measurements (known dimensions):** Inspector → **Room Measurements** lets you enter Wall length and Wall/room height in your selected units (mm stored). Values are `user-entered` vs `approx` provenance, and **Confirm measurement** explicitly records *your* confirmation (not professional verification, not code compliance). Revising clears `confirmed` → `not confirmed`; **ordered undo/redo** (one history for scene + measurements) reverses only the most recent action (e.g., wall length then resize → Undo reverts resize only), redo restores in order, new edit after undo clears redo. Stored in `.renovacad` `roomMeasurements`, legacy files without it still load.
- **Draft review field editing:** Draft dimension/position/rotation fields keep text until blur/Enter (decimals, `-`, empty, `34.` typed naturally), validate on commit, show `Enter …` inline, Esc restores. Unit switch (in↔mm) only changes display, not stored mm. Editing preserves provenance (`edited — not verified` vs `approx`).
- **Lightweight wall placement (face + L-shaped):** Draft review → **Place Along Wall** — pick an existing `wall` object (0° X-wall or 90°/270° Z-wall, thickness `depth`) or `Room wall length`, choose **Face** front/back (shows `front (Z=152.4 mm, thickness 152 mm)`), see `Wall available vs draft needs`, **Arrange along wall** snaps widths sequentially **against the wall’s face** (no penetration; uses viewport’s `boxPoint` conventions), preserves height/provenance (only `x`/`z` + rotation for Z-walls marked `user-entered`). **L-shaped:** with 2+ walls, per-object dropdown assigns each draft object to a wall; each wall’s group placed along its length, corner not crossed without explicit choice, insufficient length or rotated (≠0°/90°) → clear *“only 0° or 90° walls supported”* without moving existing objects. Selected wall is highlighted in viewport (blue outline + label). Overlap hint uses X/Z *and* Y (upper above base not reported), touching edges not reported; rotated limitation noted. **Wall height:** entered wall height (approx/user-entered, confirmed/not confirmed) warns if any object’s top (`y+height`) exceeds it — e.g., `“Base” top 2500 mm exceeds wall height 2438 mm (user-entered not confirmed) — not resized`.

The kitchen uses a local 3D model of rectangular objects projected into SVG. Dimensions, positions, and rotation affect the geometry. New objects receive a stored position and trigger a fit once. Deleting another object never rearranges survivors. The floor grid has fixed 12-inch tiles across the work area, with stronger major lines. Move mode adds a faint vertical guide and height reference plus drag snapping guides. The viewport grid toggle controls both grid planes. This preview does not include a CAD engine or full collision enforcement; snapping for rotated objects is currently unsupported and shown honestly. The axis indicator and measurement overlay avoid obscuring controls and selected objects.

Object creation lives in the toolbar's **Objects** catalog. Camera orientation lives in the view cube and the lower-left axis indicator. Zoom percentage is a readout, and the viewport has the single grid toggle. The header keeps **one** primary **Save** button; **Save As** is available with a clear label in **Workspace settings** (and via Save when there is no current file) — no duplicate save icons in the header.

Projects are saved as a single portable `.renovacad` file (JSON) with embedded reference photo — no folder or database. See [Project format](#project-format) below. Uploaded photos are viewed locally and saved with the project; they are only sent to Baseten when you explicitly click **Analyze photo** in the Photo view. AI Render has a placeholder for the future integration. When `BASETEN_API_KEY` is missing or the service is unreachable, the assistant and photo analysis report the error honestly — the badge shows **LOCAL** (not **LIVE**) until a provider call succeeds, and local editing and project saving remain usable.

Limitations in this milestone: only `width` on `base-cabinet` / `wall-cabinet` / `tall-cabinet`; Baseten `response_format: json_object` is treated as a hint — server-side validation rejects malformed model output; live Baseten calls are opt-in and sandboxed Go tests use a fake provider (run `GOCACHE=/tmp/go-cache GOMODCACHE=/tmp/go-mod go test ./...` from `services/api` if the default cache is sandboxed). Overlap check is X/Z + Y for axis-aligned boxes only (rotated → limitation noted, not full collision). Wall placement is X- or Z-wall (0°/90°/270°) with width-snap against thickness, L-shaped via per-object wall assignment, height check against entered wall height; other angles/complex layouts → manual placement with clear message. Photorealistic rendering remains a future milestone.

### Project format

RenovaCAD saves a single portable project file (`.renovacad`) — a versioned JSON document suitable for the current demo image sizes and easy to email or move. A project folder was considered but would add file-system complexity and broken-reference risks for one embedded image; a single file keeps the demo reliable and matches the “save to a location you choose” flow. If image sizes grow past a few megabytes, a folder with sidecar assets could be revisited.

**What is saved:** project format version and project name, all scene objects (IDs, kinds, dimensions in millimeters, positions, rotations), selected object, user settings (units, grid visibility), camera state (yaw/pitch/projection/zoom), view mode, and the reference photo as an embedded `data:` URL with its original filename and MIME type — no temporary `blob:` URL dependency, so reopening works without the original file.

**What is not saved:** API keys, service tokens, pending AI proposals, transient errors, in-flight requests, or undo/redo history. Selection is restored if the object still exists, otherwise the first object is selected. Undo history is reset on open (a new edit branch starts from the opened state) and pending proposals are cleared — reopening never allows an old proposal to be applied to the new scene. An approved AI resize persists as a normal scene edit.

**Validation and limits:** opening validates version, JSON shape, required fields, numeric ranges (dimensions 25.4–10000 mm, positions ±10000, rotation ±360°, zoom 0.5–2, pitch ±π), and photo MIME/size. Unsupported versions, malformed files, invalid values, or missing/invalid assets are rejected with a message and the current scene is left intact. Practical limits: project file ≤ 12 MB, reference photo ≤ 5 MB decoded (≈ 6.7 MB base64), ≤ 50 objects. Electron saves atomically via temp-file + rename so a partially written file never replaces the last good project (on failure the previous file is preserved; atomic rename is best-effort on non-POSIX filesystems).

**Saving in Electron vs. browser:** In Electron (`bun run dev`), New / Open / Save / Save As use native dialogs through a narrow preload bridge (`window.renovacadProject`) and the main process does all file I/O — the renderer has no arbitrary filesystem access. Canceling a dialog leaves the current project intact. If there are unsaved changes, creating a new project, opening another file, or quitting warns via a native Save/Discard/Cancel dialog and respects the choice. Save status is shown in the header and footer (Saved / Unsaved / Saving / Error with actionable text). In browser-only `bun run dev:web`, the bridge is absent; Save/Open show an honest “not available in browser preview — run in Electron” message and the workspace remains in memory only.

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
electron/main.ts                 Window, Go lifecycle, per-launch token, IPC + project bridges, safe atomic save
electron/preload.ts              Narrow contextBridge (window.renovacadApi + window.renovacadProject)
src/App.tsx                     Workspace + AI assistant + project lifecycle (New/Open/Save/Save As, dirty, quit guard, photo dataUrl)
src/workspace.ts                Scene model, proposals, undo/redo (includes ai-proposal + load)
src/project.ts                  Project format, validation, limits, serialize/parse
src/ai.test.tsx                 Focused AI flow tests (apply/undo/redo, stale, clarification, errors, bridge, stale-late, secret)
src/project.test.ts             Project round-trip, validation, limits, no transient leakage
src/viewport.ts                 Camera, projection, and box geometry
src/components/KitchenPreview.tsx Interactive kitchen preview
src/components/ViewCube.tsx     Camera preset controls
src/styles.css                  Layout, components, and AI states
docs/ui-architecture.md          State ownership and design decisions (includes project ownership)
docs/backend-design.md           Go service design + Electron wiring for this milestone
services/api/                   Go Chi service (loopback + token + Baseten)
```

The renderer remains isolated, sandboxed, and without Node integration. `electron/preload.ts` exposes a narrow bridge (`proposeEdit`, `getStatus`) — no filesystem, process, or unrestricted HTTP. The Go service binds to `127.0.0.1` with a per-launch token attached by the main process; the renderer never sees `BASETEN_API_KEY` or the loopback token. The window follows [Electron's context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation), and the desktop build uses [electron-vite](https://electron-vite.org/guide/). See `services/api/README.md` for the request contract and `docs/backend-design.md` for the threat model vs. local attackers.

The supplied [MVP plan](docs/mvp-plan.md) and [UI reference](docs/ui-reference.png) are preserved for the next milestones.
