# opencrbasic VS Code client

A VS Code client for the opencrbasic language server (`python -m opencrbasic.lsp`). It registers the
`crbasic` language for CRBasic programs and starts the server over stdio. The server provides
diagnostics, hover, completion, signature help, outline, folding, navigation, semantic tokens,
rename, formatting, quick fixes and the syntax highlighting of the CR6 catalog.

Setup, every setting with its default, the feature list with its limits, the help directory and the
host-tested status are in `opencrbasic/docs/lsp-user-guide.md`. Start there.

## Requirements

- Node.js with npm (the macOS host run at `1b01311d` used Node 26.0.0 and npm 11.12.1) and VS Code
  1.95 or newer (the host run used VS Code 1.141.0).
- A Python 3.15+ environment with opencrbasic and pygls: from `opencrbasic/`, `uv sync`. See
  section 2 of `opencrbasic/docs/lsp-user-guide.md`.
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

## Package and install

```bash
cd opencrbasic/vscode
npm ci
npm run package
code --install-extension opencrbasic-0.0.1.vsix
```

`npm run package` compiles, then writes `opencrbasic-<version>.vsix` into this directory. The `.vsix`
is git-ignored and must not be committed. The package holds `out/`, `syntaxes/`,
`language-configuration.json`, `package.json`, this README and the runtime dependency
`vscode-languageclient` with its dependencies. It excludes `src/`, the tests and `.vscode/`.
The package is internal (`opencrbasic/docs/legal.md`): `package.json` says `"license": "UNLICENSED"`,
and the script passes `--allow-missing-repository --skip-license` so that vsce does not ask for a
repository URL or a licence file.

The extension does not include the Python server. Install opencrbasic with the `lsp` extra (from
`opencrbasic/`, `uv sync`, see section 2 of `opencrbasic/docs/lsp-user-guide.md`) and set
`opencrbasic.pythonPath` to that interpreter. Installing the VSIX into VS Code is a host check; it
has not been run in the build container.

## Development launch

1. Open `opencrbasic/vscode/` in VS Code and run `npm run compile` (or `npm run watch`).
2. Press F5 ("Run Extension"). This opens an Extension Development Host with no folder.
3. Open the repository root as the folder, so that the repository's `.vscode/settings.json` applies,
   then open a CRBasic file.

When the interpreter imports `opencrbasic` from another checkout, for example a git worktree, set
`opencrbasic.serverEnv` to `{"PYTHONPATH": "<worktree>/opencrbasic/src"}`. Run
`opencrbasic: Restart Server` after changing server code.

## Settings

Settings are declared in `package.json` and documented in section 3 of
`opencrbasic/docs/lsp-user-guide.md`. The ones that restart the server are
`pythonPath`, `serverArgs` and `serverEnv`; the rest reach the running server without a restart.

## Highlighting and limitations

- `syntaxes/crbasic.tmLanguage.json` is generated from the CR6 catalog by `tools/gen_grammar.py`. Do
  not edit it by hand (`opencrbasic/docs/lsp-api.md`, "Generated TextMate grammar").
- Tested and claimed for macOS only (VS Code 1.141.0), at the revisions in section 8 of
  `opencrbasic/docs/lsp-user-guide.md`: language features, rename, formatting, quick fixes and
  watched files including their visual checks, the packaged `.vsix`, inlay hints and the output
  commands. Windows and Linux are untested and not claimed.
