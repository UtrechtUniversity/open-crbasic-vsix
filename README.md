# CRBasic for VS Code (opencrbasic)

Language support for CRBasic programs (Campbell Scientific dataloggers) in VS Code, backed by the
[opencrbasic](https://github.com/UtrechtUniversity/open-crbasic) language server. The extension
registers the `crbasic` language, starts the server over stdio, and adds syntax highlighting. The
server provides diagnostics, hover, completion, signature help, outline, folding, navigation,
semantic tokens, rename, formatting and quick fixes. Optional logger commands (below) talk to a
datalogger through [open-loggernet](https://github.com/UtrechtUniversity/open-loggernet).

Open source (MIT). **Not affiliated with, endorsed by or supported by Campbell Scientific.**
Setup details, every server setting and the feature limits are in the
[user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md).

## Install

- **Marketplace:** [OttodeVisserUU.opencrbasic](https://marketplace.visualstudio.com/items?itemName=OttodeVisserUU.opencrbasic),
  or search "CRBasic (opencrbasic)" in the Extensions view.
- **From a `.vsix`:** download `opencrbasic-<version>.vsix` from
  [GitHub Releases](https://github.com/UtrechtUniversity/open-crbasic-vsix/releases), then run
  `code --install-extension opencrbasic-<version>.vsix` or use *Extensions: Install from VSIX...*.

Requires VS Code 1.95 or newer. The extension needs a trusted workspace (it runs a Python server).

## Prerequisites

The language server is the `opencrbasic` Python package with its `lsp` extra, which needs
**Python 3.15 or newer**. The extension is only the client; it does not bundle the server.

- **Easiest:** open a CRBasic file. If no server is found, the extension offers to run
  `uv tool install "opencrbasic[lsp]"` ([uv](https://docs.astral.sh/uv/) fetches Python itself) and,
  if uv is missing, to run Astral's uv installer first. A uv tool install is found without any
  setting. If the server is older than the extension expects, it offers `uv tool upgrade opencrbasic`.
- **Own environment:** `pip install "opencrbasic[lsp]"` into any Python 3.15+, then set
  `opencrbasic.pythonPath` to its interpreter (absolute path).

## Features

- Syntax highlighting for CRBasic, generated from the CR6 instruction catalog.
- Diagnostics from the opencrbasic checker, hover, completion, signature help, outline, folding,
  navigation, semantic tokens, rename, formatting, quick fixes.
- Parameter-name inlay hints (needs `opencrbasic.helpDirectory`).
- Commands: `opencrbasic: Restart Server`, `opencrbasic: Show Compiler Output`,
  `opencrbasic: Show Table Fields`.
- File types: `.CR6`, `.crb`, `.CR1X`, `.CR300`, `.CR350` (any case).
- Optional logger commands, see below.

## Settings

Server settings (`opencrbasic.*`; `pythonPath`, `serverArgs` and `serverEnv` restart the server, the
rest apply live):

| Setting | Default | Purpose |
|---|---|---|
| `pythonPath` | `python3` | Interpreter that runs the server. Unset: the uv tool install's interpreter if present. |
| `serverArgs` | `["-m", "opencrbasic.lsp"]` | Arguments passed to the interpreter. |
| `serverEnv` | `{}` | Extra environment variables for the server (e.g. `PYTHONPATH` for a dev checkout). |
| `entries` | `["**/*.CR6"]` | Workspace-relative globs of entry programs, analyzed with their includes. |
| `exclude` | `[]` | Globs removed from the entries. |
| `logger` | `cr6` | Logger profile: `cr6`, `cr1000x`, `cr300`, `cr350`. |
| `encoding` | `utf-8` | Text encoding for files and unsaved content. |
| `debounceMs` | `300` | Delay after the last edit before analysis. |
| `analysisTimeoutMs` | `10000` | Per-analysis time limit. |
| `maxFileBytes` | `2097152` | Larger files are not analyzed (a warning is shown). |
| `maxQueuedJobs` | `64` | Entry programs analyzed at once; the rest wait. |
| `maxCacheMb` | `256` | Memory for parsed programs kept for hover, completion and navigation. |
| `checks` | `{}` | Severity per check code, e.g. `{"OCB005": "off"}`; overrides `opencrbasic.toml`. |
| `coverageNotices` | `false` | Hints where the reference compiler has rules opencrbasic does not model. |
| `helpDirectory` | `""` | Directory with extracted CRBasic help (`Instructions/*.htm`, `parameters/*.htm`). Empty: no help text in hover and signature help. |
| `inlayHints.parameterNames` | `true` | Parameter-name hints; needs `helpDirectory`. |
| `trace.server` | `off` | `off`, `messages` or `verbose` client-server trace in the output channel. |

The extension does not ship Campbell's help files; point `helpDirectory` at your own extracted copy.

## Logger commands (optional)

Backed by open-loggernet's `oln`, these talk to a logger attached by USB. Before the first use in a
session the extension checks `oln --version` and offers to install or upgrade open-loggernet with
`uv tool install openloggernet`.

| Command | What it does |
|---|---|
| Logger: Open Panel | Station info, clock, tables, files, live values and terminal in one view. |
| Logger: Send Program and Run | Sends the open program to `CPU:`, compiles and runs it, reports the compile result. Also the upload button in the editor title bar. |
| Logger: Collect Table... | Collects a table to a TOA5 `.dat`, CSV or JSON Lines file. |
| Logger: Select Logger, Show Station Info, Stop Program (keep data), Resume Program, Set Clock to UTC | As named. |

Settings: `openloggernet.command` (how `oln` is run; default: the uv tool install's `oln`, else `oln`
on PATH) and `openloggernet.port` (serial port, e.g. `COM5` or `/dev/ttyACM0`; empty: the selected
or only attached logger). Only one program can hold a logger's port, so disconnect LoggerNet first.
These commands change what runs on a real datalogger; use them with care.

## Limitations

- Tested and claimed for macOS only; Windows and Linux are untested. See the
  [user guide](https://github.com/UtrechtUniversity/open-crbasic/blob/main/docs/lsp-user-guide.md)
  for tested revisions.
- Checks run only on programs the reference compiler accepts. opencrbasic does not replace Campbell's compiler.
- Workspace entries default to `*.CR6` files; set `opencrbasic.entries` for other extensions.
- Not available in untrusted workspaces.

## Development and releases

```bash
npm ci
npm run lint
npm test
npm run package   # writes opencrbasic-<version>.vsix
```

Press F5 in VS Code ("Run Extension") to launch a development host. `syntaxes/crbasic.tmLanguage.json`
is generated by `tools/gen_grammar.py` in [open-crbasic](https://github.com/UtrechtUniversity/open-crbasic);
do not edit it by hand. Releases publish to the Marketplace from `main` when the `version` in
`package.json` is new. The extension version is independent of the opencrbasic package version.
Issues: [GitHub issues](https://github.com/UtrechtUniversity/open-crbasic-vsix/issues).

## License

[MIT](LICENSE).
