import type { FonteUnificacao, LinhaUnificada } from "./tipos";

export const ROTULOS_ORIGEM_DADOS = {
  PLANILHA: "Planilhas Excel",
  WIDESYS: "Widesys",
  BRISA: "Brisa · origem a confirmar",
} as const;
export type OrigemDados = keyof typeof ROTULOS_ORIGEM_DADOS;
type RegistroOrigem = Pick<FonteUnificacao, "origem" | "proveniencia"> & { origens?: string[] };

/** Origem de armazenamento não comprova inclusão manual. Um grupo pode ter várias fontes. */
export function origensDoRegistro(registro: RegistroOrigem): OrigemDados[] {
  const origens = registro.origens?.length ? registro.origens : [registro.proveniencia?.arquivo ? "PLANILHA" : registro.origem];
  return [...new Set(origens.map((origem): OrigemDados => origem === "PLANILHA" ? "PLANILHA" : origem === "WIDESYS" ? "WIDESYS" : "BRISA"))];
}

export function correspondeOrigem(registro: RegistroOrigem, filtro?: string): boolean {
  return !filtro || !Object.hasOwn(ROTULOS_ORIGEM_DADOS, filtro) || origensDoRegistro(registro).includes(filtro as OrigemDados);
}

export function resumirOrganizacaoFinanceira(linhas: LinhaUnificada[]) {
  const dominios = (["RECEBER", "PAGAR", "MOVIMENTO"] as const).map(dominio => {
    const grupo = linhas.filter(l => l.dominio === dominio);
    return {
      dominio, total: grupo.length,
      incluidos: grupo.filter(l => l.contabiliza).length,
      pendentes: grupo.filter(l => l.estado === "PENDENTE" || l.estado === "REVISAR").length,
      inconsistentes: grupo.filter(l => l.estado === "QUARENTENA").length,
      vinculados: grupo.filter(l => l.estado === "VINCULADO").length,
      ausentes: grupo.filter(l => l.estado === "AUSENTE").length,
      semEfeito: grupo.filter(l => l.estado === "ATIVO" && !l.contabiliza).length,
    };
  });
  const financeiros = linhas.filter(l => ["RECEBER", "PAGAR", "MOVIMENTO"].includes(l.dominio));
  const origens = (Object.keys(ROTULOS_ORIGEM_DADOS) as OrigemDados[]).map(origem => ({
    origem, quantidade: financeiros.filter(l => origensDoRegistro(l).includes(origem)).length,
  }));
  return { dominios, origens, pendentes: dominios.reduce((n, d) => n + d.pendentes, 0), inconsistentes: dominios.reduce((n, d) => n + d.inconsistentes, 0) };
}
