# opencrbasic VS Code client

A VS Code client for the opencrbasic language server (`python -m opencrbasic.lsp`). It registers the
`crbasic` language for CRBasic programs and starts the server over stdio. The server provides
diagnostics, hover, completion, signature help, outline, folding, navigation, semantic tokens and
the syntax highlighting of the CR6 catalog.

Setup, every setting with its default, the feature list with its limits, the help directory and the
host-tested status are in [the user guide](../docs/lsp-user-guide.md). Start there.

## Requirements

- Node.js with npm (checked with Node 22 and npm 10) and VS Code 1.95 or newer.
- A Python 3.10+ environment with opencrbasic and pygls: from `opencrbasic/`, `uv sync`. See
  [the guide, section 2](../docs/lsp-user-guide.md#2-install-and-launch).
- `opencrbasic.pythonPath` set to that environment's interpreter, as an absolute path.

## Build and test

```bash
cd opencrbasic/vscode
npm ci
npm run compile
npm test
```

`npm test` compiles, then runs the `node:test` unit tests in `src/test/`: the launch-argument builder,
the settings mapping, the configuration-change decisions and the client stop. They do not start VS Code.

## Development launch

1. Open `opencrbasic/vscode/` in VS Code and run `npm run compile` (or `npm run watch`).
2. Press F5 ("Run Extension"). This opens an Extension Development Host.
3. Open a CRBasic file in the host window.

When the interpreter imports `opencrbasic` from another checkout, for example a git worktree, set
`opencrbasic.serverEnv` to `{"PYTHONPATH": "<worktree>/opencrbasic/src"}`. Run
`opencrbasic: Restart Server` after changing server code.

## Settings

Settings are declared in [`package.json`](package.json) and documented in
[the guide, section 3](../docs/lsp-user-guide.md#3-settings). The ones that restart the server are
`pythonPath`, `serverArgs` and `serverEnv`; the rest reach the running server without a restart.

## Highlighting and limitations

- `syntaxes/crbasic.tmLanguage.json` is generated from the CR6 catalog by `tools/gen_grammar.py`. Do
  not edit it by hand ([lsp-api.md](../docs/lsp-api.md), "Generated TextMate grammar").
- Rename, formatting and quick fixes are not offered by the server yet, and file changes outside the
  editor are not watched. See [the guide, section 5.10](../docs/lsp-user-guide.md#510-not-offered-by-the-server-on-this-base)
  and [section 9](../docs/lsp-user-guide.md#9-known-limits).
- Only macOS has been tested in VS Code. Windows and Linux are untested.
