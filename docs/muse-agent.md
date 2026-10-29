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

## Use the engineering workflow

Root `AGENTS.md` instructs the agent to read `.muse/skills/renovacad-engineering/SKILL.md`. This file assigns lead, explorer, implementer, reviewer, and verifier responsibilities using Muse's native subagents. It is loaded as explicit project instructions rather than a slash command. One agent writes in this checkout at a time. Read-only role assignments are instructions; the native sandbox remains the shared enforcement boundary.

The workflow follows pstack's investigation, design comparison, small implementation, independent review, and observed verification habits. It does not install pstack or modify global agent settings.

Run the launcher checks with:

```sh
bun run muse:test
bun test
bun run build
```

Launcher tests use a stub process to verify arguments, environment, and refusal paths. When the project-local Muse binary is installed, they also run its offline echo provider to verify that the native CLI accepts the permission profile. The echo test excludes model selection flags, makes no model request, and checks for zero token usage. It does not exercise a tool write or a live approval prompt. A real model session and its tool actions need a valid key and remain separate from those checks.

The implementation follows Meta's [launch configuration](https://dev.meta.ai/docs/muse-code/configuration), [permissions](https://dev.meta.ai/docs/muse-code/permissions), and [skills and subagents](https://dev.meta.ai/docs/muse-code/extending) documentation.
