# Development conventions

- Use Bun 1.3.8 for JavaScript/TypeScript dependencies, scripts, and package management. Keep `bun.lock` current. Do not introduce npm, Yarn, or pnpm lockfiles.
- Use the existing Conda environment `musedev` for all Python work and dependencies. For example: `conda run -n musedev python ...` and `conda run -n musedev python -m pip install ...`. Do not install Python packages into the base environment or create another environment for this project.
- This milestone is a React + Electron UI prototype. Keep AI, CAD, project storage, and services disconnected unless the user requests the next milestone.
- Store scene dimensions in millimeters and convert at the interface. Keep scene edits and undo/redo in the workspace reducer.
- Keep Electron's renderer isolated, sandboxed, and without Node integration. Add a narrow native bridge only when a requested feature needs one.
- Run `bun run build` after changing the application. Be candid about visual or native runtime checks that the environment prevents.

# Coding agent scope

- Start Muse through `bun run muse`. Its launcher fixes the workspace to this repository, keeps the native sandbox enabled, and sends approval decisions to the human user.
- Except for the Go-cache authorization below, make changes only inside this repository. Resolve symlinks before treating a path as inside the project. Before any other required change outside it, explain the exact path, action, reason, and expected effect, then ask the user for permission. Wait for their answer. An approval for one action does not authorize other actions.
- Running Python in `musedev` is allowed. Installing or upgrading packages in that Conda environment changes files outside the repository and requires permission first. Never switch environments to evade that boundary.
- Do not change global tools, shell startup files, system settings, other repositories, or home-directory agent configuration without permission. Do not disable the sandbox, enable an automatic approval judge, widen writable paths, or use unrestricted modes to get around a denial.
- Keep agent credentials in the ignored root `.env`. The variable is `META_API_KEY`. Do not print credentials, read unrelated secret files, put credentials in prompts or logs, commit them, or use a `VITE_` prefix for secrets.
- Leave `.muse/` policy files unchanged during ordinary coding tasks. Changes to the agent framework itself require an explicit user request.

# Preauthorized local development

- For ordinary source and documentation edits, use Muse's native `edit_file` or `write_file`. Do not create a shell heredoc or Python helper just to replace text in a project file.
- When a scripted transformation is useful, create its script with `write_file` under `.agent-runtime/` and run Python with `conda run -n musedev python ...`. Do not default to `/tmp` scripts or bare `python3`.
- Within the requested task, edit project code, run the existing tests/build/type checks, inspect project logs and read-only Git history, and rebuild generated project outputs without asking again. Restore dependencies already recorded in the lockfiles using project-local caches; ask before adding, removing, or upgrading dependencies.
- Start, stop, and restart development processes that this agent session started for this repository. Use native task/session controls to stop those processes. Honor Save/Discard/Cancel dialogs and ask before discarding unsaved work. Do not approve arbitrary `kill`/`pkill` commands, kill by process name, or terminate whatever occupies a port. If process ownership cannot be established, ask first.
- Use the fixed command prefixes in `.muse/dev-commands.json` for remembered Muse approvals. These command allowances do not expand sandbox access or approve arbitrary shell scripts, extra commands, or new network destinations.
- Run ordinary checks as simple standalone commands. Inherit `GOCACHE`, `GOMODCACHE`, and `GOTMPDIR` from the launcher rather than putting cache assignments in each Go command. Avoid shell groups, interpreter wrappers, and output-formatting scripts that turn an otherwise approved check into an unclassifiable command.
- Prefer the launcher's Go build/module caches and temporary files under `.agent-runtime/`. Standard Go build and module cache writes needed for this project's compilation and tests are also preauthorized outside the repository. This exception does not authorize Go installation changes, persistent configuration changes, external cache deletion, or other system-wide writes. Keep the sandbox enabled.
- Ask before destructive actions affecting source history, saved designs, or user data, including bulk deletion, Git reset/clean, overwriting saved projects, and discarding unsaved edits. Routine regeneration of ignored build outputs is allowed.
- Ask before live paid API tests, additional paid services/resources, increased budgets, or large unattended agent batches. Normal Muse inference needed for the user's requested task uses the configured hackathon credits. Prefer fake providers for tests; starting the local app or reading its health endpoint does not authorize a paid inference request.
- Commit, push, publish, and deploy only when the user explicitly requests them. Keep global tools, the external `musedev` environment, secrets, and agent permission policy behind the existing approval rules.

# Engineering workflow

For coding tasks, read `.muse/skills/renovacad-engineering/SKILL.md` with the file-reading tool and apply its workflow. It is a project-local adaptation of the pstack approach and does not require a globally installed plugin or native skill discovery.

- Investigate the actual source and reproduce bugs before choosing a fix. Name the data model and owner before changing state or interfaces.
- Compare plausible approaches for a meaningful design decision. Choose the smallest change that meets the request and preserves this milestone's boundaries.
- Use bounded subagents for independent investigation or review when they add value. Keep one writer in the active checkout. Do not create external worktrees without permission.
- Verify observed behavior, inspect the final diff, and report what passed and what remains unverified. Do not commit, push, publish, or deploy unless requested.
