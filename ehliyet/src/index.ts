// Kütüphane olarak kullanım (Node/Express siteleri için):
//   import { createEhliyetHandler, loadAll } from "ehliyet-denetci";
//   loadAll();
//   app.use(createEhliyetHandler({ basePath: "/ehliyet" }));
export { createEhliyetHandler, publicAudit } from "./api/handler.js";
export { loadAll, getAudit, listAudits, getEvents, verifyChain, bus } from "./store.js";
export { createAudit, startAudit, cancelAudit, submitReply, connectionInfo } from "./examiner/runner.js";
export { EXAMS, PRESETS } from "./exams/bank.js";
export { verify as verifyLicense, publicKeyInfo, badgeSvg, cardSvg } from "./license.js";
export type * from "./types.js";
