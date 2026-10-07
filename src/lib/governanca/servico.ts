import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { STATUS_BOLETO_ATIVOS } from "../dominio/boletos";
import { carregarFontesUnificacao } from "../unificacao/fontes";
import { projetarUnificados } from "../unificacao/reconciliacao";
import { recursoEstaAtivo } from "./filtros";
import { ErroGovernanca, validarIdentidade, type AtorGovernanca, type TipoGovernanca } from "./tipos";
import { montarPolitica, pode, carteiraIrrestrita } from "../acesso/politica";

type Tx = Prisma.TransactionClient;
type MovimentoVinculo = { tabela: "contrato" | "boleto" | "unidade" | "recebimento" | "unidadeTemporada"; campo: "locatarioId" | "unidadeId" | "empreendimentoId"; ids: string[]; de: string; para: string };
type Estado = { ativo?: boolean; movimentos?: MovimentoVinculo[] };
const chave = (tipo: TipoGovernanca, origemId: string) => ({ tipo_origemId: { tipo, origemId } });
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function autorizar(tx: Tx, ator: AtorGovernanca, conta = false, restaurar = false) {
  const usuario = await tx.usuario.findUnique({ where: { id: ator.id }, select: {
    id: true, perfil: true, ativo: true, acessoGlobal: true, permissoesExtras: true, permissoesNegadas: true,
    papelAcesso: { select: { ativo: true, permissoes: true } }, regrasAcesso: { select: { tipo: true, recursoId: true, efeito: true } },
  } });
  const politica = usuario ? montarPolitica(usuario) : null;
  if (restaurar && usuario?.perfil !== "ADMINISTRADOR") throw new ErroGovernanca("SOMENTE_ADMIN", "Somente um administrador pode restaurar ou desfazer.");
  if (!politica || !pode(politica, "governanca.editar") || !carteiraIrrestrita(politica) || (conta && !pode(politica, "contas.editar"))) throw new ErroGovernanca("SEM_PERMISSAO", "Seu acesso não permite esta operação. Atualize a sessão ou procure o administrador.");
}
function motivoValido(motivo: string) {
  const m = motivo.trim();
  if (m.length < 5 || m.length > 500) throw new ErroGovernanca("MOTIVO_INVALIDO", "Explique o motivo da decisão em 5 a 500 caracteres para preservar a auditoria.");
  return m;
}
async function entidade(tx: Tx, tipo: TipoGovernanca, id: string): Promise<{ id: string; nome: string; ativo?: boolean }> {
  let r;
  if (tipo === "PESSOA") r = await tx.pessoa.findUnique({ where: { id }, select: { id: true, nome: true, ativo: true } });
  if (tipo === "LOCATARIO") r = await tx.locatario.findUnique({ where: { id }, select: { id: true, nome: true } });
  if (tipo === "UNIDADE") { const u = await tx.unidade.findUnique({ where: { id } }); if (u) r = { id: u.id, nome: u.identificacao, ativo: u.ativo }; }
  if (tipo === "EMPREENDIMENTO") r = await tx.empreendimento.findUnique({ where: { id }, select: { id: true, nome: true, ativo: true } });
  if (tipo === "IMOVEL_LEGADO") { const i = await tx.imovelLegado.findUnique({ where: { id } }); if (i) r = { id: i.id, nome: i.nome ?? i.referencia ?? i.legadoId }; }
  if (tipo === "CAIXA") { const l = await tx.lancamentoCaixa.findUnique({ where: { id } }); if (l) r = { id: l.id, nome: l.descricao ?? "Lançamento de caixa" }; }
  if (tipo === "CONTA") { const c = await tx.contaBancaria.findUnique({ where: { id } }); if (c) r = { id: c.id, nome: c.apelido, ativo: c.ativa }; }
  if (tipo === "TITULO") { const f = (await carregarFontesUnificacao(tx)).find(f => f.chave === id && ["PAGAR", "RECEBER"].includes(f.dominio)); if (f) r = { id, nome: f.titulo }; }
  if (!r) throw new ErroGovernanca("NAO_ENCONTRADO", "Registro não encontrado.");
  return r;
}
async function vinculos(tx: Tx, tipo: TipoGovernanca, id: string): Promise<Record<string, number>> {
  if (tipo === "PESSOA") {
    const p = await tx.pessoa.findUniqueOrThrow({ where: { id } });
    const [locatarios, contratos, titulos, imoveis] = await Promise.all([
      tx.locatario.count({ where: { pessoaId: id } }), tx.contratoParteLegado.count({ where: { origem: p.origem, pessoaLegadoId: p.legadoId } }),
      tx.tituloFinanceiroLegado.count({ where: { origem: p.origem, pessoaLegadoId: p.legadoId } }), tx.imovelProprietarioLegado.count({ where: { pessoaId: id } }),
    ]); return { locatarios, contratos, titulos, imoveis };
  }
  if (tipo === "LOCATARIO") return { contratos: await tx.contrato.count({ where: { locatarioId: id } }), boletos: await tx.boleto.count({ where: { locatarioId: id } }) };
  if (tipo === "UNIDADE") return { contratos: await tx.contrato.count({ where: { unidadeId: id } }), temporada: await tx.unidadeTemporada.count({ where: { unidadeId: id } }) };
  if (tipo === "EMPREENDIMENTO") return { imoveis: await tx.unidade.count({ where: { empreendimentoId: id } }), titulos: await tx.recebimento.count({ where: { empreendimentoId: id } }) };
  if (tipo === "IMOVEL_LEGADO") {
    const i = await tx.imovelLegado.findUniqueOrThrow({ where: { id } });
    return { contratos: await tx.contratoLegado.count({ where: { origem: i.origem, imovelLegadoId: i.legadoId } }), proprietarios: await tx.imovelProprietarioLegado.count({ where: { imovelId: id } }) };
  }
  if (tipo === "CONTA") {
    const boletosBancariosAbertos = await tx.boleto.count({ where: { contaBancariaId: id, OR: [{ status: { in: [...STATUS_BOLETO_ATIVOS] } }, { conciliacaoStatus: "DIVERGENTE" }] } });
    const configuracao = await tx.configuracaoCobrancaSicoob.findUnique({ where: { contaBancariaId: id }, select: { contaLiquidacaoLegadoId: true, sistemaOrigem: true } });
    // Só relaciona o legado com evidência explícita, nunca por semelhança de número/apelido.
    const titulosLegadosAbertos = configuracao?.contaLiquidacaoLegadoId ? await tx.tituloFinanceiroLegado.count({ where: { origem: configuracao.sistemaOrigem, contaBancariaLegadoId: String(configuracao.contaLiquidacaoLegadoId), situacaoNormalizada: { in: ["PENDENTE", "VENCIDO", "PARCIAL"] } } }) : 0;
    return { titulosAbertos: boletosBancariosAbertos + titulosLegadosAbertos, boletosBancariosAbertos, titulosLegadosAbertos };
  }
  return {};
}
export async function previaGovernanca(db: PrismaClient, tipo: string, origemId: string) {
  validarIdentidade(tipo, origemId);
  return db.$transaction(async tx => {
    const registro = await entidade(tx, tipo, origemId);
    const estado = await tx.recursoGovernado.findUnique({ where: chave(tipo, origemId) });
    const referencias = await vinculos(tx, tipo, origemId);
    return { tipo, origemId, nome: registro.nome, status: estado?.status ?? (tipo === "CONTA" && registro.ativo === false ? "INATIVO" : "ATIVO"), versao: estado?.versao ?? 0, vinculos: referencias, podeExcluir: !["TITULO", "CONTA"].includes(tipo) && Object.values(referencias).every(n => n === 0), assinatura: hash({ registro, referencias, versao: estado?.versao ?? 0 }) };
  });
}
async function conferirPrevia(tx: Tx, tipo: TipoGovernanca, id: string, ator: AtorGovernanca) {
  // A ação de governança exige a versão exibida; chamadas internas também validam vínculos na transação.
  if (!ator.assinaturaPrevia) return;
  const registro = await entidade(tx, tipo, id);
  const referencias = await vinculos(tx, tipo, id);
  const estado = await tx.recursoGovernado.findUnique({ where: chave(tipo, id) });
  if (hash({ registro, referencias, versao: estado?.versao ?? 0 }) !== ator.assinaturaPrevia) throw new ErroGovernanca("PREVIA_DESATUALIZADA", "O registro ou seus vínculos mudou desde a conferência. Revise a prévia atualizada e confirme novamente.");
}
async function registrar(tx: Tx, tipo: TipoGovernanca, origemId: string, status: string, destinoId: string | null, motivo: string, ator: AtorGovernanca, estadoAnterior: Estado) {
  const anterior = await tx.recursoGovernado.findUnique({ where: chave(tipo, origemId) });
  const r = await tx.recursoGovernado.upsert({ where: chave(tipo, origemId),
    create: { tipo, origemId, status, destinoId, motivo, autorId: ator.id, estadoAnterior: JSON.stringify(estadoAnterior) },
    update: { status, destinoId, motivo, autorId: ator.id, estadoAnterior: JSON.stringify(estadoAnterior), versao: { increment: 1 } },
  });
  await tx.eventoGovernanca.create({ data: { recursoId: r.id, acao: status, estadoAnterior: anterior?.status ?? "ATIVO", estadoNovo: status, autorId: ator.id, motivo } });
  return r;
}
async function definirAtivo(tx: Tx, tipo: TipoGovernanca, id: string, ativo: boolean) {
  if (tipo === "PESSOA") await tx.pessoa.update({ where: { id }, data: { ativo } });
  if (tipo === "UNIDADE") await tx.unidade.update({ where: { id }, data: { ativo } });
  if (tipo === "EMPREENDIMENTO") await tx.empreendimento.update({ where: { id }, data: { ativo } });
}
export async function excluirRecurso(db: PrismaClient, tipo: string, id: string, motivo: string, ator: AtorGovernanca) {
  validarIdentidade(tipo, id); const m = motivoValido(motivo);
  if (["CONTA", "TITULO"].includes(tipo)) throw new ErroGovernanca("ACAO_INVALIDA", "Use a ação específica de inativação ou descarte.");
  return db.$transaction(async tx => {
    await autorizar(tx, ator);
    const atual = await tx.recursoGovernado.findUnique({ where: chave(tipo, id) });
    if (atual?.status === "EXCLUIDO") return atual;
    await conferirPrevia(tx, tipo, id, ator);
    if (atual && atual.status !== "ATIVO") throw new ErroGovernanca("REGISTRO_INATIVO", "Restaure o registro antes de realizar outra ação.");
    const registro = await entidade(tx, tipo, id);
    const refs = await vinculos(tx, tipo, id);
    if (Object.values(refs).some(n => n > 0)) throw new ErroGovernanca("TEM_VINCULOS", `Exclusão bloqueada: ${Object.entries(refs).filter(([,n]) => n).map(([k,n]) => `${n} ${k}`).join(", ")}. Compare uma mesclagem para preservar os vínculos.`);
    if (tipo === "CAIXA") { const l = await tx.lancamentoCaixa.findUniqueOrThrow({ where: { id } }); if (await tx.fechamentoMensal.count({ where: { mesLancamento: l.mesReferencia } })) throw new ErroGovernanca("MES_FECHADO", "O mês está fechado. A exclusão não pode alterar seu histórico."); }
    await definirAtivo(tx, tipo, id, false);
    return registrar(tx, tipo, id, "EXCLUIDO", null, m, ator, { ativo: registro.ativo });
  });
}
async function fingerprintFinanceiro(tx: Tx) {
  const r = await tx.recebimento.groupBy({ by: ["mesLancamento", "competencia"], _sum: { valor: true, iptu: true, cond: true, recebido: true }, _count: true, orderBy: [{ mesLancamento: "asc" }, { competencia: "asc" }] });
  return hash(r);
}
async function mover(tx: Tx, m: MovimentoVinculo, reverso = false) {
  const de = reverso ? m.para : m.de; const para = reverso ? m.de : m.para;
  // A allowlist é estática; nenhum identificador SQL vem do formulário.
  const tabelas = { contrato: "Contrato", boleto: "Boleto", unidade: "Unidade", recebimento: "Recebimento", unidadeTemporada: "UnidadeTemporada" };
  const pares = new Set(["contrato.locatarioId", "boleto.locatarioId", "contrato.unidadeId", "unidadeTemporada.unidadeId", "unidade.empreendimentoId", "recebimento.empreendimentoId"]);
  if (!pares.has(`${m.tabela}.${m.campo}`)) throw new ErroGovernanca("PLANO_INVALIDO", "Plano de vínculos inválido.");
  for (const id of m.ids) {
    const n = await tx.$executeRawUnsafe(`UPDATE "${tabelas[m.tabela]}" SET "${m.campo}" = ? WHERE id = ? AND "${m.campo}" = ?`, para, id, de);
    if (n !== 1) throw new ErroGovernanca("VINCULO_ALTERADO", "Um vínculo mudou após a operação. Nenhum vínculo foi alterado; revise antes de desfazer.");
  }
}
export async function mesclarRecursos(db: PrismaClient, tipo: string, origemId: string, destinoId: string, motivo: string, ator: AtorGovernanca) {
  validarIdentidade(tipo, origemId); validarIdentidade(tipo, destinoId); const m = motivoValido(motivo);
  if (origemId === destinoId) throw new ErroGovernanca("MESMA_ORIGEM", "Origem e destino precisam ser diferentes.");
  if (!["LOCATARIO", "UNIDADE", "EMPREENDIMENTO"].includes(tipo)) throw new ErroGovernanca("MAPEAMENTO_NECESSARIO", "Este cadastro legado exige mapear vínculos externos antes da mesclagem. Nenhum dado foi alterado.");
  return db.$transaction(async tx => {
    await autorizar(tx, ator);
    await conferirPrevia(tx, tipo, origemId, ator);
    // O efeito de uma FK pode alcançar permissões de pessoa, imóvel e empreendimento.
    // Até existir uma revisão de alcance completa, nenhuma ACL é migrada por inferência.
    if (await tx.regraAcesso.count()) throw new ErroGovernanca("CARTEIRAS_PROTEGIDAS", "Há carteiras com regras de acesso configuradas. A mesclagem está bloqueada para não ampliar acesso por vínculos indiretos. Solicite uma revisão explícita das abrangências; não remova permissões apenas para contornar este bloqueio.");
    if (!await recursoEstaAtivo(tx, tipo, origemId) || !await recursoEstaAtivo(tx, tipo, destinoId)) throw new ErroGovernanca("REGISTRO_INATIVO", "Origem e destino precisam estar ativos e não mesclados.");
    if (await tx.recursoGovernado.count({ where: { tipo, destinoId: origemId, status: "MESCLADO" } })) throw new ErroGovernanca("CADEIA_BLOQUEADA", "Desfaça mesclagens anteriores antes de mesclar este cadastro principal.");
    const origem = await entidade(tx, tipo, origemId); const destino = await entidade(tx, tipo, destinoId);
    if (destino.ativo === false) throw new ErroGovernanca("DESTINO_INATIVO", "Escolha um destino ativo.");
    const antes = await fingerprintFinanceiro(tx);
    const movimentos: MovimentoVinculo[] = [];
    const add = (tabela: MovimentoVinculo["tabela"], campo: MovimentoVinculo["campo"], registros: { id: string }[]) => movimentos.push({ tabela, campo, ids: registros.map(r => r.id), de: origemId, para: destinoId });
    if (tipo === "LOCATARIO") {
      const l = await tx.locatario.findUniqueOrThrow({ where: { id: origemId } });
      if (l.pessoaId) throw new ErroGovernanca("MAPEAMENTO_NECESSARIO", "A origem possui identidade Widesys vinculada. Reconcilie essa identidade antes da mesclagem.");
      if (await tx.boleto.count({ where: { locatarioId: origemId, status: { in: [...STATUS_BOLETO_ATIVOS] } } })) throw new ErroGovernanca("BOLETO_ATIVO", "Há cobrança bancária ativa na origem; não altere a identidade do pagador.");
      add("contrato", "locatarioId", await tx.contrato.findMany({ where: { locatarioId: origemId }, select: { id: true } }));
      add("boleto", "locatarioId", await tx.boleto.findMany({ where: { locatarioId: origemId }, select: { id: true } }));
    }
    if (tipo === "UNIDADE") {
      const a = await tx.unidade.findUniqueOrThrow({ where: { id: origemId } }); const b = await tx.unidade.findUniqueOrThrow({ where: { id: destinoId } });
      if (a.empreendimentoId !== b.empreendimentoId || a.tipo !== b.tipo) throw new ErroGovernanca("EMPREENDEDIMENTO_DIVERGENTE", "Mescle apenas imóveis do mesmo empreendimento e tipo, preservando a apuração.");
      add("contrato", "unidadeId", await tx.contrato.findMany({ where: { unidadeId: origemId }, select: { id: true } }));
      add("unidadeTemporada", "unidadeId", await tx.unidadeTemporada.findMany({ where: { unidadeId: origemId }, select: { id: true } }));
    }
    if (tipo === "EMPREENDIMENTO") {
      const unidades = await tx.unidade.findMany({ where: { empreendimentoId: origemId }, select: { id: true, identificacao: true } });
      if (await tx.unidade.count({ where: { empreendimentoId: destinoId, identificacao: { in: unidades.map(u => u.identificacao) } } })) throw new ErroGovernanca("IMOVEIS_CONFLITANTES", "Existem imóveis com a mesma identificação nos dois empreendimentos. Resolva-os antes da mesclagem.");
      const recebimentos = await tx.recebimento.findMany({ where: { empreendimentoId: origemId }, select: { id: true, mesLancamento: true } });
      if (await tx.fechamentoMensal.count({ where: { mesLancamento: { in: recebimentos.map(r => r.mesLancamento) } } })) throw new ErroGovernanca("MES_FECHADO", "A origem participa de um mês fechado. Mesclagem bloqueada para preservar a apuração por empreendimento.");
      add("unidade", "empreendimentoId", unidades); add("recebimento", "empreendimentoId", recebimentos);
    }
    for (const movimento of movimentos) await mover(tx, movimento);
    if (antes !== await fingerprintFinanceiro(tx)) throw new ErroGovernanca("TOTAIS_DIVERGENTES", "A verificação financeira falhou. A operação inteira foi revertida.");
    await definirAtivo(tx, tipo, origemId, false);
    return registrar(tx, tipo, origemId, "MESCLADO", destinoId, m, ator, { ativo: origem.ativo, movimentos });
  }, { timeout: 30000 });
}
export async function restaurarRecurso(db: PrismaClient, tipo: string, id: string, motivo: string, ator: AtorGovernanca) {
  validarIdentidade(tipo, id); const m = motivoValido(motivo);
  return db.$transaction(async tx => {
    await autorizar(tx, ator, tipo === "CONTA", true);
    const atual = await tx.recursoGovernado.findUnique({ where: chave(tipo, id) });
    await conferirPrevia(tx, tipo, id, ator);
    if (!atual && tipo === "CONTA") {
      const conta = await tx.contaBancaria.findUniqueOrThrow({ where: { id } });
      if (conta.ativa) return null;
      await tx.contaBancaria.update({ where: { id }, data: { ativa: true, atualizadoPorUsuarioId: ator.id } });
      return registrar(tx, tipo, id, "ATIVO", null, m, ator, {});
    }
    if (!atual || atual.status === "ATIVO") return atual;
    await entidade(tx, tipo, id);
    const estado = JSON.parse(atual.estadoAnterior) as Estado;
    if (tipo === "CAIXA") {
      const caixa = await tx.lancamentoCaixa.findUniqueOrThrow({ where: { id } });
      if (await tx.fechamentoMensal.count({ where: { mesLancamento: caixa.mesReferencia } })) throw new ErroGovernanca("MES_FECHADO", "O mês deste lançamento foi fechado. Reabra-o antes de restaurar.");
    }
    if (tipo === "TITULO" && id.startsWith("BRISA:RECEBER:")) {
      const titulo = await tx.recebimento.findUniqueOrThrow({ where: { id: id.slice("BRISA:RECEBER:".length) } });
      if (await tx.fechamentoMensal.count({ where: { mesLancamento: titulo.mesLancamento } })) throw new ErroGovernanca("MES_FECHADO", "O mês deste título foi fechado. O descarte permanece no snapshot até a reabertura.");
    }
    if (atual.status === "MESCLADO") {
      if (await tx.regraAcesso.count()) throw new ErroGovernanca("CARTEIRAS_PROTEGIDAS", "Há carteiras com regras de acesso configuradas. Desfazer a mesclagem exige revisão explícita das abrangências, inclusive dos vínculos indiretos.");
      const antes = await fingerprintFinanceiro(tx);
      for (const movimento of estado.movimentos ?? []) {
        if (movimento.tabela === "recebimento" && await tx.fechamentoMensal.count({ where: { mesLancamento: { in: (await tx.recebimento.findMany({ where: { id: { in: movimento.ids } }, select: { mesLancamento: true } })).map(r => r.mesLancamento) } } })) throw new ErroGovernanca("MES_FECHADO", "O mês foi fechado depois da mesclagem. Reversão bloqueada para preservar a apuração.");
        await mover(tx, movimento, true);
      }
      if (antes !== await fingerprintFinanceiro(tx)) throw new ErroGovernanca("TOTAIS_DIVERGENTES", "Reversão cancelada por divergência financeira.");
    }
    if (tipo === "CONTA") await tx.contaBancaria.update({ where: { id }, data: { ativa: true } });
    else await definirAtivo(tx, tipo, id, estado.ativo ?? true);
    return registrar(tx, tipo, id, "ATIVO", null, m, ator, {});
  }, { timeout: 30000 });
}

export async function descartarTitulo(db: PrismaClient, origemId: string, destinoId: string, motivo: string, ator: AtorGovernanca) {
  validarIdentidade("TITULO", origemId); validarIdentidade("TITULO", destinoId); const m = motivoValido(motivo);
  if (origemId === destinoId) throw new ErroGovernanca("MESMA_ORIGEM", "O título mantido precisa ser diferente do descartado.");
  return db.$transaction(async tx => {
    await autorizar(tx, ator);
    const atual = await tx.recursoGovernado.findUnique({ where: chave("TITULO", origemId) });
    if (atual?.status === "DESCARTADO" && atual.destinoId === destinoId) return atual;
    await conferirPrevia(tx, "TITULO", origemId, ator);
    if (!await recursoEstaAtivo(tx, "TITULO", origemId) || !await recursoEstaAtivo(tx, "TITULO", destinoId)) throw new ErroGovernanca("REGISTRO_INATIVO", "Os dois títulos precisam estar disponíveis.");
    const fontes = await carregarFontesUnificacao(tx);
    const linhas = projetarUnificados(fontes, await tx.unificacaoRegistro.findMany());
    const origem = linhas.find(f => f.chave === origemId); const destino = linhas.find(f => f.chave === destinoId);
    if (!origem || !destino || !["RECEBER", "PAGAR"].includes(origem.dominio) || origem.dominio !== destino.dominio || destino.estado !== "ATIVO") throw new ErroGovernanca("DESTINO_INVALIDO", "Escolha um título principal ativo da mesma natureza.");
    if (origem.qualidade !== "OK") throw new ErroGovernanca("FONTE_EM_QUARENTENA", "Resolva a inconsistência de origem antes de descartar.");
    if ((origem.pago ?? 0) > 0) throw new ErroGovernanca("TITULO_COM_BAIXA", "Este título já tem pagamento. Mantenha o título pago e revise a outra cópia.");
    if (await tx.recursoGovernado.count({ where: { tipo: "TITULO", destinoId: origemId, status: "DESCARTADO" } })) throw new ErroGovernanca("PRINCIPAL_COM_VINCULOS", "Este título é mantido por outro descarte. Desfaça o descarte anterior primeiro.");
    if (origem.origem === "BRISA") {
      const r = await tx.recebimento.findUniqueOrThrow({ where: { id: origem.origemId } });
      if (r.recebido !== null || await tx.pagamentoRecebimento.count({ where: { recebimentoId: r.id } })) throw new ErroGovernanca("TITULO_COM_BAIXA", "O título já possui registro de pagamento. Mantenha-o e revise a outra cópia.");
      if (r.reservaEmissaoToken || await tx.boleto.count({ where: { recebimentoId: r.id, status: { in: [...STATUS_BOLETO_ATIVOS] } } })) throw new ErroGovernanca("BOLETO_ATIVO", "O título possui emissão ou boleto ativo no banco. Não é seguro descartá-lo.");
      if (await tx.fechamentoMensal.count({ where: { mesLancamento: r.mesLancamento } })) throw new ErroGovernanca("MES_FECHADO", "O título pertence a um mês fechado.");
    } else {
      const t = await tx.tituloFinanceiroLegado.findUniqueOrThrow({ where: { id: origem.origemId } });
      if (t.pagamento || t.situacaoNormalizada === "PAGO" || t.pagamentoParcial || await tx.baixaFinanceiraLegado.count({ where: { origem: t.origem, tituloEscopo: t.escopo, tituloLegadoId: t.legadoId } })) throw new ErroGovernanca("TITULO_COM_BAIXA", "Há baixa ou pagamento na origem. Mantenha este título e revise a outra cópia.");
    }
    return registrar(tx, "TITULO", origemId, "DESCARTADO", destinoId, m, ator, {});
  }, { timeout: 60000 });
}

export async function inativarConta(db: PrismaClient, id: string, confirmarAbertos: boolean, motivo: string, ator: AtorGovernanca) {
  validarIdentidade("CONTA", id); const m = motivoValido(motivo);
  return db.$transaction(async tx => {
    await autorizar(tx, ator, true);
    const conta = await tx.contaBancaria.findUniqueOrThrow({ where: { id } });
    if (!conta.ativa) return { inalterado: true };
    await conferirPrevia(tx, "CONTA", id, ator);
    if (conta.padrao) throw new ErroGovernanca("CONTA_PADRAO", "Defina outra conta padrão antes de inativar esta conta.");
    const refs = await vinculos(tx, "CONTA", id);
    if (refs.titulosAbertos && !confirmarAbertos) throw new ErroGovernanca("CONFIRMAR_ABERTOS", `Esta conta possui ${refs.titulosAbertos} referência(s) de títulos em aberto, entre boletos e legado explicitamente vinculado. Confirme a ciência antes de continuar.`);
    if (refs.boletosBancariosAbertos && conta.integracaoHabilitada) throw new ErroGovernanca("RETORNO_ATIVO", "Há títulos bancários ativos. A conta precisa permanecer ativa para receber o retorno; encerre a conciliação antes de inativá-la.");
    await tx.contaBancaria.update({ where: { id }, data: { ativa: false, boletosHabilitados: false, atualizadoPorUsuarioId: ator.id } });
    return registrar(tx, "CONTA", id, "INATIVO", null, m, ator, { ativo: true });
  });
}
