# opencrbasic VS Code client

A minimal VS Code client for the opencrbasic language server (`python -m opencrbasic.lsp`).
It registers the `crbasic` language for CR6 programs and starts the server over stdio. It
provides server diagnostics only. There is no syntax highlighting yet (planned for LSP-03).

## Requirements

- Node.js with npm (the build was checked with Node 22 and npm 10).
- VS Code 1.95 or newer.
- A Python 3.10+ environment with opencrbasic and pygls. From the repository's `opencrbasic/`
  directory:

  ```bash
  cd opencrbasic && uv sync
  ```

  `uv sync` installs the `dev` group, which includes pygls. For a runtime-only environment, use
  `uv pip install -e ".[lsp]"` in an environment you manage yourself.

- In VS Code settings, set `opencrbasic.pythonPath` to the interpreter of that environment, for
  example `$HOME/.uv-envs/opencrbasic/bin/python` with `$HOME` expanded to an absolute path.

## Build

```bash
cd opencrbasic/vscode
npm ci
npm run compile
npm test
```

`npm test` compiles, then runs the plain `node:test` unit tests of the launch-argument builder
and the settings mapping. They do not start VS Code.

## Development launch

1. Open `opencrbasic/vscode/` as the VS Code workspace and run `npm run compile` (or
   `npm run watch`).
2. Press F5 to start the "Run Extension" configuration. It opens an Extension Development Host.
3. Open a `.CR6` file in the host window.

When this client runs from a git worktree, the installed `opencrbasic` package may be the one in
another checkout. Point the server at the sources of the checkout you are testing with
`opencrbasic.serverEnv`:

```json
"opencrbasic.serverEnv": {
  "PYTHONPATH": "<worktree>/opencrbasic/src"
}
```

Use `Restart Server` (command `opencrbasic: Restart Server`) after changing the server code.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `opencrbasic.pythonPath` | `python3` | Interpreter that runs the server |
| `opencrbasic.serverArgs` | `["-m", "opencrbasic.lsp"]` | Arguments after the interpreter |
| `opencrbasic.serverEnv` | `{}` | Extra server environment variables (override inherited ones) |
| `opencrbasic.entries` | `["**/*.CR6"]` | Workspace-relative entry program globs |
| `opencrbasic.exclude` | `[]` | Globs removed from the entries |
| `opencrbasic.logger` | `cr6` | Logger profile: `cr6`, `cr1000x`, `cr300`, `cr350` |
| `opencrbasic.encoding` | `utf-8` | Text encoding for file and unsaved content |
| `opencrbasic.debounceMs` | `300` | Delay after the last edit before analysis |
| `opencrbasic.analysisTimeoutMs` | `10000` | Per-analysis time limit |
| `opencrbasic.trace.server` | `off` | Client-server message trace in the `opencrbasic` output channel |

Changes to `pythonPath`, `serverArgs` and `serverEnv` restart the server. The other settings are
sent to the running server as configuration changes.

## Limitations

- No TextMate grammar or highlighting yet. That is LSP-03.
- The client shows server diagnostics only. Completion, hover, outline and other editing
  features are not implemented.
- Launching inside VS Code has not been tested in the development container, because the VS
  Code download is blocked there. The extension host launch is a human check. Only `npm ci`,
  `npm run compile` and `npm test` have been run.
