#!/usr/bin/env node
// Regenerate src/catalog.json from the live Relaystation MCP catalog.
//
// The hot set is whatever the lean surface (POST /mcp) advertises; each tool's
// definition is sourced verbatim from the full roster (POST /mcp/full) so the
// schemas we serve locally can never drift from what the hosted server serves.
//
// Introspection (initialize + tools/list) on the hosted server is presence-only
// auth, so a dummy bearer is enough to read the catalog — no real credential is
// used here or committed.
//
//   node scripts/generate-catalog.mjs [--base https://api.relaystation.ai]
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseArgIdx = process.argv.indexOf('--base');
const BASE = (baseArgIdx !== -1 && process.argv[baseArgIdx + 1]) || 'https://api.relaystation.ai';

async function rpc(path, method, params = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // presence-only auth on introspection; value is irrelevant + not stored
      Authorization: 'Bearer catalog-generator',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method} @ ${path}: ${JSON.stringify(body.error)}`);
  return body.result;
}

console.error(`Fetching catalog from ${BASE} …`);

// 1) hot-set membership from the lean surface
const lean = await rpc('/mcp', 'tools/list');
const hotNames = lean.tools.map((t) => t.name);
console.error(`hot set: ${hotNames.length} tools`);

// 2) authoritative definitions from the full roster
const full = await rpc('/mcp/full', 'tools/list');
const byName = new Map(full.tools.map((t) => [t.name, t]));

// 3) client-facing guidance + version, straight from the hosted initialize
const init = await rpc('/mcp', 'initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'relaystation-catalog-generator', version: '1' },
});

const tools = [];
const missing = [];
for (const name of hotNames) {
  const def = byName.get(name) ?? lean.tools.find((t) => t.name === name);
  if (!byName.has(name)) missing.push(name);
  tools.push(def);
}
if (missing.length) {
  console.error(`WARN: ${missing.length} hot tool(s) absent from /mcp/full, used lean def: ${missing.join(', ')}`);
}

const catalog = {
  source: `${BASE}/mcp/full`,
  upstreamServerInfo: init.serverInfo ?? null,
  upstreamProtocolVersion: init.protocolVersion ?? null,
  instructions: init.instructions ?? '',
  tools,
};

const out = join(__dirname, '..', 'src', 'catalog.json');
await writeFile(out, JSON.stringify(catalog, null, 2) + '\n');
console.error(`Wrote ${tools.length} tools to ${out}`);
