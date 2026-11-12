import type { FonteUnificacao, LinhaUnificada } from "./tipos";

export const ROTULOS_ORIGEM_DADOS = {
  WIDESYS: "Widesys",
  MANUAL: "Cadastro manual Brisa",
  BRISA: "Brisa",
} as const;
export type OrigemDados = keyof typeof ROTULOS_ORIGEM_DADOS;
type RegistroOrigem = Pick<FonteUnificacao, "origem" | "proveniencia"> & { origens?: string[] };

/** A origem visível agrupa as cargas arquivadas com os demais registros do Brisa. */
export function origensDoRegistro(registro: RegistroOrigem): OrigemDados[] {
  const manualComprovado = registro.origem === "BRISA" && registro.proveniencia?.tipo === "CADASTRO_MANUAL";
  const origens = registro.origens?.length ? registro.origens : [manualComprovado ? "MANUAL" : registro.origem];
  return [...new Set(origens.map((origem): OrigemDados => origem === "WIDESYS" || origem === "MANUAL" ? origem : "BRISA"))];
}

export function filtroOrigemVisivel(valor?: string): OrigemDados | "" {
  return valor && Object.hasOwn(ROTULOS_ORIGEM_DADOS, valor) ? valor as OrigemDados : "";
}

export function correspondeOrigem(registro: RegistroOrigem, filtro?: string): boolean {
  const origem = filtroOrigemVisivel(filtro);
  return !origem || origensDoRegistro(registro).includes(origem);
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
