# CRBasic for VS Code (opencrbasic)

A VS Code client for the opencrbasic language server (`python -m opencrbasic.lsp`). It registers the
`crbasic` language for CRBasic programs and starts the server over stdio. The server provides
diagnostics, hover, completion, signature help, outline, folding, navigation, semantic tokens,
rename, formatting, quick fixes and the syntax highlighting of the CR6 catalog.

Setup, every setting with its default, the feature list with its limits, the help directory and the
host-tested status are in [the user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md) of [opencrbasic](https://github.com/UtrechtUniversity/open-crbasic).
MIT licensed; not affiliated with Campbell Scientific.

## Quick start

1. Install the server: `uv tool install "opencrbasic[lsp]"` (or `pip install "opencrbasic[lsp]"` into
   any Python 3.15+ environment).
2. Install this extension from the Marketplace ("CRBasic (opencrbasic)").
3. Set `opencrbasic.pythonPath` to that environment's interpreter, as an absolute path. With
   `uv tool`, that is `$(uv tool dir)/opencrbasic/bin/python`.

## Requirements

- Node.js with npm (the macOS host run at `1b01311d` used Node 26.0.0 and npm 11.12.1) and VS Code
  1.95 or newer (the host run used VS Code 1.141.0).
- A Python 3.15+ environment with `opencrbasic[lsp]`; see section 2 of [the user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md).
- `opencrbasic.pythonPath` set to that environment's interpreter, as an absolute path.

## Build and test

```bash
npm ci
npm run lint
npm test
uvx pre-commit install   # lint, compile and file hygiene before each commit
```

`npm run lint` runs ESLint with typescript-eslint; `npm test` compiles (`tsc --strict`), then runs the `node:test` unit tests in `src/test/`: the launch-argument builder,
the settings mapping, the configuration-change decisions and the client stop. They do not start VS Code.

## Package and install

```bash
npm ci
npm run package
code --install-extension opencrbasic-<version>.vsix
```

`npm run package` compiles, then writes `opencrbasic-<version>.vsix` into this directory. The `.vsix`
is git-ignored and must not be committed. The package holds `out/`, `syntaxes/`,
`language-configuration.json`, `package.json`, this README and the runtime dependency
`vscode-languageclient` with its dependencies. It excludes `src/`, the tests and `.vscode/`.
CI builds the same package on every push and publishes it to the Visual Studio Marketplace from
`main` (see "Releasing").

The extension does not include the Python server. Install opencrbasic with the `lsp` extra and set
`opencrbasic.pythonPath` to that interpreter. Installing the VSIX into VS Code is a host check; it
has not been run in the build container.

## Development launch

1. Open this repository in VS Code and run `npm run compile` (or `npm run watch`).
2. Press F5 ("Run Extension"). This opens an Extension Development Host with no folder.
3. Open a folder with CRBasic programs, for example a checkout of
   [firnmelt-station](https://github.com/UtrechtUniversity/firnmelt-station), then open a CRBasic file.

When the interpreter imports `opencrbasic` from another checkout, for example a git worktree, set
`opencrbasic.serverEnv` to `{"PYTHONPATH": "<checkout>/src"}`. Run
`opencrbasic: Restart Server` after changing server code.

## Settings

Settings are declared in `package.json` and documented in section 3 of [the user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md). The ones that restart the server are
`pythonPath`, `serverArgs` and `serverEnv`; the rest reach the running server without a restart.

## Highlighting and limitations

- `syntaxes/crbasic.tmLanguage.json` is generated from the CR6 catalog by opencrbasic's
  `tools/gen_grammar.py`, run in an open-crbasic checkout next to this one. Do not edit it by hand.
- Tested and claimed for macOS only (VS Code 1.141.0), at the revisions in section 8 of [the user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md): language features, rename, formatting, quick fixes and
  watched files including their visual checks, the packaged `.vsix`, inlay hints and the output
  commands. Windows and Linux are untested and not claimed.

## Releasing

A push to `main` that passes CI publishes the extension to the Visual Studio Marketplace when the
`version` in `package.json` has not been published yet (`vsce publish --skip-duplicate`); bump it
with `npm version patch --no-git-tag-version` in the change to release. Publishing needs the
`VSCE_PAT` secret in the `marketplace` GitHub environment. The extension's version is independent of
the opencrbasic package version.
