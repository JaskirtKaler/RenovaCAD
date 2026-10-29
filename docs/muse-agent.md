# Run the Muse coding agent

Muse Code is a development tool for this repository. The Electron application and its sample assistant do not call it.

## Add your key and start

The ignored root `.env` is ready for your key. If you cloned a fresh checkout, copy `.env.example` to `.env` first. Set `META_API_KEY` to your Meta Model API key. Keep the key out of `VITE_` variables, source files, and chat messages.

Run these commands from the project:

```sh
bun run muse:check
bun run muse
```

The first command checks local prerequisites without calling the model or spending API credits. It reports missing credentials until you add the key. The second opens the interactive agent. Review and accept Muse's workspace trust prompt to load this repository's instructions.

The launcher requires Bun 1.3.8 and checks that `conda run -n musedev python` works. `MUSE_MODEL` and `MUSE_REASONING_EFFORT` in `.env` select the model and reasoning depth. The defaults are `muse-spark-1.2` and `high`. A model must be available to your account; the offline check cannot verify that access.

## Install Muse in a fresh checkout

This workspace has a local Muse Code installation in ignored `.muse/bin/`. It does not alter your shell startup files. To recreate it, download the official installer, review it, and install inside the repository:

```sh
mkdir -p .muse/bin .muse/runtime/config .muse/runtime/data .agent-runtime/tmp .agent-runtime/cache
curl -fsSL https://dev.meta.ai/install.sh -o .agent-runtime/tmp/muse-install.sh
MUSE_INSTALL_DIR="$PWD/.muse/bin" MUSE_NO_MODIFY_PATH=1 MUSE_LOGIN=0 \
  XDG_CONFIG_HOME="$PWD/.muse/runtime/config" \
  XDG_DATA_HOME="$PWD/.muse/runtime/data" \
  XDG_CACHE_HOME="$PWD/.agent-runtime/cache" \
  TMPDIR="$PWD/.agent-runtime/tmp" \
  bash .agent-runtime/tmp/muse-install.sh
```

The launcher prefers that local installation and otherwise looks for `muse` on your PATH. It disables automatic updates during coding sessions. Run the installer yourself when you choose to update. The setup was checked with Muse Code 1.4.14.

## Understand the permission boundary

The launcher fixes the workspace to the repository containing `.muse/launch.mjs`. It selects Muse's built-in `:ask-me` permission profile. That profile enables the sandbox and human approval with the default network policy. Muse 1.4.14 rejects combining a named profile with separate approval or sandbox flags, so the launcher selects the profile alone. It accepts no extra Muse flags. Normal in-project edits proceed; risky actions and new shell network destinations can require your decision.

Muse's native file tools and OS shell sandbox enforce workspace writes. Its documented sandbox also permits a temporary directory. The launcher points temporary files and caches into ignored `.agent-runtime/` inside the repository. Supported Muse configuration and session data paths live in ignored `.muse/runtime/`. Muse protects `.git/`, `.muse/`, and `.agents/` from ordinary sandboxed shell writes. Those protections also mean agent commits or policy edits can need separate approval.

An outside write can fail directly instead of opening a permission prompt. The project instructions require the agent to explain the path and action and ask you before it needs an external change. Do not disable the sandbox to clear a failure. Give narrowly scoped permission for the particular action or perform the external step yourself. Running raw `muse`, changing permissions interactively, or editing the launcher can change these controls. These files do not restrict other applications on your computer.

Python execution uses the existing `musedev` environment. Installing packages into that environment changes external files and therefore requires permission. The environment name is an execution rule, not a separate filesystem sandbox.

## Apply routine development approvals

Run the following command to synchronize the project's named development-command approvals without starting a model session:

```sh
bun run muse:permissions
```

Normal `bun run muse` startup also synchronizes these approvals. `.muse/dev-commands.json` is the single list of preapproved command prefixes. It covers named Bun development and verification commands, restoration of locked dependencies, service-local Go run/test commands, and read-only Git inspection. It does not approve bare runtimes, arbitrary shell commands, process-killing commands, dependency upgrades, or paid API calls.

The synchronizer uses the existing `musedev` Python environment and its standard library to lock and atomically update Muse's project-local approval store. It preserves existing rules and explicit denials, adds no duplicate entries, and refuses an unknown store schema or external path. The store format was observed in Muse 1.4.14 rather than a public configuration-authoring schema; recheck compatibility after a Muse upgrade. Native denials and sandbox restrictions still apply.

Exit the existing Muse session, then run `bun run muse` from the repository root. Restarting Terminal itself is unnecessary. Launching plain `muse` does not run the project launcher or synchronize its settings.

For ordinary source and documentation edits, Muse should use its native file-editing tools. Named command approvals do not cover arbitrary heredocs or interpreter scripts, so restarting Muse does not make every shell command automatic. Useful scripts belong under `.agent-runtime/`, created through `write_file` and run in `musedev`.

Go commands should inherit the launcher's cache variables. Inline cache assignments and complex command groups can make Muse mark a shell stage incomplete, preventing a remembered command prefix from matching. Prefer simple standalone test/build/run commands.

A first connection to a new network destination or an OS restriction can still need approval. Do not switch to an unrestricted profile to clear one of those holds.

Muse may manage the development processes it started for this repository. It must preserve unsaved work, use native task/session controls, and ask when process ownership is unclear. No broad `kill` or `pkill` allowance is installed. Electron currently manages the Go service lifecycle, so a normal app restart should manage its service too.

The launcher sets `GOCACHE`, `GOMODCACHE`, and `GOTMPDIR` inside ignored `.agent-runtime/`. Electron's Go child inherits them when launched from Muse. `ELECTRON_CACHE` also points inside the project for locked dependency restoration. These settings apply to commands launched from Muse; unrelated terminals keep their existing environment. Existing external cache contents are not migrated or removed.

The user also authorizes standard external Go build and module cache writes needed for this project's compilation and tests. This is a specific task authorization, not an added sandbox writable root or permission to change Go's installation, persistent configuration, or other system files. Prefer the local cache environment above.

Other outside-project changes, destructive actions, new dependencies, Git writes, publishing, and additional paid API tests still require your decision. Normal Muse work on your requested task uses your configured credits. The spending rule is an agent instruction, not a provider billing cap.

## Use the engineering workflow

Root `AGENTS.md` instructs the agent to read `.muse/skills/renovacad-engineering/SKILL.md`. This file assigns lead, explorer, implementer, reviewer, and verifier responsibilities using Muse's native subagents. It is loaded as explicit project instructions rather than a slash command. One agent writes in this checkout at a time. Read-only role assignments are instructions; the native sandbox remains the shared enforcement boundary.

The workflow follows pstack's investigation, design comparison, small implementation, independent review, and observed verification habits. It does not install pstack or modify global agent settings.

Run the launcher checks with:

```sh
bun run muse:test
bun test
bun run build
```

Launcher tests use a stub process to verify arguments, environment, and refusal paths. They exercise the real standard-library permission synchronizer against isolated stores, including rule preservation and invalid-store refusal. When the project-local Muse binary is installed, they also run its offline echo provider to verify that the native CLI accepts the permission profile. The echo test excludes model selection flags, makes no model request, and checks for zero token usage. Echo startup does not prove that native command rules were enforced.

An offline inspection through Muse's native session protocol confirmed the human reviewer and the requested sandboxed profile. That inspection reported the OS sandbox unavailable in this execution environment, so actual tool write denial, live approval behavior, and Electron restarts remain unverified here. The sandbox is kept enabled; no guardrail was disabled for these checks.

The implementation follows Meta's [launch configuration](https://dev.meta.ai/docs/muse-code/configuration), [permissions](https://dev.meta.ai/docs/muse-code/permissions), and [skills and subagents](https://dev.meta.ai/docs/muse-code/extending) documentation.
