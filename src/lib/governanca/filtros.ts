import type { Prisma, PrismaClient } from "@prisma/client";
import type { TipoGovernanca } from "./tipos";
import type { FonteUnificacao } from "../unificacao/tipos";
type Banco = Pick<PrismaClient | Prisma.TransactionClient, "recursoGovernado">;
export async function idsGovernadosInativos(db: Banco, tipo: TipoGovernanca): Promise<string[]> {
  return (await db.recursoGovernado.findMany({ where: { tipo, status: { not: "ATIVO" } }, select: { origemId: true } })).map(r => r.origemId);
}
export async function filtroGovernanca(db: Banco, tipo: TipoGovernanca): Promise<{ id?: { notIn: string[] } }> {
  const ids = await idsGovernadosInativos(db, tipo);
  return ids.length ? { id: { notIn: ids } } : {};
}
export async function recursoEstaAtivo(db: Banco, tipo: TipoGovernanca, origemId: string) {
  const r = await db.recursoGovernado.findUnique({ where: { tipo_origemId: { tipo, origemId } }, select: { status: true } });
  return !r || r.status === "ATIVO";
}
export function filtrarFontesGovernadas(fontes: FonteUnificacao[], estados: { tipo: string; origemId: string; status: string }[]) {
  const inativos = new Set(estados.filter(e => e.status !== "ATIVO").map(e => `${e.tipo}:${e.origemId}`));
  return fontes.filter(f => {
    const tipo = f.dominio === "PESSOA" ? (f.origem === "BRISA" ? "LOCATARIO" : "PESSOA")
      : f.dominio === "IMOVEL" ? (f.origem === "BRISA" ? "UNIDADE" : "IMOVEL_LEGADO")
      : f.dominio === "MOVIMENTO" && f.origem === "BRISA" ? "CAIXA" : null;
    return !inativos.has(`TITULO:${f.chave}`) && !(tipo && inativos.has(`${tipo}:${f.origemId}`));
  });
}
