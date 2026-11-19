// The Logger side bar: one flat tree per view. Each view starts empty, so its welcome text shows a
// Scan (or Connect) button; once filled, its title shows Refresh. Nodes carry the `oln` row they
// were built from, which the commands in logger.ts act on.
import * as vscode from 'vscode';
import {
  clockOutOfSync,
  describeOffset,
  isProgramFile,
  isSecretSetting,
  type ClockInfo,
  type FileEntry,
  type ProgramInfo,
  type SettingRow,
  type TableInfo,
} from './loggerCli';

export type ViewId = 'station' | 'files' | 'tables' | 'public' | 'settings';
export const VIEW_IDS: readonly ViewId[] = ['station', 'files', 'tables', 'public', 'settings'];

export class Node extends vscode.TreeItem {
  constructor(
    label: string,
    readonly data?: unknown,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}

export class ListView implements vscode.TreeDataProvider<Node> {
  private nodes: Node[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(readonly id: ViewId) {}

  // Empty (`undefined`) shows the view's welcome text again; the context key picks the title action.
  set(nodes: Node[] | undefined): void {
    this.nodes = nodes ?? [];
    void vscode.commands.executeCommand('setContext', `openloggernet.filled.${this.id}`, nodes !== undefined);
    this.changed.fire();
  }

  get filled(): boolean {
    return this.nodes.length > 0;
  }

  getTreeItem(node: Node): Node {
    return node;
  }

  getChildren(): Node[] {
    return this.nodes;
  }
}

function icon(name: string, color?: string): vscode.ThemeIcon {
  return new vscode.ThemeIcon(name, color ? new vscode.ThemeColor(color) : undefined);
}

function row(label: string, value: string, iconName: string, extra: Partial<Node> = {}): Node {
  const node = new Node(label);
  node.description = value;
  node.tooltip = `${label}: ${value}`;
  node.iconPath = icon(iconName);
  Object.assign(node, extra);
  return node;
}

export function stationNodes(port: string, info: ProgramInfo, clock: ClockInfo | undefined, media: vscode.Uri): Node[] {
  const outdated = info.os_latest?.outdated === true;
  const nodes = [
    row('Port', port, 'plug', {
      contextValue: 'port',
      command: { command: 'openloggernet.selectLogger', title: 'Select Logger' },
      tooltip: 'Serial port of the logger; click to choose another',
    }),
    row('Model', info.model ?? '?', 'circuit-board'),
    row('Serial number', info.serial_number, 'symbol-number'),
    row('Station name', info.station_name ?? '', 'tag'),
    row('OS version', info.os_version + (outdated ? ` — ${info.os_latest?.latest} available` : ''), outdated ? 'warning' : 'check', {
      contextValue: outdated ? 'osOutdated' : 'os',
      tooltip: outdated
        ? `${info.os_version} is older than ${info.os_latest?.latest}, the newest OS known for the ${info.model}`
        : info.os_latest?.latest
          ? `Up to date (newest known: ${info.os_latest.latest})`
          : 'No newest version known for this model',
    }),
    row('Program', `${info.program_name || 'none'}${info.state ? ` (${info.state})` : ''}`, 'file-code'),
    row('Power-up program', info.power_up_program || 'none', 'debug-restart'),
    row('Compiled', String(info.compile_time).replace(/\+00:00$/, ''), 'clock'),
    row('Compile result', info.compile_result.trim(), /error|fail/i.test(info.compile_result) ? 'error' : 'pass', {
      tooltip: info.compile_result.trim(),
    }),
  ];
  if (clock) {
    const offset = clock.offset_after ?? clock.offset;
    const off = clockOutOfSync(offset);
    nodes.push(
      row('Clock', `${(clock.logger_after ?? clock.logger).replace(/\+00:00$/, '')} (${offset >= 0 ? '+' : ''}${offset.toFixed(1)} s)`, off ? 'warning' : 'watch', {
        contextValue: off ? 'clockOff' : 'clock',
        tooltip: off ? `The logger clock is ${describeOffset(offset)} the host's UTC` : 'Within 1 s of the host UTC',
      }),
    );
  }
  nodes[0].iconPath = iconPair(media, 'port');
  return nodes;
}

export function fileNodes(files: FileEntry[], info: ProgramInfo | undefined, media: vscode.Uri): Node[] {
  const nodes: Node[] = [];
  if (info) {
    const running = row('Running', `${info.program_name || 'no program'}${info.state ? ` (${info.state})` : ''}`, 'play-circle', {
      contextValue: 'program',
      tooltip: info.compile_result.trim(),
    });
    nodes.push(running);
  }
  for (const f of files) {
    if (f.drive) {
      nodes.push(row(f.name, `${bytes(f.size)} free`, 'database', { contextValue: 'drive' }));
      continue;
    }
    const node = new Node(f.name.replace(/^[A-Z]+:/, ''), f);
    node.description = [bytes(f.size), ...f.flags].join(' · ');
    node.tooltip = `${f.name}\n${bytes(f.size)}, ${f.modified}${f.flags.length ? `\n${f.flags.join(', ')}` : ''}`;
    node.contextValue = isProgramFile(f.name) ? 'programFile' : 'file';
    node.iconPath = f.flags.includes('running') ? icon('play', 'charts.green') : iconPair(media, isProgramFile(f.name) ? 'crbasic-file' : 'file');
    nodes.push(node);
  }
  return nodes;
}

export function tableNodes(tables: TableInfo[], media: vscode.Uri): Node[] {
  return tables.map((t) => {
    const node = new Node(t.name, t);
    node.description = `room for ${t.size} · ${t.interval ? `${t.interval} s` : 'event'} · ${t.fields.length} fields`;
    node.tooltip = t.fields.map((f) => `${f.name}${f.units ? ` (${f.units})` : ''}${f.processing ? ` ${f.processing}` : ''}`).join('\n');
    node.contextValue = 'table';
    node.iconPath = iconPair(media, 'table');
    return node;
  });
}

export function publicNodes(values: Record<string, unknown>, previous: Record<string, unknown>): Node[] {
  return Object.entries(values).map(([name, value]) => {
    const node = new Node(name, name);
    node.description = typeof value === 'number' && !Number.isInteger(value) ? value.toPrecision(6) : String(value);
    node.contextValue = 'variable';
    node.iconPath = icon(name in previous && previous[name] !== value ? 'circle-filled' : 'circle-outline', name in previous && previous[name] !== value ? 'charts.yellow' : undefined);
    node.tooltip = `Public.${name} = ${String(value)}\nClick to change it`;
    node.command = { command: 'openloggernet.setVariable', title: 'Set Value', arguments: [node] };
    return node;
  });
}

export function settingNodes(settings: SettingRow[]): Node[] {
  return settings.map((s) => {
    const label = s.name || `#${s.id}`;
    const node = new Node(label, s);
    const secret = isSecretSetting(s.name) && s.value;
    node.description = s.error ? `(${s.error})` : secret ? '••••••' : String(s.value ?? '');
    node.tooltip = [label, s.type, s.range && `range ${s.range}`, s.read_only && 'read-only', s.error].filter(Boolean).join(' · ');
    node.contextValue = s.read_only || s.error ? 'settingReadOnly' : 'setting';
    node.iconPath = icon(s.read_only ? 'lock' : 'settings');
    if (!s.read_only && !s.error) {
      node.command = { command: 'openloggernet.editSetting', title: 'Change Setting', arguments: [node] };
    }
    return node;
  });
}

export function iconPair(media: vscode.Uri, name: string): { light: vscode.Uri; dark: vscode.Uri } {
  return {
    light: vscode.Uri.joinPath(media, 'icons', 'light', `${name}.svg`),
    dark: vscode.Uri.joinPath(media, 'icons', 'dark', `${name}.svg`),
  };
}

export function bytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
}
