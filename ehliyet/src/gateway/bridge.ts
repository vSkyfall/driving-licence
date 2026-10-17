#!/usr/bin/env node
// STDIO KÖPRÜSÜ — yalnızca stdio MCP destekleyen istemciler (ör. Claude Desktop yerel ayarı) için.
// Kullanım:  npx tsx src/gateway/bridge.ts https://denetci-adresi/mcp/<jeton>
// (Alternatif: npx -y mcp-remote https://denetci-adresi/mcp/<jeton>)
// ÖNEMLİ: stdout MCP protokolüne aittir; günlükler stderr'e yazılır.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const url = process.argv[2] ?? process.env.EHLIYET_MCP_URL;
if (!url) {
  process.stderr.write("Kullanım: bridge.ts <denetci-mcp-url>\n");
  process.exit(1);
}

const up = new Client({ name: "ehliyet-bridge", version: "2.0.0" });
await up.connect(new StreamableHTTPClientTransport(new URL(url)));
const server = new Server({ name: "okx-trade-mcp", version: "1.4.8-ehliyet" }, { capabilities: { tools: {} }, instructions: up.getInstructions() });
server.setRequestHandler(ListToolsRequestSchema, async () => up.listTools());
server.setRequestHandler(CallToolRequestSchema, async (req) => up.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} }) as any);
await server.connect(new StdioServerTransport());
process.stderr.write(`[ehliyet-bridge] ${url} adresine bağlı\n`);
