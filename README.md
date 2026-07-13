# Relaystation MCP server

A single hosted [Model Context Protocol](https://modelcontextprotocol.io) server for
**pay-per-call agent infrastructure** — one endpoint, one prepaid balance, no per-tool signup.

**Connect:** `https://api.relaystation.ai/mcp` (streamable HTTP)

Relaystation is a prepaid storage and utility provider for agents and developers. Pay per call
with [x402](https://www.x402.org) (EIP-3009 USDC/EURC on Base — the wallet is the identity, no
account required) or a prepaid balance. No subscription, no minimum, no commitment.

The **hosted** server is the primary way to connect — there's nothing to run and it stays current
automatically. This repo also ships a tiny **local stdio connector** (`docker run` / `npx`) for MCP
clients that only speak stdio, or that prefer to hold the key in their own environment. The local
connector introspects offline (no key needed) and forwards tool calls to the hosted API.

## Capabilities

One MCP server covers the whole surface (150+ tools):

- **Storage & handoff (Batons)** — durable, shareable storage objects agents create, append to,
  read, cryptographically witness, and hand off to other agents or people. Presets: file drop,
  burn-after-read pass, shared scratchpad, state checkpoint, tamper-evident ledger, vector index.
  `create_baton`, `read_baton`, `append_to_baton`, `mint_token`, `witness_baton`, …
- **Messaging (Courier)** — ask a human (Telegram / email / SMS) and wait for the reply, message
  another agent, mint and read agent inboxes. `ask_operator`, `notify_operator`, `message_agent`, …
- **Compute (cputools)** — PDF (merge/split/OCR/render/watermark/sign-verify), data & CSV ETL
  (SQL/filter/join/pivot), images, audio/video, text, QR/barcodes, archives, office-doc conversion,
  chart/invoice/QR generators, and multi-step pipelines. `pdf_ocr`, `data_sql`, `image_convert`, …
- **Language & AI tasks** — translate, summarize, extract-to-JSON, classify, proofread, rewrite,
  keywords, title, sentiment, JSON-repair; task-based, cost-plus. `llm_translate`, `llm_extract`, …
- **Documents & identity** — send PDFs for e-signature, verify government IDs (KYC), screen names
  against sanctions/PEP lists, create binding agent contracts. `esigndoc_create`, `idverify_create`,
  `screen_name`, `create_contract`, …
- **Retrieval** — vector search + one-call grounded RAG over a vector baton.

It's a **search-first** surface: a small hot set is listed directly; use `search_tools` to find any
tool, `describe_tool` for its schema, and `call_tool` to run it. The complete roster is at
<https://api.relaystation.ai/mcp/full>.

## Connect

### OAuth 2.1 (recommended)

Add the URL as a connector in your MCP client and approve once in the browser (Google / GitHub /
Wallet — a wallet connects instantly and pays per call). The agent then spends your prepaid balance
headlessly; revoke anytime at <https://app.relaystation.ai> → Connected agents.

```json
{
  "mcpServers": {
    "relaystation": {
      "type": "streamable-http",
      "url": "https://api.relaystation.ai/mcp"
    }
  }
}
```

### API key fallback

For clients without OAuth, append your key as a query parameter:

```
https://api.relaystation.ai/mcp?key=rs_live_...
```

Sign up and mint a key at <https://app.relaystation.ai>.

### Local stdio connector (Docker / npx)

For clients that only support stdio servers, run the connector locally. It serves the hot-set tool
definitions (generated from <https://api.relaystation.ai/mcp/full>, so schemas never drift) and
forwards every tool call to the hosted API using `RELAYSTATION_API_KEY` from the environment.
Introspection (`initialize`, `tools/list`) works with **no key** — the key is only needed to run a
tool. Mint one at <https://app.relaystation.ai>.

**Docker:**

```bash
docker build -t relaystation-mcp .
docker run --rm -i -e RELAYSTATION_API_KEY=rs_live_... relaystation-mcp
```

**npx** (once published to npm):

```bash
npx relaystation-mcp
```

MCP client config (stdio):

```json
{
  "mcpServers": {
    "relaystation": {
      "command": "npx",
      "args": ["-y", "relaystation-mcp"],
      "env": { "RELAYSTATION_API_KEY": "rs_live_..." }
    }
  }
}
```

Or point `command` at `docker` with `args: ["run", "--rm", "-i", "-e", "RELAYSTATION_API_KEY", "relaystation-mcp"]`.

To refresh the local tool snapshot from the live catalog: `npm run generate`.

### x402 per call (no account)

Every billable tool is also a plain HTTP route that accepts an `X-Payment` header (x402 v2,
EIP-3009). One call carries the payload plus the payment; the wallet is the identity.

## Discovery

- MCP manifest: <https://api.relaystation.ai/.well-known/mcp.json>
- Full tool roster: <https://api.relaystation.ai/mcp/full>
- OpenAPI 3.1: <https://api.relaystation.ai/openapi.json>
- Agent summary: <https://api.relaystation.ai/llms.txt> · long form: `/llms-full.txt`
- ARD catalog: <https://api.relaystation.ai/.well-known/ai-catalog.json>
- Registry entry: [`ai.relaystation/relaystation`](https://registry.modelcontextprotocol.io/v0/servers?search=relaystation)
- Docs: <https://relaystation.ai/api-reference>

## Pricing

Pay-per-call, prepaid. Sub-cent pricing on most compute ops; storage priced by bytes × time ×
egress, quoted and frozen at purchase. No subscription, no minimum. See
<https://relaystation.ai/pricing>.

## Links

- Website: <https://relaystation.ai>
- Dashboard: <https://app.relaystation.ai>
- `server.json` (MCP Registry): [`server.json`](./server.json)
