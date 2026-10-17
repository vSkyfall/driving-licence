// ÖRNEK YARIŞMACI AJANI — EHLİYET'e uzaktan nasıl bağlanılacağını gösterir (ve uçtan uca test içindir).
//  - Sohbet ucu:   POST /chat  {message, session_id, mcp_url}   ya da   POST /v1/chat/completions (OpenAI biçimi)
//  - OKX araçları: EHLİYET'in verdiği MCP URL'sine Streamable HTTP ile bağlanır (okx-trade-mcp yerine)
// Beyni kural tabanlıdır (LLM yok). Gerçek bir ajanda burası sizin LLM döngünüzdür.
//
//   npx tsx examples/demo-agent.ts --port 5055 --variant naive --mcp http://localhost:4747/mcp/<jeton>
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ScriptBrain } from "../src/candidates/script-brain.js";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const PORT = Number(arg("port", "5055"));
const VARIANT = (arg("variant", "naive") as "naive" | "hardened") ?? "naive";
const FIXED_MCP = arg("mcp", process.env.MCP_URL);

const sessions = new Map<string, { brain: ScriptBrain; mcp: Client }>();

async function session(id: string, mcpUrl: string) {
  const key = `${id}|${mcpUrl}`;
  let s = sessions.get(key);
  if (!s) {
    const mcp = new Client({ name: `demo-agent-${VARIANT}`, version: "1.0.0" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
    s = { mcp, brain: new ScriptBrain(VARIANT, (tool, args) => mcp.callTool({ name: tool, arguments: args })) };
    sessions.set(key, s);
  }
  return s;
}

http
  .createServer(async (req, res) => {
    let raw = "";
    for await (const ch of req) raw += ch;
    try {
      const body = raw ? JSON.parse(raw) : {};
      const openai = req.url?.includes("/chat/completions");
      const sid = String(body.session_id ?? body.user ?? req.headers["x-ehliyet-session"] ?? "default");
      const msg = openai ? String(body.messages?.at(-1)?.content ?? "") : String(body.message ?? "");
      const mcpUrl = FIXED_MCP ?? body.mcp_url ?? req.headers["x-ehliyet-mcp-url"];
      if (!mcpUrl) throw new Error("MCP URL yok (--mcp ya da gövdede mcp_url)");
      const reply = await (await session(sid, mcpUrl)).brain.handle(msg);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(openai ? { choices: [{ message: { role: "assistant", content: reply } }] } : { reply }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  })
  .listen(PORT, () => console.log(`demo ajan (${VARIANT}) http://localhost:${PORT}/chat`));
