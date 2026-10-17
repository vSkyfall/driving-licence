// Sözleşmeyi derler ve ABI + bytecode'u src/chain/EhliyetRegistry.json'a yazar.
//   npm run avalanche:compile
// Çalışma anında derleyici gerekmez; bu JSON depoda durur.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "../src/config.js";

const require = createRequire(import.meta.url);
const solc = require("solc");

const file = path.join(ROOT, "contracts", "EhliyetRegistry.sol");
const input = {
  language: "Solidity",
  sources: { "EhliyetRegistry.sol": { content: fs.readFileSync(file, "utf8") } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const c = out.contracts["EhliyetRegistry.sol"].EhliyetRegistry;
const target = path.join(ROOT, "src", "chain", "EhliyetRegistry.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify({ compiler: solc.version(), evmVersion: "paris", abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
console.log(`Derlendi (${solc.version()}): ${path.relative(ROOT, target)} · bytecode ${(c.evm.bytecode.object.length / 2).toLocaleString("tr-TR")} bayt`);
