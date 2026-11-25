// Pure launch and settings helpers. No `vscode` import: node:test loads this module directly.
import * as path from 'node:path';

export interface LaunchSettings {
  pythonPath: string;
  serverArgs: string[];
  serverEnv: Record<string, string>;
}

export interface LaunchCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface ServerSettings {
  entries: string[];
  exclude: string[];
  logger: string;
  encoding: string;
  debounceMs: number;
  analysisTimeoutMs: number;
  maxFileBytes: number;
  maxQueuedJobs: number;
  maxCacheMb: number;
  helpDirectory: string;
  inlayHints: { parameterNames: boolean };
  unusedHints: boolean;
  codeLens: { references: boolean };
  caseCorrection: boolean;
}

export function buildServerLaunch(cfg: LaunchSettings, baseEnv: NodeJS.ProcessEnv): LaunchCommand {
  return {
    command: cfg.pythonPath,
    args: [...cfg.serverArgs],
    env: { ...baseEnv, ...cfg.serverEnv },
  };
}

// An executable in the environment that `uv tool install <tool>` creates in uv's tool directory:
// UV_TOOL_DIR, else $XDG_DATA_HOME/uv/tools or ~/.local/share/uv/tools, or %APPDATA%\uv\data\tools
// on Windows.
function uvToolExecutable(tool: string, name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  if (platform === 'win32') {
    const dir = env.UV_TOOL_DIR ?? path.win32.join(env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming'), 'uv', 'data', 'tools');
    return path.win32.join(dir, tool, 'Scripts', `${name}.exe`);
  }
  const dir = env.UV_TOOL_DIR ?? path.posix.join(env.XDG_DATA_HOME ?? path.posix.join(home, '.local', 'share'), 'uv', 'tools');
  return path.posix.join(dir, tool, 'bin', name);
}

// Interpreter of `uv tool install "opencrbasic[lsp]"`.
export function uvToolPython(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  return uvToolExecutable('opencrbasic', 'python', env, platform, home);
}

// `oln` of `uv tool install openloggernet`.
export function uvToolOln(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  return uvToolExecutable('openloggernet', 'oln', env, platform, home);
}

// A command the user set wins; otherwise the uv tool install's `oln` if present, else `oln` on PATH.
export function resolveOlnCommand(configured: string[] | undefined, uvOln: string, exists: (file: string) => boolean): string[] {
  if (configured?.length) {
    return [...configured];
  }
  return [exists(uvOln) ? uvOln : 'oln'];
}

// The version in `oln --version` output (`oln 0.3.0`), or undefined.
export function parseOlnVersion(stdout: string): string | undefined {
  return /^oln\s+(\d+(?:\.\d+)*\S*)/m.exec(stdout.trim())?.[1];
}

// The oldest open-loggernet whose `oln` this extension drives (0.4.0: `flash --json`, TOB1, settings by
// name and the OS check in `oln info`).
export const MIN_OLN_VERSION = '0.4.0';

// The uv executable: on PATH, else where Astral's installer puts it (UV_INSTALL_DIR, XDG_BIN_HOME,
// else ~/.local/bin; %USERPROFILE%\.local\bin on Windows), which a fresh install has not yet added to PATH.
export function findUv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
  exists: (file: string) => boolean,
): string | undefined {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const name = platform === 'win32' ? 'uv.exe' : 'uv';
  const dirs = (env.PATH ?? env.Path ?? '').split(p.delimiter).filter(Boolean);
  dirs.push(env.UV_INSTALL_DIR ?? env.XDG_BIN_HOME ?? p.join(home, '.local', 'bin'));
  return dirs.map((dir) => p.join(dir, name)).find(exists);
}

// Astral's official uv installer, run without a shell profile in between.
export function uvInstaller(platform: NodeJS.Platform): { command: string; args: string[] } {
  return platform === 'win32'
    ? {
        command: 'powershell',
        args: ['-NoProfile', '-ExecutionPolicy', 'ByPass', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex'],
      }
    : { command: 'sh', args: ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'] };
}

// A pythonPath the user set wins; otherwise the uv tool install if present, else the manifest default.
export function resolvePythonPath(configured: string | undefined, uvPython: string, exists: (file: string) => boolean): string {
  return configured ?? (exists(uvPython) ? uvPython : 'python3');
}

export function initializationOptions(cfg: ServerSettings): ServerSettings {
  return {
    entries: [...cfg.entries],
    exclude: [...cfg.exclude],
    logger: cfg.logger,
    encoding: cfg.encoding,
    debounceMs: cfg.debounceMs,
    analysisTimeoutMs: cfg.analysisTimeoutMs,
    maxFileBytes: cfg.maxFileBytes,
    maxQueuedJobs: cfg.maxQueuedJobs,
    maxCacheMb: cfg.maxCacheMb,
    helpDirectory: cfg.helpDirectory,
    inlayHints: { parameterNames: cfg.inlayHints.parameterNames },
    unusedHints: cfg.unusedHints,
    codeLens: { references: cfg.codeLens.references },
    caseCorrection: cfg.caseCorrection,
  };
}

// `crbc` of `cargo install opencrbasic` (open-crbasic-rs): $CARGO_HOME/bin, else ~/.cargo/bin.
export function cargoCrbc(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const p = platform === 'win32' ? path.win32 : path.posix;
  return p.join(env.CARGO_HOME ?? p.join(home, '.cargo'), 'bin', platform === 'win32' ? 'crbc.exe' : 'crbc');
}

// A crbcPath the user set wins; otherwise Cargo's install if present, else `crbc` on PATH. Python's
// opencrbasic installs a `crbc` too, and both print the same version line, so PATH is the last resort.
export function resolveCrbcPath(configured: string, cargo: string, exists: (file: string) => boolean): string {
  return configured.trim() || (exists(cargo) ? cargo : 'crbc');
}

// The oldest server this extension's grammar and features expect (opencrbasic 1.1.0: macros).
export const MIN_SERVER_VERSION = '1.1.0';

// True when `version` (the server's `serverInfo.version`, e.g. `1.0.0` or `1.1.0.dev12`) has a
// lower release number than `minimum`; an unknown or unparsable version is not reported as older.
export function olderThan(version: string | undefined, minimum: string): boolean {
  const release = (v: string | undefined) => /^\d+(?:\.\d+)*/.exec(v ?? '')?.[0].split('.').map(Number);
  const have = release(version);
  const want = release(minimum) ?? [];
  if (!have) {
    return false;
  }
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    const a = have[i] ?? 0;
    const b = want[i] ?? 0;
    if (a !== b) {
      return a < b;
    }
  }
  return false;
}
