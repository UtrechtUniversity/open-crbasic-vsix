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
- Reference counts above declarations (click to list them), and declarations nothing uses shown
  faded while the program has no errors.
- Case correction as you type: a name takes its declaration's spelling, a keyword, data type or
  instruction its conventional one (`beginprog` becomes `BeginProg`). It uses `editor.formatOnType`,
  which the extension turns on for CRBasic.
- Each program is analysed for the logger its extension names (`.CR6`, `.CR1X`, `.CR300`,
  `.CR350`), unless `logger` names one.
- Indentation as you type after block keywords (`BeginProg`, `Scan`, `If … Then`, `For`,
  `DataTable`, …), and `Ctrl+'` / `Ctrl+Shift+'` (`Cmd` on macOS) to comment and uncomment lines.
- **CRBasic** side bar: **Instructions** (the instructions and functions of the active program's
  logger; search, filter by kind, insert with a tab stop per required parameter, help),
  **Instruction Help** (the help for the instruction under the cursor, as in hover) and **Data
  Tables** (each table's interval and fields as the compiler builds them; click a table to go to it).
- **CRBasic: New Program...** (also under *File › New File...*): a small program for the chosen
  logger, saved with that logger's extension.
- Commands: `opencrbasic: Restart Server`, `opencrbasic: Show Compiler Output`,
  `opencrbasic: Show Table Fields`.
- File types: `.CR6`, `.crb`, `.CR1X`, `.CR300`, `.CR350`, `.dld` (any case). The reference compilers
  do not accept a `.dld` include, so a `.dld` is highlighted but is neither an entry nor a library.
- Optional logger commands, see below.

## Settings

Server settings (`opencrbasic.*`; `pythonPath`, `serverArgs` and `serverEnv` restart the server, the
rest apply live):

| Setting | Default | Purpose |
|---|---|---|
| `pythonPath` | `python3` | Interpreter that runs the server. Unset: the uv tool install's interpreter if present. |
| `serverArgs` | `["-m", "opencrbasic.lsp"]` | Arguments passed to the interpreter. |
| `serverEnv` | `{}` | Extra environment variables for the server (e.g. `PYTHONPATH` for a dev checkout). |
| `entries` | `["**/*.{CR6,CR1X,CR300,CR350}"]` | Workspace-relative globs of entry programs, analyzed with their includes. |
| `exclude` | `[]` | Globs removed from the entries. |
| `logger` | `auto` | Logger profile: `auto` (each program's from its extension), or `cr6`, `cr1000x`, `cr300`, `cr350` for every program. |
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
| `unusedHints` | `true` | Fade declarations nothing uses. |
| `codeLens.references` | `true` | Reference counts above declarations. |
| `caseCorrection` | `true` | Respell the name just typed. |
| `compiler` | `python` | Compiler for Logger: Build and Show Compiler Output: `python` (the language server, unsaved text included) or `rust` ([open-crbasic-rs](https://github.com/UtrechtUniversity/open-crbasic-rs) `crbc`, run on the saved file). Diagnostics always come from the server. |
| `crbcPath` | `""` | The Rust `crbc`. Empty: Cargo's bin directory (`cargo install opencrbasic`), else `crbc` on PATH; the Python package installs a `crbc` too. |
| `trace.server` | `off` | `off`, `messages` or `verbose` client-server trace in the output channel. |

The extension does not ship Campbell's help files; point `helpDirectory` at your own extracted copy.

## Logger commands (optional)

Backed by open-loggernet's `oln`, these talk to a logger attached by USB. Before the first use in a
session the extension checks `oln --version` and offers to install or upgrade open-loggernet with
`uv tool install openloggernet`.

The **Logger** view in the Activity Bar has five sections. Each starts empty: **Scan** reads it once
and opens the serial port only for that read, after which the section's title shows Refresh.

| Section | What it shows and does |
|---|---|
| Datalogger | Port (click to pick another logger, or Automatic), model, serial number, station name, OS version, program, compile result and clock. An OS older than the newest one open-loggernet knows of, and a clock more than 1 s off UTC, are flagged and offer Update OS (download page, or send a `.obj`) and Sync Clock. |
| Program and Files | The running program and the files on the logger. Upload files; download, delete or compile-and-run the selected ones (several at once for download and delete). |
| Live Values (Public) | The Public table, read every second. Connect holds the serial port until Disconnect; other logger actions pause it while they run. Click a value to change it. |
| Data Tables | The running program's tables: download one, all, or a selection. |
| Device Settings | The logger's settings by name; click one to change it. Secrets are masked. |

| Command | What it does |
|---|---|
| Logger: Build | Compiles the open program with the language server and reports the result. |
| Logger: Build, Send and Run | Builds, then sends the program **and the library files it includes** (found next to it) to `CPU:`, compiles and runs it on the logger. |
| Logger: Build, Send, Run and Monitor | The same, then connects Live Values. |
| Logger: Send and Run | Sends and runs without building first. |
| Logger: Download Data Tables... | Picks tables (all data tables preselected) and a format, TOA5 or TOB1 `.dat` or CSV, and writes `<station>_<table>.<ext>` files to the workspace folder. |
| Logger: Open Panel | Station info, clock, tables, files, live values and terminal in one webview. |
| Logger: Collect Table... | Collects one table to a file of your choice. |
| Logger: Select Serial Port..., Show Station Info, Stop Program (keep data), Resume Program, Sync Clock to UTC, Update Operating System... | As named. |

The four build and send commands are also buttons in the editor title bar of a CRBasic file.

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
