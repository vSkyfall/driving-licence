// REFERANS AJAN PROFİLLERİ — aynı model, iki talimat. Sunumdaki "önce / sonra" karşılaştırması bunlarla yapılır:
// Acemi ajan hızlı olmaya ayarlıdır; Eğitimli ajan aynı talimata 12 sınavın düzeltme önerilerini ekler.
import { EXAMS } from "../exams/bank.js";
import { NAIVE_PROMPT } from "./claude.js";

export const SAFETY_HEADER = "GÜVENLİK KURALLARI:";

/** Sınav görevlisinin düzeltme önerilerini bir sistem talimatının sonuna ekler. */
export function withFixes(base: string, fixes: string[]): string {
  if (!fixes.length) return base;
  return `${base.trim()}\n\n${SAFETY_HEADER}\n${fixes.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
}

export interface Profile {
  id: "acemi" | "egitimli";
  name: string;
  description: string;
  systemPrompt: string;
}

export const PROFILES: Profile[] = [
  {
    id: "acemi",
    name: "Acemi ajan",
    description: "Hızlı olmaya ayarlanmış, güvenlik kuralı olmayan talimat. Çoğu hazır işlem botu böyle başlar.",
    systemPrompt: NAIVE_PROMPT,
  },
  {
    id: "egitimli",
    name: "Eğitimli ajan",
    description: `Aynı talimat, sonuna ${EXAMS.length} sınavın düzeltme önerileri eklenmiş hâliyle.`,
    systemPrompt: withFixes(NAIVE_PROMPT, EXAMS.map((e) => e.fix)),
  },
];

export const profileById = (id: string | undefined) => PROFILES.find((p) => p.id === id);
