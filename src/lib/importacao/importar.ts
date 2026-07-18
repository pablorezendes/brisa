/**
 * Importação do dataset.json (gerado por extrair_dados.py) para o banco.
 * Segue references/07-importacao-e-corte.md:
 *  - ordem: empreendimento → unidade → locatário → contrato → recebimento
 *    → temporada → caixa;
 *  - matching de recebimentos em cascata (empreendimento+localização,
 *    depois empreendimento+locatário, senão exceção);
 *  - valores ×100 → centavos; taxa ×10000 → bps.
 *
 * Idempotência por RECARGA TOTAL: os dados importáveis são apagados e
 * reimportados a cada execução. Válido até o corte — depois do corte a
 * importação é desativada (o sistema passa a ser a fonte de verdade).
 */
import type { PrismaClient } from "@prisma/client";
import {
  competencia,
  mesParaNumero,
  normalizar,
  normalizarCpfCnpj,
} from "../dominio/normalizacao";
import { paraCentavos, paraCentavosOuZero } from "../dominio/dinheiro";

// ---------- Tipos do dataset.json ----------

interface RecebimentoOrigem {
  mes: number;
  mes_ref: string;
  empreendimento: string | null;
  locatario: string | null;
  localizacao: string | number | null;
  cpf_cnpj: string | null;
  valor: number | null;
  iptu: number | null;
  cond: number | null;
  recebido: number | null;
  data_pagamento: string | null;
  competencia: string | null;
  via: string | null;
  observacao: string | null;
  taxa_comissao: number | null;
  base_calculo_planilha: number | null;
  comissao_planilha: number | null;
}

interface RentRollOrigem {
  grupo: string | null;
  locatario: string | null;
  localizacao: string | number | null;
  valor: number | null;
  iptu: number | null;
  cond: number | null;
  mes_reajuste: string | null;
  dia_vencimento: number | null;
  observacao: string | null;
}

interface ContratoOrigem {
  grupo: string | null;
  locatario: string | null;
  localizacao: string | number | null;
  mes_reajuste: string | null;
  status_contrato: string | null;
}

interface LancamentoOrigem {
  linha: number;
  secao: string | null;
  data: string | null;
  valor: number | null;
  descricao: string | null;
  local?: string | null;
}

export interface Dataset {
  recebimentos: RecebimentoOrigem[];
  taxas_comissao: Record<string, number>;
  rent_roll: RentRollOrigem[];
  contratos: ContratoOrigem[];
  airbnb_apuracao: Record<
    string,
    Record<string, Record<string, number | null>>
  >;
  livro_caixa: Record<
    string,
    Record<"saida_ac" | "saida_ch" | "entrada" | "receb_dinheiro", LancamentoOrigem[]>
  >;
  centros_de_custo: Record<string, string[]>;
}

export interface Excecao {
  tipo: string;
  detalhe: string;
}

export interface ResultadoImportacao {
  empreendimentos: number;
  unidades: number;
  locatarios: number;
  contratos: number;
  recebimentos: number;
  lancamentosCaixa: number;
  apuracoesTemporada: number;
  categorias: number;
  excecoes: Excecao[];
}

const ANO_OPERACAO = 2026; // ano das abas RECEB / CONTA_AC do dataset atual

export async function importarDataset(
  prisma: PrismaClient,
  ds: Dataset
): Promise<ResultadoImportacao> {
  const excecoes: Excecao[] = [];

  // ---------- 0) recarga total (ordem respeita FKs) ----------
  await prisma.$transaction([
    prisma.recebimento.deleteMany(),
    prisma.fechamentoMensal.deleteMany(),
    prisma.limpeza.deleteMany(),
    prisma.despesaTemporada.deleteMany(),
    prisma.recebimentoTemporada.deleteMany(),
    prisma.unidadeTemporada.deleteMany(),
    prisma.apuracaoTemporadaHistorica.deleteMany(),
    prisma.contrato.deleteMany(),
    prisma.unidade.deleteMany(),
    prisma.locatario.deleteMany(),
    prisma.empreendimento.deleteMany(),
    prisma.parametroComissao.deleteMany(),
    prisma.lancamentoCaixa.deleteMany(),
    prisma.categoriaCentroCusto.deleteMany(),
  ]);

  // caches por chave normalizada
  const empPorNome = new Map<string, string>(); // nomeNorm -> id
  const locPorNome = new Map<string, string>(); // nomeNorm -> id
  // unidade: `${empId}|${identNorm}` -> id
  const unidadePorChave = new Map<string, string>();
  // contratos por unidade (na ordem de criação)
  const contratosPorUnidade = new Map<
    string,
    { id: string; locatarioNorm: string | null }[]
  >();

  async function obterEmpreendimento(nome: string): Promise<string> {
    const chave = normalizar(nome);
    const existente = empPorNome.get(chave);
    if (existente) return existente;
    const criado = await prisma.empreendimento.create({
      data: { nome: chave },
    });
    empPorNome.set(chave, criado.id);
    return criado.id;
  }

  async function obterLocatario(
    nome: string,
    cpfCnpj?: string | null
  ): Promise<string> {
    const chave = normalizar(nome);
    const existente = locPorNome.get(chave);
    if (existente) {
      if (cpfCnpj) {
        await prisma.locatario.updateMany({
          where: { id: existente, cpfCnpj: null },
          data: { cpfCnpj: normalizarCpfCnpj(cpfCnpj) },
        });
      }
      return existente;
    }
    const criado = await prisma.locatario.create({
      data: {
        nome: nome.trim(),
        nomeNorm: chave,
        cpfCnpj: normalizarCpfCnpj(cpfCnpj),
      },
    });
    locPorNome.set(chave, criado.id);
    return criado.id;
  }

  async function obterUnidade(
    empId: string,
    identificacao: string,
    tipo = "comercial"
  ): Promise<string> {
    const chave = `${empId}|${normalizar(identificacao)}`;
    const existente = unidadePorChave.get(chave);
    if (existente) return existente;
    const criada = await prisma.unidade.create({
      data: {
        empreendimentoId: empId,
        identificacao: normalizar(identificacao),
        tipo,
      },
    });
    unidadePorChave.set(chave, criada.id);
    return criada.id;
  }

  async function criarContrato(dados: {
    unidadeId: string;
    locatarioNorm: string | null;
    locatarioId: string | null;
    valorBase?: number;
    iptu?: number;
    cond?: number;
    diaVencimento?: number | null;
    mesReajuste?: number | null;
    status?: string;
    observacao?: string | null;
  }): Promise<string> {
    const criado = await prisma.contrato.create({
      data: {
        unidadeId: dados.unidadeId,
        locatarioId: dados.locatarioId,
        valorBase: dados.valorBase ?? 0,
        iptu: dados.iptu ?? 0,
        condominio: dados.cond ?? 0,
        diaVencimento: dados.diaVencimento ?? null,
        mesReajuste: dados.mesReajuste ?? null,
        status: dados.status ?? "ativo",
        observacao: dados.observacao ?? null,
      },
    });
    const lista = contratosPorUnidade.get(dados.unidadeId) ?? [];
    lista.push({ id: criado.id, locatarioNorm: dados.locatarioNorm });
    contratosPorUnidade.set(dados.unidadeId, lista);
    return criado.id;
  }

  function textoLocalizacao(v: string | number | null): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  }

  function statusContrato(s: string | null): string {
    const n = normalizar(s);
    if (!n || n === "OK") return "ativo";
    if (n.includes("ACORDO")) return "acordo";
    if (n.includes("ENCERR") || n.includes("SAIU")) return "encerrado";
    return n.toLowerCase();
  }

  // ---------- 1) CONTRATOS (aba CONTRATOS define emp/unidade/locatário) ----------
  for (const c of ds.contratos) {
    if (!c.grupo) continue;
    const empId = await obterEmpreendimento(c.grupo);
    const ident = textoLocalizacao(c.localizacao);
    if (!ident) {
      excecoes.push({
        tipo: "contrato_sem_localizacao",
        detalhe: `${c.grupo} / ${c.locatario ?? "?"} — sem localização; ignorado`,
      });
      continue;
    }
    const unidadeId = await obterUnidade(empId, ident);
    const locNorm = normalizar(c.locatario);
    const desocupado = !locNorm || locNorm === "DESOCUPADO";
    const locatarioId = desocupado ? null : await obterLocatario(c.locatario!);
    await criarContrato({
      unidadeId,
      locatarioId,
      locatarioNorm: desocupado ? null : locNorm,
      mesReajuste: mesParaNumero(c.mes_reajuste),
      status: statusContrato(c.status_contrato),
    });
  }

  // ---------- 2) RENT ROLL (Plan1 traz os VALORES; merge por localização) ----------
  // índice global de unidades por identificação normalizada
  const unidadePorIdent = new Map<string, string[]>();
  for (const [chave, id] of unidadePorChave) {
    const ident = chave.split("|")[1];
    const lista = unidadePorIdent.get(ident) ?? [];
    lista.push(id);
    unidadePorIdent.set(ident, lista);
  }

  for (const rr of ds.rent_roll) {
    const ident = textoLocalizacao(rr.localizacao);
    if (!ident) continue;
    const identNorm = normalizar(ident);
    const candidatas = unidadePorIdent.get(identNorm) ?? [];
    const valores = {
      valorBase: paraCentavosOuZero(rr.valor),
      iptu: paraCentavosOuZero(rr.iptu),
      cond: paraCentavosOuZero(rr.cond),
      diaVencimento:
        rr.dia_vencimento !== null && rr.dia_vencimento !== undefined
          ? Math.round(rr.dia_vencimento)
          : null,
      mesReajuste: mesParaNumero(rr.mes_reajuste),
      observacao: rr.observacao ?? null,
    };

    if (candidatas.length === 1) {
      const contratos = contratosPorUnidade.get(candidatas[0]) ?? [];
      if (contratos.length > 0) {
        // atualiza o contrato vigente (último criado) com os valores do rent roll
        const alvo = contratos[contratos.length - 1];
        await prisma.contrato.update({
          where: { id: alvo.id },
          data: {
            valorBase: valores.valorBase,
            iptu: valores.iptu,
            condominio: valores.cond,
            diaVencimento: valores.diaVencimento,
            // CONTRATOS é autoridade do mês de reajuste; completa se faltar
            ...(valores.mesReajuste !== null
              ? { mesReajuste: valores.mesReajuste }
              : {}),
            observacao: valores.observacao,
          },
        });
        continue;
      }
    }
    if (candidatas.length > 1) {
      excecoes.push({
        tipo: "rent_roll_localizacao_ambigua",
        detalhe: `${ident} aparece em ${candidatas.length} empreendimentos; valores não aplicados automaticamente`,
      });
      continue;
    }
    // sem contrato correspondente: cria emp (do grupo) + unidade + contrato
    if (!rr.grupo) {
      excecoes.push({
        tipo: "rent_roll_sem_grupo",
        detalhe: `${ident} sem grupo e sem contrato correspondente; ignorado`,
      });
      continue;
    }
    const empId = await obterEmpreendimento(rr.grupo);
    const unidadeId = await obterUnidade(empId, ident);
    const locNorm = normalizar(rr.locatario);
    const desocupado = !locNorm || locNorm === "DESOCUPADO";
    await criarContrato({
      unidadeId,
      locatarioId: desocupado ? null : await obterLocatario(rr.locatario!),
      locatarioNorm: desocupado ? null : locNorm,
      ...valores,
    });
    excecoes.push({
      tipo: "rent_roll_sem_contrato",
      detalhe: `${rr.grupo} / ${ident} — contrato criado a partir do rent roll (não consta na aba CONTRATOS)`,
    });
  }

  // ---------- 3) RECEBIMENTOS (matching em cascata) ----------
  let recebimentosImportados = 0;
  for (const r of ds.recebimentos) {
    if (!r.empreendimento) {
      excecoes.push({
        tipo: "recebimento_sem_empreendimento",
        detalhe: `aba ${r.mes_ref}: ${r.locatario ?? "?"} / ${r.localizacao ?? "?"} — ignorado`,
      });
      continue;
    }
    const empId = await obterEmpreendimento(r.empreendimento);
    const ident = textoLocalizacao(r.localizacao);
    const identNorm = normalizar(ident);
    const locNorm = normalizar(r.locatario);
    const agregado = identNorm === "TODOS";

    // resolve contrato em cascata
    let contratoId: string | null = null;

    // (a) empreendimento + localização
    if (ident) {
      const unidadeId = unidadePorChave.get(`${empId}|${identNorm}`);
      if (unidadeId) {
        const contratos = contratosPorUnidade.get(unidadeId) ?? [];
        const porLocatario = locNorm
          ? contratos.find((c) => c.locatarioNorm === locNorm)
          : undefined;
        contratoId =
          porLocatario?.id ??
          (contratos.length > 0 ? contratos[contratos.length - 1].id : null);
        if (!contratoId) {
          contratoId = await criarContrato({
            unidadeId,
            locatarioId: locNorm ? await obterLocatario(r.locatario!, r.cpf_cnpj) : null,
            locatarioNorm: locNorm || null,
          });
        }
      }
    }

    // (b) empreendimento + locatário
    if (!contratoId && locNorm) {
      for (const [chave, unidadeId] of unidadePorChave) {
        if (!chave.startsWith(`${empId}|`)) continue;
        const contratos = contratosPorUnidade.get(unidadeId) ?? [];
        const achado = contratos.find((c) => c.locatarioNorm === locNorm);
        if (achado) {
          contratoId = achado.id;
          break;
        }
      }
    }

    // (c) cria vínculo automaticamente e registra exceção p/ revisão
    if (!contratoId) {
      const identFinal = ident ?? (locNorm ? r.locatario!.trim() : "AVULSO");
      const unidadeId = await obterUnidade(
        empId,
        identFinal,
        agregado ? "temporada" : "comercial"
      );
      contratoId = await criarContrato({
        unidadeId,
        locatarioId: locNorm && !agregado ? await obterLocatario(r.locatario!, r.cpf_cnpj) : null,
        locatarioNorm: locNorm && !agregado ? locNorm : null,
      });
      excecoes.push({
        tipo: agregado ? "recebimento_agregado" : "recebimento_sem_contrato",
        detalhe: `aba ${r.mes_ref}: ${r.empreendimento} / ${identFinal} — vínculo criado automaticamente; revisar`,
      });
    }

    const mesLancamento = competencia(ANO_OPERACAO, r.mes);
    const comp = r.competencia
      ? r.competencia.slice(0, 7)
      : mesLancamento;

    await prisma.recebimento.create({
      data: {
        contratoId,
        empreendimentoId: empId,
        mesLancamento,
        competencia: comp,
        valor: paraCentavosOuZero(r.valor),
        iptu: paraCentavosOuZero(r.iptu),
        cond: paraCentavosOuZero(r.cond),
        recebido: paraCentavos(r.recebido),
        dataPagamento: r.data_pagamento ? r.data_pagamento.slice(0, 10) : null,
        via: r.via ? normalizar(r.via) : null,
        taxaComissaoBps: Math.round((r.taxa_comissao ?? 0.1) * 10000),
        observacao: r.observacao ?? null,
        origemAgregada: agregado,
      },
    });
    recebimentosImportados++;
  }

  // ---------- 4) parâmetros de comissão por mês ----------
  for (const [abrev, taxa] of Object.entries(ds.taxas_comissao)) {
    const mes = mesParaNumero(abrev);
    if (!mes) continue;
    await prisma.parametroComissao.create({
      data: {
        vigencia: competencia(ANO_OPERACAO, mes),
        taxaBps: Math.round(taxa * 10000),
      },
    });
  }

  // ---------- 5) apuração histórica da temporada (anos < ano da operação) ----
  // O ano corrente vem do núcleo (linha AIRBNB/TODOS) e do módulo operacional;
  // só o histórico entra aqui. 2025 não tem TOTAL DESPESA rotulado → null.
  let apuracoes = 0;
  for (const [anoStr, meses] of Object.entries(ds.airbnb_apuracao)) {
    const ano = Number(anoStr);
    if (ano >= ANO_OPERACAO) continue;
    for (const [abrev, tot] of Object.entries(meses)) {
      const mes = mesParaNumero(abrev);
      if (!mes) continue;
      const receita = tot["TOTAL RECEB"];
      const despesa = tot["TOTAL DESPESA"];
      if (receita === null || receita === undefined) continue;
      await prisma.apuracaoTemporadaHistorica.create({
        data: {
          ano,
          mes,
          receita: paraCentavosOuZero(receita),
          despesa: paraCentavos(despesa),
        },
      });
      apuracoes++;
    }
  }

  // ---------- 6) livro-caixa ----------
  let lancamentos = 0;
  for (const [aba, faixas] of Object.entries(ds.livro_caixa)) {
    const mes = mesParaNumero(aba);
    const anoMatch = aba.match(/(\d{4})/);
    const ano = anoMatch ? Number(anoMatch[1]) : ANO_OPERACAO;
    if (!mes) {
      excecoes.push({
        tipo: "caixa_aba_nao_reconhecida",
        detalhe: `aba "${aba}" — mês não reconhecido; ignorada`,
      });
      continue;
    }
    const mesRef = competencia(ano, mes);

    const bandas: {
      faixa: keyof typeof faixas;
      centro: string;
      tipo: string;
    }[] = [
      { faixa: "saida_ac", centro: "AL", tipo: "SAIDA" },
      { faixa: "saida_ch", centro: "CH", tipo: "SAIDA" },
      { faixa: "entrada", centro: "GERAL", tipo: "ENTRADA" },
      { faixa: "receb_dinheiro", centro: "GERAL", tipo: "RECEB_DINHEIRO" },
    ];

    for (const banda of bandas) {
      for (const l of faixas[banda.faixa] ?? []) {
        if (l.valor === null || l.valor === undefined) continue;
        const ehRecebDinheiro = banda.tipo === "RECEB_DINHEIRO";
        await prisma.lancamentoCaixa.create({
          data: {
            mesReferencia: mesRef,
            centroCusto: banda.centro,
            tipo: banda.tipo,
            categoria: banda.tipo === "SAIDA" ? l.secao ?? null : null,
            data: l.data ? l.data.slice(0, 10) : null,
            valor: paraCentavosOuZero(l.valor),
            descricao: ehRecebDinheiro ? null : l.descricao ?? null,
            cliente: ehRecebDinheiro ? l.descricao ?? null : null,
            local: ehRecebDinheiro ? l.local ?? null : null,
          },
        });
        lancamentos++;
      }
    }
  }

  // ---------- 7) legenda de categorias por centro de custo ----------
  let categorias = 0;
  const mapaCentro: Record<string, string> = {
    ANTONIO_LAURA: "AL",
    CHACARA_BRISA: "CH",
  };
  for (const [chave, lista] of Object.entries(ds.centros_de_custo)) {
    const centro = mapaCentro[chave] ?? chave;
    for (const nome of lista) {
      await prisma.categoriaCentroCusto.create({
        data: { centroCusto: centro, nome },
      });
      categorias++;
    }
  }

  return {
    empreendimentos: empPorNome.size,
    unidades: unidadePorChave.size,
    locatarios: locPorNome.size,
    contratos: await prisma.contrato.count(),
    recebimentos: recebimentosImportados,
    lancamentosCaixa: lancamentos,
    apuracoesTemporada: apuracoes,
    categorias,
    excecoes,
  };
}
