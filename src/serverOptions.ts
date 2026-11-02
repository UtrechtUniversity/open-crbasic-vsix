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
}

export function buildServerLaunch(cfg: LaunchSettings, baseEnv: NodeJS.ProcessEnv): LaunchCommand {
  return {
    command: cfg.pythonPath,
    args: [...cfg.serverArgs],
    env: { ...baseEnv, ...cfg.serverEnv },
  };
}

// Interpreter that `uv tool install "opencrbasic[lsp]"` creates, in uv's tool directory: UV_TOOL_DIR,
// else $XDG_DATA_HOME/uv/tools or ~/.local/share/uv/tools, or %APPDATA%\uv\data\tools on Windows.
export function uvToolPython(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  if (platform === 'win32') {
    const dir = env.UV_TOOL_DIR ?? path.win32.join(env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming'), 'uv', 'data', 'tools');
    return path.win32.join(dir, 'opencrbasic', 'Scripts', 'python.exe');
  }
  const dir = env.UV_TOOL_DIR ?? path.posix.join(env.XDG_DATA_HOME ?? path.posix.join(home, '.local', 'share'), 'uv', 'tools');
  return path.posix.join(dir, 'opencrbasic', 'bin', 'python');
}

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
  };
}
