# Development conventions

- Use Bun 1.3.8 for JavaScript/TypeScript dependencies, scripts, and package management. Keep `bun.lock` current. Do not introduce npm, Yarn, or pnpm lockfiles.
- Use the existing Conda environment `musedev` for all Python work and dependencies. For example: `conda run -n musedev python ...` and `conda run -n musedev python -m pip install ...`. Do not install Python packages into the base environment or create another environment for this project.
- This milestone is a React + Electron UI prototype. Keep AI, CAD, project storage, and services disconnected unless the user requests the next milestone.
- Store scene dimensions in millimeters and convert at the interface. Keep scene edits and undo/redo in the workspace reducer.
- Keep Electron's renderer isolated, sandboxed, and without Node integration. Add a narrow native bridge only when a requested feature needs one.
- Run `bun run build` after changing the application. Be candid about visual or native runtime checks that the environment prevents.
