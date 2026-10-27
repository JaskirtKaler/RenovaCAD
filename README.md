# RenovaCAD

A macOS kitchen-design workspace built with React, TypeScript, Electron, and Vite. This first milestone establishes the interface from the supplied design reference.

## Start

Use **Bun 1.3.8** for all JavaScript dependencies and scripts:

```sh
bun install
bun run dev
```

`dev` opens the Electron app and reloads the UI while you edit it. The initial scene contains a base cabinet, a wall cabinet, and a tall cabinet.

To run just the React interface in a browser:

```sh
bun run dev:web
```

Use the local address printed by Vite. For a production build and desktop preview:

```sh
bun run build
bun run preview
```

The build creates `out/main` and `out/renderer`. A distributable macOS app, signing, and an installer are not part of this milestone.

Run the local editing, camera, and component interaction checks with `bun test`. `bun run build` also checks all TypeScript sources. Component tests use an in-memory React tree. They do not verify browser layout, native file dialogs, image decoding, or real pointer gestures.

## What works locally

- Three-panel inspector, design workspace, and assistant layout.
- Select cabinets from the illustration or object list.
- Change width, height, depth, and rotation in the inspector. Numeric fields commit on Enter or blur; Escape restores the previous value.
- Add cabinets, walls, and sinks; delete the selection; undo and redo scene edits.
- Review, approve, or cancel a clearly labeled sample resize proposal.
- Import a JPG, PNG, or WEBP reference photo and switch between Photo, 3D CAD, and AI Render views.
- Adjust preview zoom, grid visibility, and display units.
- Click the view cube's Top, Front, and Right faces. Use its dropdown for Back, Left, and Isometric views.
- Drag the kitchen preview to orbit, use the orbit arrow buttons, or scroll to zoom. Switch between Perspective and Orthographic projection.
- Use **Fit preview** to reset zoom while keeping the current angle. Use **Reset camera** to restore the initial perspective and zoom.
- Hide either side panel or use **Focus viewport** to give the kitchen the full workspace width. Exit focus mode with its button or Escape.
- Keyboard shortcuts: `V` select, `M` move, `R` measure, `O` objects, `A` annotate, `⌘Z` undo, `⇧⌘Z` redo, and Delete/Backspace to delete a selected object. On non-Mac platforms, Ctrl replaces ⌘ for undo and redo.

The kitchen uses a local 3D model of rectangular objects projected into SVG. Dimensions and object rotation affect the geometry. All added objects appear at their actual relative sizes, and the camera fits the scene. This preview does not include a CAD engine. Move, measure, and annotation tools show their selected state and explain that editor behavior comes next.

There are **no connected AI services, backend, credentials, or project storage**. Assistant input gives honest preview feedback. The Save control explains that saving is a later milestone. Scene edits, settings, and imported photos stay in memory and reset when the app reloads. Uploaded photos are viewed locally and are not sent anywhere. AI Render has a placeholder for the future integration.

## Python

No Python packages are needed for this UI. For future Python work, use the existing **`musedev` Conda environment**:

```sh
conda run -n musedev python your_script.py
conda run -n musedev python -m pip install package_name
```

## Structure

```text
electron/main.ts                 Desktop window and lifecycle
src/App.tsx                     Workspace interface and presentation state
src/workspace.ts                Scene model, sample proposal, undo/redo
src/viewport.ts                 Camera, projection, and box geometry
src/components/KitchenPreview.tsx Interactive kitchen preview
src/components/ViewCube.tsx     Camera preset controls
src/styles.css                  Layout, components, and visual tokens
docs/ui-architecture.md          State ownership and design decisions
```

The renderer has no native filesystem or Node access. The window follows [Electron's context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation), and the desktop build uses [electron-vite](https://electron-vite.org/guide/).

The supplied [MVP plan](docs/mvp-plan.md) and [UI reference](docs/ui-reference.png) are preserved for the next milestones.
