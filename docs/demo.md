# Demo — Photo-to-Layout (Repeatable without Live Baseten)

This demo uses a **small, clearly labeled example kitchen** and a **fake provider / offline fixture** so every run succeeds without a live Baseten call. The example file and fixture results are **explicitly marked as not a live AI response**.

## Example file

`examples/demo-kitchen.renovacad` — open in Electron.

* **Base scene:** 3 manual cabinets + 2 walls forming an L-shape (`Kitchen wall A` along X, `Kitchen wall B` along Z, 120 in × 96 in each) without confidence badges for legacy objects; `Demo Base (approx)` and `Demo Wall (edited)` show `approx` / `edited — not verified` provenance. Walls share a corner at (1524, -400) — viewport highlights the selected placement wall in blue.
* **Room measurements:** `Wall length 120 in — confirmed` (user-entered, Confirmed), `Wall/room height 96 in — not confirmed` (96 in confirmed = 2438 mm). Inspector shows `user-entered` vs `approx` and `confirmed` vs `not confirmed`; confirming records your confirmation — not professional verification (revising clears). Wall height is used to warn if any object’s top exceeds it.
* **Reference photo:** tiny embedded PNG so save/reopen can be verified.

Open, edit, undo, save, reopen — confidence, photo, and room measurements persist.

## Procedure (3–4 min, no live provider required)

1. **Start:** `bun run dev` (Electron) or `bun run dev:web` (browser preview — Save/Open show honest “not available in browser preview”).
2. **Open example:** File → Open → `examples/demo-kitchen.renovacad`. Confirm 6 objects (including wall), photo visible in Photo tab, and **Room Measurements** shows `Wall length 120 in — confirmed`, `Wall/room height 96 in — not confirmed`. Inspector shows *approx* / *edited — not verified* badges for demo objects.
3. **Room measurements (known dimensions):** In **Room Measurements**, try editing Wall length to `122` in, blur, see `user-entered not confirmed` (revising cleared confirmed) and unit switching (in ↔ mm) keeps stored mm (122 in ↔ 3098.8 mm). Click **Confirm measurement**, see `confirmed`. This records your confirmation, not professional verification. Undo/redo reverts the measurement.
4. **Offline draft fixture (no provider):** In **Photo** tab, click **Load demo draft (offline fixture)** — clearly labeled *“Demo fixture — not a live AI response”*. No photo is sent. The draft shows *“Demo draft — offline fixture. Approximate positions…”* with `approx` badges. This is **not** a live Baseten response — the app never claims it is. You can also still use **Create draft layout** with a real photo when the local service is running.
5. **Correct measurements (field editing):** In draft review, try typing `"-"`, `"34."`, empty, verify the field keeps text until blur/Enter, flags invalid with `Enter …`, Esc restores. Change one Width from 36 to 40 in, blur, confirm badge flips to *edited — not verified*.
6. **Wall placement assistance (thickness + face):** In draft review, choose **Wall → Kitchen wall A — 120 in** (or Room wall length), pick **Face → Front face** (shows `front (Z=-247.6 mm, thickness 152 mm)` vs `back`), see `Wall available: 120 in — draft needs: 102 in — snap adjacent, 18 in spare` and which side will receive objects (against thickness, no penetration). Click **Arrange along wall** — objects snap adjacent **against the wall’s face** (front at `Z = wallZ + thickness`, back at `Z = wallZ - depth`), preserving height and manual adjust. For **L-shaped** (2 walls detected), assign each draft object to a wall via per-object dropdown — e.g., Base + Sink to Wall A, Tall to Wall B — then Arrange places each group along its wall without crossing the corner without your choice. Try setting Wall length to `60` in (insufficient) and Arrange — see *“Objects need 102 in but wall is only 60 in…”*. Try rotating a wall to 45° (unsupported) and Arrange — see *“only 0° or 90° walls supported”*. Try overlapping: two draft objects at same X/Z/Y will show *“Heads up — possible overlap (simple footprint check, not full collision)”* with **vertical separation considered** (upper at 1480 above base at 0 not reported). Touching edges not reported. **Wall height:** if any object’s top (`y+height`) exceeds entered wall height (e.g., tall 2500 mm > 2438 mm), see *“exceeds wall height … (user-entered not confirmed) — not resized”* (your confirmation, not code compliance).
7. **Apply as one undoable step:** Click **Apply draft — add 3 objects**. Confirm scene count 6 → 9 and new objects have provenance (`approx` etc.). Undo (⌘Z) reverts to 6, Redo to 9. Stale-draft guard: while a draft is open, change Wall length or resize a cabinet, then try Apply — expect *“Scene changed since draft was created — please regenerate”* and draft stays visible.
8. **Save and reopen:** Save (⌘S), close, reopen — confirm objects, dimensions, photo, **roomMeasurements**, and **approximateFields** are intact. Legacy files without those fields still open (compatibility).
9. **Save robustness (tested):** Overlapping saves and project-switch-while-saving are covered by generation-epoch tests — old saves never overwrite the new project’s path or dirty flag.

## What is not live AI

* The example’s draft objects and the fake provider’s canned response are **labeled “FAKE / DEMO”** — never *“LIVE”*. Live Baseten is only attempted when `BASETEN_API_KEY` is configured and `services/api` is running; the UI shows `LIVE` vs `LOCAL` in the assistant badge and explains *“Local bridge ready — provider not yet verified”* otherwise.
* Photo-to-layout never claims verified construction measurements; all photo-derived dimensions are forced `isApproximate: true` in `services/api/internal/layout/service.go` even if the model returns `false`, and warnings always include *“Approximate”*.

## Provider diagnostics (local, no secrets)

* Missing `BASETEN_API_KEY` → `service_unavailable: AI service is unavailable — not configured. Check BASETEN_API_KEY…` (503)
* Rejected credentials → `unauthorized: AI provider rejected credentials…` (401)
* Unavailable model → `model_unavailable` (403) / `model_not_found` (404)
* Rate limit → `rate_limited` (429)
* Timeout → `provider_timeout` (504/504) — client uses `AbortSignal.timeout` and context deadline
* Malformed output → `invalid_provider_response` (502) — truncated, never logs raw photo or key

All are exercised with `Fake` and local test servers; raw provider bodies are truncated to ≤500 chars and never log the photo data URL or `Authorization` header.

## If you want a live check (optional, not required for demo)

Follow `AGENTS.md`: configure `services/api/.env` from `.env.example` with a real `BASETEN_API_KEY`, start `bun run dev`, import a real JPG/PNG/WEBP (≤5 MB), click **Create draft layout**, and observe the same review flow. Do not assume the previous generic `provider_error` was any single cause — check `BASETEN_BASE_URL`, `BASETEN_MODEL`, and network first. If live is unavailable, the demo above remains the handoff.
