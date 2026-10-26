import type { FonteUnificacao } from "./tipos";

/** Só aceita assinaturas recalculadas a partir do mesmo conteúdo atual. */
export function hashFonteCorresponde(fonte: FonteUnificacao | null | undefined, hash: string | null | undefined): boolean {
  return !!fonte && !!hash && (fonte.hash === hash || !!fonte.hashesCompativeis?.includes(hash));
}
