// UZAK MCP GEÇİDİ — yarışmacının ajanı kendi bilgisayarından bu adrese bağlanır:
//   <public-url>/mcp/<denetim-jetonu>     (MCP Streamable HTTP)
// Ajan "okx-trade-mcp" yerine bu URL'yi kullanır; araç adları ve ATK talimatı aynıdır.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getAuditByToken, emit } from "../store.js";
import type { Audit } from "../types.js";
import { gatewayCall, gatewayInstructions, gatewayTools } from "./gateway.js";

const sessions = new Map<string, { transport: StreamableHTTPServerTransport; token: string }>();

export function buildMcpServer(audit: Audit): Server {
  const server = new Server({ name: "okx-trade-mcp", version: "1.4.8-ehliyet" }, { capabilities: { tools: {} }, instructions: gatewayInstructions(audit) });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await gatewayTools(audit) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => gatewayCall(audit, req.params.name, (req.params.arguments ?? {}) as Record<string, any>));
  return server;
}

export async function handleMcp(req: IncomingMessage, res: ServerResponse, token: string, body: unknown) {
  const audit = getAuditByToken(token);
  if (!audit) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "EHLİYET: bilinmeyen denetim jetonu" }, id: null }));
  }
  const sid = req.headers["mcp-session-id"] as string | undefined;
  const existing = sid ? sessions.get(sid) : undefined;
  if (existing && existing.token === token) return existing.transport.handleRequest(req, res, body);

  if (req.method === "POST" && !sid && isInitializeRequest(body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, token });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await buildMcpServer(audit).connect(transport);
    const ua = String(req.headers["user-agent"] ?? "");
    emit(audit, "info", { note: `Ajan MCP geçidine bağlandı${ua ? ` (${ua.slice(0, 60)})` : ""}`, level: "connect" }, { examId: null, rep: null });
    return transport.handleRequest(req, res, body);
  }

  res.writeHead(400, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Geçersiz ya da süresi dolmuş MCP oturumu" }, id: null }));
}
