// The Logger panel's HTML: a webview in the spirit of LoggerNet's Connect screen. No `vscode`
// import, so node:test can check it. The page talks to the extension with postMessage only; the
// messages are typed below and handled in logger.ts.

export type PanelRequest =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'selectLogger'; port: string }
  | { type: 'collect'; table: string }
  | { type: 'watchStart'; table: string; interval: number }
  | { type: 'watchStop' }
  | { type: 'filePut' }
  | { type: 'fileGet'; name: string }
  | { type: 'fileDelete'; name: string }
  | { type: 'fileRun'; name: string }
  | { type: 'stop'; deleteData: boolean }
  | { type: 'resume' }
  | { type: 'clockCheck' }
  | { type: 'clockSet' }
  | { type: 'terminal'; text: string };

export const PANEL_REQUESTS: ReadonlySet<string> = new Set([
  'ready', 'refresh', 'selectLogger', 'collect', 'watchStart', 'watchStop', 'filePut', 'fileGet',
  'fileDelete', 'fileRun', 'stop', 'resume', 'clockCheck', 'clockSet', 'terminal',
]);

// Requests come from the webview, so they are checked before being acted on.
export function parseRequest(message: unknown): PanelRequest | undefined {
  if (!message || typeof message !== 'object' || !PANEL_REQUESTS.has(String((message as { type?: unknown }).type))) {
    return undefined;
  }
  const m = message as Record<string, unknown>;
  const text = (key: string): boolean => typeof m[key] === 'string' && (m[key] as string).length > 0;
  switch (m.type) {
    case 'selectLogger':
      return text('port') ? (m as PanelRequest) : undefined;
    case 'collect':
      return text('table') ? (m as PanelRequest) : undefined;
    case 'watchStart':
      return text('table') && typeof m.interval === 'number' && m.interval >= 0.1 ? (m as PanelRequest) : undefined;
    case 'fileGet':
    case 'fileDelete':
    case 'fileRun':
      return text('name') ? (m as PanelRequest) : undefined;
    case 'stop':
      return typeof m.deleteData === 'boolean' ? (m as PanelRequest) : undefined;
    case 'terminal':
      return typeof m.text === 'string' ? (m as PanelRequest) : undefined;
    default:
      return m as PanelRequest;
  }
}

export function renderPanel(nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Logger</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 12px 24px; }
  header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  header h1 { font-size: 1.1em; margin: 0 12px 0 0; }
  select, input, button { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
  #status { margin-left: auto; opacity: 0.8; }
  #status.error { color: var(--vscode-errorForeground); opacity: 1; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-top: 12px; }
  section { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px 12px; }
  section h2 { font-size: 1em; margin: 4px 0 8px; display: flex; gap: 8px; align-items: center; }
  section h2 .actions { margin-left: auto; display: flex; gap: 4px; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 2px 8px 2px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  td.num { text-align: right; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; }
  dt { opacity: 0.75; }
  dd { margin: 0; word-break: break-word; }
  .row-actions button { padding: 1px 6px; margin-right: 2px; }
  .changed { background: var(--vscode-editor-findMatchHighlightBackground); }
  pre#term { background: var(--vscode-terminal-background, var(--vscode-editor-background)); color: var(--vscode-terminal-foreground, inherit); min-height: 120px; max-height: 300px; overflow: auto; padding: 6px; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); }
  .muted { opacity: 0.7; }
</style>
</head>
<body>
<header>
  <h1>Logger</h1>
  <select id="logger" title="Attached logger"></select>
  <button id="refresh" class="secondary" title="Read everything again">Refresh</button>
  <span id="status"></span>
</header>
<div class="grid">
  <section id="station">
    <h2>Station<span class="actions"><button id="stop" class="secondary">Stop program</button><button id="resume" class="secondary">Resume</button></span></h2>
    <dl id="info"><dt class="muted">No logger read yet</dt><dd></dd></dl>
  </section>
  <section>
    <h2>Clock<span class="actions"><button id="clockCheck" class="secondary">Check</button><button id="clockSet">Set to UTC</button></span></h2>
    <dl id="clock"><dt class="muted">Not checked</dt><dd></dd></dl>
  </section>
  <section>
    <h2>Tables</h2>
    <table><thead><tr><th>Table</th><th class="num">Records</th><th>Interval</th><th></th></tr></thead><tbody id="tables"></tbody></table>
  </section>
  <section>
    <h2>Files<span class="actions"><button id="filePut">Send file…</button></span></h2>
    <table><thead><tr><th>Name</th><th class="num">Size</th><th>Flags</th><th></th></tr></thead><tbody id="files"></tbody></table>
  </section>
  <section>
    <h2>Monitor
      <span class="actions">
        <select id="watchTable"></select>
        <input id="watchInterval" type="number" min="0.1" step="0.1" value="1" style="width:4em" title="seconds">
        <button id="watchToggle">Start</button>
      </span>
    </h2>
    <div class="muted" id="watchInfo">Live values of one table, read every interval.</div>
    <table><tbody id="watch"></tbody></table>
  </section>
  <section>
    <h2>Terminal</h2>
    <pre id="term"></pre>
    <input id="termInput" placeholder="Command, then Enter (Enter alone shows the prompt)" style="width:100%">
  </section>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const send = (message) => vscode.postMessage(message);
  let watching = false;
  let previous = {};

  function setStatus(text, error) { $('status').textContent = text || ''; $('status').className = error ? 'error' : ''; }
  function cell(text, cls) { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; return td; }
  function button(label, onClick, secondary) {
    const b = document.createElement('button'); b.textContent = label; if (secondary) b.className = 'secondary';
    b.addEventListener('click', onClick); return b;
  }
  function fillList(id, pairs) {
    const list = $(id); list.replaceChildren();
    for (const [k, v] of pairs) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      list.append(dt, dd);
    }
  }
  function bytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; }

  $('refresh').addEventListener('click', () => send({ type: 'refresh' }));
  $('logger').addEventListener('change', (e) => send({ type: 'selectLogger', port: e.target.value }));
  $('stop').addEventListener('click', () => send({ type: 'stop', deleteData: false }));
  $('resume').addEventListener('click', () => send({ type: 'resume' }));
  $('clockCheck').addEventListener('click', () => send({ type: 'clockCheck' }));
  $('clockSet').addEventListener('click', () => send({ type: 'clockSet' }));
  $('filePut').addEventListener('click', () => send({ type: 'filePut' }));
  $('watchToggle').addEventListener('click', () => {
    if (watching) { send({ type: 'watchStop' }); return; }
    const table = $('watchTable').value;
    if (table) send({ type: 'watchStart', table, interval: Number($('watchInterval').value) || 1 });
  });
  $('termInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    send({ type: 'terminal', text: e.target.value + '\\r' });
    e.target.value = '';
  });

  window.addEventListener('message', (event) => {
    const m = event.data;
    switch (m.type) {
      case 'busy': setStatus(m.text, false); break;
      case 'error': setStatus(m.text, true); break;
      case 'ports': {
        const select = $('logger'); select.replaceChildren();
        for (const p of m.ports) {
          const o = document.createElement('option'); o.value = p.port; o.textContent = (p.model || '?') + ' on ' + p.port;
          o.selected = p.port === m.selected; select.append(o);
        }
        if (!m.ports.length) { const o = document.createElement('option'); o.textContent = 'No logger attached'; select.append(o); }
        break;
      }
      case 'info': {
        const i = m.info;
        fillList('info', [
          ['Model', i.model || '?'], ['Serial number', i.serial_number], ['Station name', i.station_name || ''],
          ['OS version', i.os_version], ['Program', (i.program_name || 'none') + (i.state ? ' (' + i.state + ')' : '')],
          ['Power-up program', i.power_up_program || 'none'], ['Compiled', i.compile_time], ['Compile result', (i.compile_result || '').trim()],
        ]);
        break;
      }
      case 'clock': fillList('clock', [['Logger', m.logger], ['Host UTC', m.host], ['Offset', m.offset.toFixed(3) + ' s']]); break;
      case 'tables': {
        const body = $('tables'); body.replaceChildren();
        const select = $('watchTable'); const current = select.value; select.replaceChildren();
        for (const t of m.tables) {
          const tr = document.createElement('tr');
          const actions = document.createElement('td'); actions.className = 'row-actions';
          if (t.size > 1) actions.append(button('Collect…', () => send({ type: 'collect', table: t.name })));
          tr.append(cell(t.name), cell(String(t.size), 'num'), cell(t.interval ? t.interval + ' s' : 'event'), actions);
          body.append(tr);
          const o = document.createElement('option'); o.value = t.name; o.textContent = t.name; select.append(o);
        }
        select.value = current || (m.tables.some((t) => t.name === 'Public') ? 'Public' : '');
        break;
      }
      case 'files': {
        const body = $('files'); body.replaceChildren();
        for (const f of m.files) {
          const tr = document.createElement('tr');
          if (f.drive) { tr.append(cell(f.name), cell(bytes(f.size) + ' free', 'num'), cell(''), cell('')); body.append(tr); continue; }
          const actions = document.createElement('td'); actions.className = 'row-actions';
          actions.append(button('Get', () => send({ type: 'fileGet', name: f.name }), true));
          if (/\\.(cr\\d+|cr1x|crb|cr300|cr350)$/i.test(f.name) && !/\\.crb$/i.test(f.name)) actions.append(button('Run', () => send({ type: 'fileRun', name: f.name }), true));
          actions.append(button('Delete', () => send({ type: 'fileDelete', name: f.name }), true));
          tr.append(cell(f.name), cell(bytes(f.size), 'num'), cell(f.flags.join(', ')), actions);
          body.append(tr);
        }
        break;
      }
      case 'watchState':
        watching = m.running; $('watchToggle').textContent = watching ? 'Stop' : 'Start';
        $('watchInfo').textContent = watching ? 'Watching ' + m.table + '…' : 'Live values of one table, read every interval.';
        if (watching) { previous = {}; $('watch').replaceChildren(); $('watchTable').value = m.table; }
        break;
      case 'watch': {
        const r = m.row; const body = $('watch'); body.replaceChildren();
        $('watchInfo').textContent = 'Record ' + r.record + ' at ' + r.time;
        for (const [k, v] of Object.entries(r.values)) {
          const tr = document.createElement('tr');
          const shown = typeof v === 'number' && !Number.isInteger(v) ? v.toPrecision(6) : String(v);
          const value = cell(shown, 'num'); if (k in previous && previous[k] !== v) value.classList.add('changed');
          tr.append(cell(k), value); body.append(tr);
        }
        previous = r.values;
        break;
      }
      case 'terminal': { const t = $('term'); t.textContent += m.text; t.scrollTop = t.scrollHeight; break; }
    }
  });
  send({ type: 'ready' });
</script>
</body>
</html>`;
}
