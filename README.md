# CRBasic for VS Code (opencrbasic)

A VS Code client for the opencrbasic language server (`python -m opencrbasic.lsp`). It registers the
`crbasic` language for CRBasic programs and starts the server over stdio. The server provides
diagnostics, hover, completion, signature help, outline, folding, navigation, semantic tokens,
rename, formatting, quick fixes and the syntax highlighting of the CR6 catalog.

Setup, every setting with its default, the feature list with its limits, the help directory and the
host-tested status are in [the user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md) of [opencrbasic](https://github.com/UtrechtUniversity/open-crbasic).
MIT licensed; not affiliated with Campbell Scientific.

## Quick start

1. Install this extension from the Marketplace ("CRBasic (opencrbasic)").
2. Open a CRBasic file. If the server is missing, the extension offers to install it with
   `uv tool install "opencrbasic[lsp]"`; uv fetches Python 3.15 itself. Without
   [uv](https://docs.astral.sh/uv/), it offers to run Astral's uv installer first (which also adds
   uv to your shell's PATH). A uv tool install is found without any setting.
   A server older than the extension expects (`MIN_SERVER_VERSION` in `src/serverOptions.ts`)
   still starts; the extension then offers `uv tool upgrade opencrbasic` once per session.
3. With another environment (`pip install "opencrbasic[lsp]"` into any Python 3.15+), set
   `opencrbasic.pythonPath` to its interpreter, as an absolute path.

## Requirements

- Node.js with npm (the macOS host run at `1b01311d` used Node 26.0.0 and npm 11.12.1) and VS Code
  1.95 or newer (the host run used VS Code 1.141.0).
- A Python 3.15+ environment with `opencrbasic[lsp]`; see section 2 of [the user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md).
- `opencrbasic.pythonPath` set to that environment's interpreter, as an absolute path, unless it is
  a `uv tool` install, which is found on its own.

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

`npm run package` type-checks, bundles the client and `vscode-languageclient` into one minified
`dist/extension.js` with esbuild, then writes `opencrbasic-<version>.vsix` into this directory. The
`.vsix` is git-ignored and must not be committed. The package holds `dist/extension.js`,
`syntaxes/`, `language-configuration.json`, `package.json` and this README; `node_modules/`, `out/`,
`src/`, the tests and `.vscode/` stay out.
CI builds the same package on every push and publishes it to the Visual Studio Marketplace from
`main` (see "Releasing").

The extension does not include the Python server. Install opencrbasic with the `lsp` extra and set
`opencrbasic.pythonPath` to that interpreter. Installing the VSIX into VS Code is a host check; it
has not been run in the build container.

## Development launch

1. Open this repository in VS Code and run `npm run bundle` (or `npm run watch`, which rebuilds
   `dist/extension.js` with a source map on every change).
2. Press F5 ("Run Extension"). This opens an Extension Development Host with no folder.
3. Open a folder with CRBasic programs, then open a CRBasic file.

When the interpreter imports `opencrbasic` from another checkout, for example a git worktree, set
`opencrbasic.serverEnv` to `{"PYTHONPATH": "<checkout>/src"}`. Run
`opencrbasic: Restart Server` after changing server code.

## Settings

Settings are declared in `package.json` and documented in section 3 of [the user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md). The ones that restart the server are
`pythonPath`, `serverArgs` and `serverEnv`; the rest reach the running server without a restart.

## Logger actions

Backed by [open-loggernet](https://github.com/UtrechtUniversity/open-loggernet)'s `oln`, the
extension talks to a Campbell logger attached by USB. Before the first logger action of a session it
checks `oln --version`, and offers to install open-loggernet with uv (`uv tool install
openloggernet`) when it is missing, or to upgrade it when it is older than the extension needs:

| Command | What it does |
|---|---|
| Logger: Open Panel | Station info, clock, tables, files, live values and the logger's terminal in one view, in the manner of LoggerNet's Connect screen. |
| Logger: Send Program and Run | Sends the open program to `CPU:`, has the logger compile and run it, and reports its compile result. Also the upload button in a CRBasic editor's title bar. |
| Logger: Collect Table... | Collects a whole table to a TOA5 `.dat`, CSV or JSON Lines file. |
| Logger: Select Logger, Show Station Info, Stop Program, Resume Program, Set Clock to UTC | As named. |

`openloggernet.command` sets how `oln` is run (default: the uv tool install's `oln`, else `oln` on
PATH); `openloggernet.port` pins a
serial port. Only one program can hold a logger's port, so disconnect LoggerNet first; the
extension runs one `oln` call at a time and pauses a live watch while another call needs the port.

## Highlighting and limitations

- `syntaxes/crbasic.tmLanguage.json` is generated from the CR6 catalog by opencrbasic's
  `tools/gen_grammar.py`, run in an open-crbasic checkout next to this one. Do not edit it by hand.
- Tested and claimed for macOS only (VS Code 1.141.0), at the revisions in section 8 of [the user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md): language features, rename, formatting, quick fixes and
  watched files including their visual checks, the packaged `.vsix`, inlay hints and the output
  commands. Windows and Linux are untested and not claimed.

## Releasing

A push to `main` that passes CI publishes the extension to the Visual Studio Marketplace when the
`version` in `package.json` has not been published yet (`vsce publish --skip-duplicate`); bump it
with `npm version patch --no-git-tag-version` in the change to release. Publishing uses Marketplace
Trusted Publishing (OIDC) from the `marketplace` GitHub environment; no token is stored. The extension's version is independent of
the opencrbasic package version.
