import { createHash } from "node:crypto";

import { paraCentavos, paraCentavosOuZero } from "../dominio/dinheiro";
import { competencia, mesParaNumero, normalizar } from "../dominio/normalizacao";
import type { Dataset } from "../importacao/importar";

export type DatasetProveniencia = Pick<Dataset, "recebimentos" | "livro_caixa"> & {
  origem?: { relatorio?: string; conta_ac?: string };
};

export type RecebimentoParaProveniencia = {
  id: string;
  empreendimentoNome: string;
  unidadeIdentificacao: string;
  locatarioNome: string | null;
  mesLancamento: string;
  competencia: string;
  valor: number;
  iptu: number;
  cond: number;
  recebido: number | null;
  dataPagamento: string | null;
  via: string | null;
  taxaComissaoBps: number;
  observacao: string | null;
  origemAgregada: boolean;
};

export type CaixaParaProveniencia = {
  id: string;
  mesReferencia: string;
  centroCusto: string;
  tipo: string;
  categoria: string | null;
  data: string | null;
  valor: number;
  descricao: string | null;
  cliente: string | null;
  local: string | null;
};

export type ProvenienciaPlanilha = {
  arquivo: string;
  /** Referência da aba; recebimentos usam o mês preservado no dataset. */
  aba: string;
  /** O extrator original só preservou a linha Excel do livro-caixa. */
  linha: number | null;
  /** Índice zero-based dentro de recebimentos ou da faixa do livro-caixa. */
  indiceDataset: number;
  faixa: string | null;
  hash: string;
};

export type ResumoProveniencia = {
  fonte: number;
  atuais: number;
  identificados: number;
  ambiguos: number;
  semCorrespondencia: number;
};

type Fonte = { hash: string; proveniencia: ProvenienciaPlanilha };

function hash(campos: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(campos)).digest("hex");
}

function arquivoSeguro(valor: string | undefined, padrao: string): string {
  return valor?.split(/[\\/]/).at(-1)?.trim() || padrao;
}

function hashRecebimento(r: Omit<RecebimentoParaProveniencia, "id">): string {
  return hash([
    "PLANILHA_RECEBIMENTO_V1",
    normalizar(r.empreendimentoNome), normalizar(r.unidadeIdentificacao),
    // A linha agregada de temporada não representa um locatário individual.
    r.origemAgregada ? null : normalizar(r.locatarioNome),
    r.mesLancamento, r.competencia, r.valor, r.iptu, r.cond, r.recebido,
    r.dataPagamento, r.via, r.taxaComissaoBps, r.observacao, r.origemAgregada,
  ]);
}

function hashCaixa(r: Omit<CaixaParaProveniencia, "id">): string {
  return hash([
    "PLANILHA_CAIXA_V1", r.mesReferencia, r.centroCusto, r.tipo, r.categoria,
    r.data, r.valor, r.descricao, r.cliente, r.local,
  ]);
}

function indexar<T>(itens: T[], chave: (item: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const key = chave(item);
    const grupo = mapa.get(key) ?? [];
    grupo.push(item);
    mapa.set(key, grupo);
  }
  return mapa;
}

function reconciliar<T extends { id: string }>(
  fonte: Fonte[], atuais: T[], fingerprint: (item: T) => string,
): { mapa: Map<string, ProvenienciaPlanilha>; resumo: ResumoProveniencia } {
  const origens = indexar(fonte, (item) => item.hash);
  const destinos = indexar(atuais, fingerprint);
  const mapa = new Map<string, ProvenienciaPlanilha>();
  let ambiguos = 0;
  let semCorrespondencia = 0;
  for (const [chave, candidatos] of destinos) {
    const correspondentes = origens.get(chave) ?? [];
    if (!correspondentes.length) semCorrespondencia += candidatos.length;
    else if (candidatos.length !== 1 || correspondentes.length !== 1) {
      // Nem a ordem de leitura nem um UUID aleatório provam a linha original.
      ambiguos += candidatos.length;
    } else {
      mapa.set(candidatos[0].id, correspondentes[0].proveniencia);
    }
  }
  return {
    mapa,
    resumo: { fonte: fonte.length, atuais: atuais.length, identificados: mapa.size, ambiguos, semCorrespondencia },
  };
}

/**
 * Recupera somente a proveniência comprovável pelo conteúdo atual. Não modifica
 * dados, não reimporta a planilha e não infere que registros sem match são novos:
 * eles também podem ser linhas da planilha alteradas posteriormente no sistema.
 */
export function reconstruirProvenienciaPlanilhas(
  dataset: DatasetProveniencia,
  atuais: { recebimentos: RecebimentoParaProveniencia[]; lancamentosCaixa: CaixaParaProveniencia[] },
) {
  const arquivoRecebimentos = arquivoSeguro(dataset.origem?.relatorio, "RELATORIO__FINAL_2026 (3).xlsx");
  const arquivoCaixa = arquivoSeguro(dataset.origem?.conta_ac, "CONTA AC.xlsx");
  const fonteRecebimentos: Fonte[] = [];
  dataset.recebimentos.forEach((r, indiceDataset) => {
    if (!r.empreendimento) return;
    const mesLancamento = competencia(2026, r.mes);
    const origemAgregada = normalizar(String(r.localizacao ?? "")) === "TODOS";
    const fingerprint = hashRecebimento({
      empreendimentoNome: r.empreendimento,
      unidadeIdentificacao: String(r.localizacao ?? r.locatario ?? "AVULSO"),
      locatarioNome: r.locatario,
      mesLancamento,
      competencia: r.competencia?.slice(0, 7) || mesLancamento,
      valor: paraCentavosOuZero(r.valor), iptu: paraCentavosOuZero(r.iptu), cond: paraCentavosOuZero(r.cond),
      recebido: paraCentavos(r.recebido), dataPagamento: r.data_pagamento?.slice(0, 10) ?? null,
      via: r.via ? normalizar(r.via) : null,
      taxaComissaoBps: Math.round((r.taxa_comissao ?? 0.1) * 10000),
      observacao: r.observacao ?? null, origemAgregada,
    });
    fonteRecebimentos.push({
      hash: fingerprint,
      proveniencia: {
        arquivo: arquivoRecebimentos, aba: `RECEB ${r.mes_ref}`, linha: null,
        indiceDataset, faixa: null, hash: fingerprint,
      },
    });
  });

  const fonteCaixa: Fonte[] = [];
  const faixas = [
    { faixa: "saida_ac", centroCusto: "AL", tipo: "SAIDA" },
    { faixa: "saida_ch", centroCusto: "CH", tipo: "SAIDA" },
    { faixa: "entrada", centroCusto: "GERAL", tipo: "ENTRADA" },
    { faixa: "receb_dinheiro", centroCusto: "GERAL", tipo: "RECEB_DINHEIRO" },
  ] as const;
  for (const [aba, bandas] of Object.entries(dataset.livro_caixa)) {
    const mes = mesParaNumero(aba);
    if (!mes) continue;
    const ano = Number(aba.match(/(\d{4})/)?.[1] ?? 2026);
    for (const { faixa, centroCusto, tipo } of faixas) {
      (bandas[faixa] ?? []).forEach((r, indiceDataset) => {
        if (r.valor === null || r.valor === undefined) return;
        const fingerprint = hashCaixa({
          mesReferencia: competencia(ano, mes), centroCusto, tipo,
          categoria: tipo === "SAIDA" ? r.secao ?? null : null,
          data: r.data?.slice(0, 10) ?? null, valor: paraCentavosOuZero(r.valor),
          descricao: tipo === "RECEB_DINHEIRO" ? null : r.descricao ?? null,
          cliente: tipo === "RECEB_DINHEIRO" ? r.descricao ?? null : null,
          local: tipo === "RECEB_DINHEIRO" ? r.local ?? null : null,
        });
        fonteCaixa.push({
          hash: fingerprint,
          proveniencia: {
            arquivo: arquivoCaixa, aba, linha: Number.isSafeInteger(r.linha) && r.linha > 0 ? r.linha : null,
            indiceDataset, faixa, hash: fingerprint,
          },
        });
      });
    }
  }

  const recebimentos = reconciliar(fonteRecebimentos, atuais.recebimentos, hashRecebimento);
  const caixa = reconciliar(fonteCaixa, atuais.lancamentosCaixa, hashCaixa);
  return {
    recebimentos: recebimentos.mapa,
    lancamentosCaixa: caixa.mapa,
    resumo: { recebimentos: recebimentos.resumo, lancamentosCaixa: caixa.resumo },
  };
}
