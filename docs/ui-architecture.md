# UI prototype architecture

## Problem

Build the referenced three-panel desktop workspace before connecting CAD, AI, or project storage. Manual changes and the sample proposal must agree about selected dimensions and undo.

## Usage

Run `bun install`, then `bun run dev`. Use `bun run dev:web` for the renderer in a browser. `App` calls `useWorkspace()` and gives controlled views the selected object and intent callbacks. For example, a width field dispatches `{ kind: 'resize', dimension: 'width', valueMm }`; the sample approval dispatches `{ kind: 'apply-proposal' }`.

## Shape

- `electron/main.ts` owns window lifecycle, with an isolated renderer and no native bridge.
- `src/workspace.ts` owns scene objects, selection, scene history, and sample proposals. Millimeters are authoritative; display values convert at the UI boundary.
- `src/App.tsx` composes the inspector, viewport, and assistant. It owns the camera, zoom, panel visibility, and other presentation state outside scene history.
- `src/viewport.ts` owns camera presets, orbit limits, perspective and orthographic projection, object placement, and box geometry. It uses millimeters, with X for width, Y for height, and Z for depth toward the front. Rotation turns each object around its vertical center.
- `src/components/KitchenPreview.tsx` projects the scene into SVG. It sorts visible faces by depth and renders selection and dimension labels. Pointer handlers distinguish a click from a drag before selecting or orbiting. Wheel zoom uses a non-passive listener so the page stays still.
- `src/components/ViewCube.tsx` provides clickable cube faces and a dropdown for six camera views. It requests camera changes from App and never edits scene objects.
- `src/styles.css` owns layout and visual tokens.

Every committed scene edit records a snapshot and invalidates pending proposals. Approval checks its scene revision and original target width. Selection, tabs, camera movements, projection, and panel visibility never consume undo. Numeric fields commit on blur or Enter and revert on Escape.

## Synthesis decision

The scene reducer provides one path for manual edits and approved sample changes. Controlled UI components read the same scene rather than keeping copies of dimensions. The local camera uses the existing scene model and requires no service, native bridge, or CAD engine.

## Tradeoffs and alternatives

We accept scene snapshots for a small memory-only prototype in exchange for straightforward undo. SVG projection gives the UI camera controls without adding a graphics engine. Its box geometry and depth sorting remain a preview; a future CAD renderer can replace KitchenPreview while keeping scene state and camera controls separate. Panel-owned scene state would duplicate dimensions, and a global store adds no useful capability yet.

## Implementation reconciliation

The reducer owns only scene state, selection, history, and proposals. Tabs, settings, notices, reference-photo URLs, camera, zoom, and panel visibility remain presentation state. Export, native persistence, object placement tools, and live AI are future milestones.

Numeric edits normalize to 0.001 mm and ignore unchanged display values, preserving proposals and redo after a field is focused and blurred. The sample resize cannot create an empty change at the maximum width. Clicks and tool shortcuts share one handler. Tabs use arrow keys, Home, and End. Text entry, native selects, and composition input do not trigger design shortcuts.

Focus mode hides both side panels while preserving their individual visibility preferences. The hidden panels retain their state. Fit resets zoom at the current angle; Reset camera also restores the initial isometric perspective. The camera fits projected bounds whenever geometry changes, so additions remain part of the preview.
