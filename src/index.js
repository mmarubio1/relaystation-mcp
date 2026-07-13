#!/usr/bin/env node
// Relaystation MCP connector — a minimal, zero-dependency stdio proxy.
//
// Introspection (initialize, tools/list) is answered locally from a committed
// snapshot of the hosted catalog (src/catalog.json), so it works with ZERO
// environment variables — no network, no credentials. Tool INVOCATIONS are
// forwarded to the hosted Relaystation server over HTTPS, authenticated with
// RELAYSTATION_API_KEY from the environment; if that key is unset we return a
// clear, actionable auth-required error instead of calling out.
//
// stdio transport: newline-delimited JSON-RPC 2.0 on stdin/stdout. stderr is
// for logs only — never write protocol traffic to stdout's siblings.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(__dirname, 'catalog.json'), 'utf8'));

const UPSTREAM_BASE = process.env.RELAYSTATION_API_BASE || 'https://api.relaystation.ai';
// Forward invocations to the full roster: the hot tools call directly and the
// search_tools/describe_tool/call_tool facade can reach the complete catalog.
const UPSTREAM_MCP = `${UPSTREAM_BASE}/mcp/full`;

const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const DEFAULT_PROTOCOL = '2024-11-05';

const SERVER_INFO = {
  name: 'relaystation',
  version: pkg.version,
  title: 'Relaystation',
  description:
    'Pay-per-call agent infrastructure: prepaid file storage & handoff (Batons), ' +
    'compute utilities (PDF/CSV/image/data/archive/generate), agent<->human/agent ' +
    'messaging, e-signature, KYC, and account self-service. One endpoint, one balance, one key.',
};

function log(...args) {
  process.stderr.write(`[relaystation-mcp] ${args.join(' ')}\n`);
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, res) {
  send({ jsonrpc: '2.0', id, result: res });
}

function error(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  send({ jsonrpc: '2.0', id, error: err });
}

function negotiateProtocol(requested) {
  if (typeof requested === 'string' && SUPPORTED_PROTOCOLS.has(requested)) return requested;
  return DEFAULT_PROTOCOL;
}

// Return an MCP tool-result (not a protocol error) so the client renders the
// guidance cleanly in the tool output.
function toolError(id, text) {
  result(id, { content: [{ type: 'text', text }], isError: true });
}

async function forwardToolCall(id, params) {
  const apiKey = process.env.RELAYSTATION_API_KEY;
  if (!apiKey) {
    return toolError(
      id,
      'RELAYSTATION_API_KEY is not set. This connector needs a Relaystation API key to run ' +
        'tools. Create one at https://app.relaystation.ai and set it in the environment, e.g. ' +
        'RELAYSTATION_API_KEY=rs_live_... (introspection — initialize / tools/list — works ' +
        'without a key; only tool execution needs one).',
    );
  }

  let res;
  try {
    res = await fetch(UPSTREAM_MCP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: params.name, arguments: params.arguments ?? {} },
      }),
    });
  } catch (e) {
    return error(id, -32000, `upstream request failed: ${String(e?.message || e)}`);
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return error(id, -32000, `upstream returned non-JSON (HTTP ${res.status})`);
  }

  if (body.error) {
    // Pass the hosted server's JSON-RPC error through verbatim so the real
    // reason (auth, balance, validation, 402) reaches the client unaltered.
    return error(id, body.error.code ?? -32000, body.error.message ?? 'upstream error', body.error.data);
  }
  return result(id, body.result ?? {});
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: negotiateProtocol(params?.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: catalog.instructions || undefined,
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notifications get no response

    case 'ping':
      return result(id, {});

    case 'tools/list':
      return result(id, { tools: catalog.tools });

    case 'tools/call': {
      if (!params || typeof params.name !== 'string') {
        return error(id, -32602, 'params.name (string) is required');
      }
      return forwardToolCall(id, params);
    }

    case 'prompts/list':
      return result(id, { prompts: [] });

    case 'resources/list':
      return result(id, { resources: [] });

    case 'resources/templates/list':
      return result(id, { resourceTemplates: [] });

    default:
      if (isNotification) return; // ignore unknown notifications
      return error(id, -32601, `method not found: ${method}`);
  }
}

// --- stdio read loop: split on newlines, buffer partial lines ---
let buffer = '';
let inputEnded = false;
const pending = new Set(); // in-flight request handlers

function track(p) {
  pending.add(p);
  p.finally(() => {
    pending.delete(p);
    if (inputEnded && pending.size === 0) process.exit(0);
  });
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      error(null, -32700, 'parse error');
      continue;
    }
    // Best-effort; a throw here must not kill the process.
    const p = Promise.resolve()
      .then(() => handle(msg))
      .catch((e) => {
        log('handler error:', String(e?.stack || e));
        if (msg && msg.id !== undefined && msg.id !== null) {
          error(msg.id, -32603, 'internal error');
        }
      });
    track(p);
  }
});
// Client disconnected: exit once any in-flight forwards have drained.
process.stdin.on('end', () => {
  inputEnded = true;
  if (pending.size === 0) process.exit(0);
});

log(`ready — ${catalog.tools.length} tools, upstream ${UPSTREAM_MCP}`);
