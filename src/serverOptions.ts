// Pure launch and settings helpers. No `vscode` import: node:test loads this module directly.

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
}

export function buildServerLaunch(cfg: LaunchSettings, baseEnv: NodeJS.ProcessEnv): LaunchCommand {
  return {
    command: cfg.pythonPath,
    args: [...cfg.serverArgs],
    env: { ...baseEnv, ...cfg.serverEnv },
  };
}

export function initializationOptions(cfg: ServerSettings): ServerSettings {
  return {
    entries: [...cfg.entries],
    exclude: [...cfg.exclude],
    logger: cfg.logger,
    encoding: cfg.encoding,
    debounceMs: cfg.debounceMs,
    analysisTimeoutMs: cfg.analysisTimeoutMs,
  };
}
