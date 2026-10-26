import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { carteiraIrrestrita, montarPolitica, perfilSomenteLeitura, pode } from "../acesso/politica";
import { fonteLancamentoCaixa } from "../unificacao/fontes";
import { ErroDespesa, LIMITE_RATEIOS, type DespesaEditor, type DestinoCustoDespesa, type TipoDocumentoDespesa, type PagamentoDisponivel, type ResultadoSalvarDespesa, type SalvarDespesaEntrada } from "./tipos";
import { CATEGORIAS_DESPESA, categoriaDespesa, categoriaWidesys } from "./categorias";

type Tx = Prisma.TransactionClient;
type Ator = { id: string };
const hash = (valor: unknown) => createHash("sha256").update(JSON.stringify(valor)).digest("hex");
const comissaoRestrita = (textos: Array<string | null | undefined>) => /comiss|corretagem|honor[aá]rio|taxa\s+de\s+administra/i.test(textos.filter(Boolean).join(" "));
const selectCaixa = { id: true, data: true, descricao: true, cliente: true, valor: true, centroCusto: true, caixaOrigem: true, tipo: true, categoria: true, mesReferencia: true } satisfies Prisma.LancamentoCaixaSelect;
const caixaAceito = (caixa: Parameters<typeof fonteLancamentoCaixa>[0], decisao?: { status: string; hashFonte: string } | null) => !decisao || (decisao.status === "ATIVO" && decisao.hashFonte === fonteLancamentoCaixa(caixa).hash);
const selectDocumento = {
  id: true, origemChave: true, origemHash: true, fornecedorNome: true, fornecedorDocumento: true,
  categoriaCodigo: true, descricao: true, tipoDocumento: true, destinoCusto: true,
  numero: true, serie: true, tomadorNome: true, tomadorDocumento: true, emissao: true, competencia: true,
  vencimento: true, total: true, statusRateio: true, restrita: true, versao: true, lancamentoCaixaId: true,
  contaBancariaId: true, pagamentoVia: true, pagamentoObservacao: true,
  rateios: { orderBy: { ordem: "asc" as const }, select: { empreendimentoId: true, unidadeId: true, descricao: true, categoria: true, valor: true } },
  anexos: { select: { id: true, nomeOriginal: true, mimeType: true, tamanho: true } },
} satisfies Prisma.DespesaDocumentoSelect;

async function autorizar(tx: Tx, ator: Ator, editar = false) {
  const usuario = await tx.usuario.findUnique({ where: { id: ator.id }, select: {
    id: true, perfil: true, ativo: true, acessoGlobal: true, permissoesExtras: true, permissoesNegadas: true,
    papelAcesso: { select: { ativo: true, permissoes: true } }, regrasAcesso: { select: { tipo: true, recursoId: true, efeito: true } },
  } });
  const politica = usuario ? montarPolitica(usuario) : null;
  if (!politica || !carteiraIrrestrita(politica) || perfilSomenteLeitura(politica) || !pode(politica, editar ? "despesas.editar" : "despesas.ver")) {
    throw new ErroDespesa("SEM_PERMISSAO", "Você não tem permissão para acessar esta despesa integralmente.");
  }
  return politica;
}

const texto = (valor: unknown, nome: string, max: number, obrigatorio = false): string | null => {
  if (valor == null && !obrigatorio) return null;
  if (typeof valor !== "string" || valor.trim().length > max || (obrigatorio && !valor.trim())) throw new ErroDespesa("CAMPO_INVALIDO", `Confira ${nome}.`);
  return valor.trim() || null;
};
function dataCivil(valor: unknown, nome: string, opcional = false) {
  if (opcional && (valor == null || valor === "")) return null;
  const parsed = typeof valor === "string" ? new Date(`${valor}T12:00:00Z`) : null;
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || valor < "1900-01-01" || valor > "2199-12-31" || !parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== valor) {
    throw new ErroDespesa("DATA_INVALIDA", `Informe uma data válida para ${nome}.`);
  }
  return valor;
}
function documentoFiscal(valor: unknown, nome: string) {
  const raw = texto(valor, nome, 30);
  if (!raw) return null;
  if (!/^[\d.\-/\s]+$/.test(raw)) throw new ErroDespesa("DOCUMENTO_INVALIDO", `Confira o CPF/CNPJ ${nome}.`);
  const digits = raw.replace(/\D/g, "");
  if (![11, 14].includes(digits.length)) throw new ErroDespesa("DOCUMENTO_INVALIDO", `Confira o CPF/CNPJ ${nome}.`);
  return digits;
}
function valorPositivo(valor: unknown) {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor <= 0 || valor > 2147483647) throw new ErroDespesa("VALOR_INVALIDO", "Informe um valor positivo em centavos, dentro do limite permitido.");
  return valor;
}
function validarEntrada(input: SalvarDespesaEntrada) {
  if (!input || typeof input !== "object" || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId)) throw new ErroDespesa("REQUISICAO_INVALIDA", "Reabra a despesa e tente novamente.");
  const id = texto(input.id, "a identificação", 100);
  const origemChave = texto(input.origemChave, "a origem", 250);
  if (origemChave && !/^WIDESYS:PAGAR:[^\s:]+$/.test(origemChave)) throw new ErroDespesa("ORIGEM_INVALIDA", "Selecione uma conta a pagar válida do Widesys.");
  if (id && (!Number.isSafeInteger(input.versao) || input.versao! < 1)) throw new ErroDespesa("VERSAO_INVALIDA", "Reabra a despesa antes de alterar.");
  if (!["RASCUNHO", "CONFERIDO"].includes(input.statusRateio)) throw new ErroDespesa("SITUACAO_INVALIDA", "Escolha rascunho ou rateio conferido.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.competencia)) throw new ErroDespesa("COMPETENCIA_INVALIDA", "Informe a competência no formato ano-mês.");
  if (!Array.isArray(input.rateios) || input.rateios.length > LIMITE_RATEIOS) throw new ErroDespesa("LIMITE_RATEIOS", `Use no máximo ${LIMITE_RATEIOS} linhas de rateio.`);
  const total = valorPositivo(input.total);
  const tipoDocumento = input.tipoDocumento ?? "NOTA_FISCAL";
  const destinoCusto = input.destinoCusto ?? "EMPREENDIMENTOS";
  if (!["NOTA_FISCAL", "BOLETO", "GUIA", "RECIBO", "OUTRO", "SEM_DOCUMENTO"].includes(tipoDocumento)) throw new ErroDespesa("DOCUMENTO_INVALIDO", "Escolha o tipo de documento.");
  if (!["ADMINISTRADORA", "EMPREENDIMENTOS"].includes(destinoCusto)) throw new ErroDespesa("DESTINO_INVALIDO", "Escolha quem assume o custo.");
  const categoriaCodigo = texto(input.categoriaCodigo, "a categoria", 60);
  const categoria = categoriaDespesa(categoriaCodigo);
  const novoFluxo = categoriaCodigo !== null || destinoCusto === "ADMINISTRADORA" || tipoDocumento !== "NOTA_FISCAL";
  if ((categoriaCodigo && !categoria) || (novoFluxo && !categoria)) throw new ErroDespesa("CATEGORIA_INVALIDA", "Selecione a categoria da despesa.");
  const descricao = texto(input.descricao, "a descrição da despesa", 1000, novoFluxo);
  const rateios = input.rateios.map((r, ordem) => ({
    ordem, empreendimentoId: texto(r?.empreendimentoId, "o empreendimento", 100, true)!,
    unidadeId: texto(r?.unidadeId, "o imóvel", 100), descricao: texto(r?.descricao, "a descrição do serviço", 1000, true)!,
    categoria: texto(r?.categoria, "a categoria", 120), valor: valorPositivo(r?.valor),
  }));
  const soma = rateios.reduce((s, r) => s + r.valor, 0);
  if (destinoCusto === "ADMINISTRADORA" && rateios.length) throw new ErroDespesa("DESTINO_INVALIDO", "Despesas da administradora não devem ter parcelas de empreendimentos.");
  if (destinoCusto === "EMPREENDIMENTOS" && (soma > total || (input.statusRateio === "CONFERIDO" && soma !== total))) throw new ErroDespesa("RATEIO_NAO_FECHA", "O rateio conferido deve somar exatamente o total da despesa. Salve incompleto como rascunho.");
  if (!input.pagamento || !["MANTER", "VINCULAR", "REGISTRAR"].includes(input.pagamento.modo)) throw new ErroDespesa("PAGAMENTO_INVALIDO", "Escolha como registrar o pagamento.");
  const fornecedorDocumento = documentoFiscal(input.fornecedorDocumento, "do fornecedor");
  const numero = tipoDocumento === "SEM_DOCUMENTO" ? "" : texto(input.numero, "o número do documento", 100, tipoDocumento === "NOTA_FISCAL") ?? "";
  const serie = tipoDocumento === "SEM_DOCUMENTO" ? null : texto(input.serie, "a série", 50);
  // Notas antigas mantêm a mesma chave. Documento sem número não cria uma
  // identidade fiscal fictícia que impediria outra despesa do mesmo fornecedor.
  const identidade = [fornecedorDocumento, numero.toUpperCase(), (serie ?? "").toUpperCase()];
  const identidadeNota = fornecedorDocumento && numero ? hash(tipoDocumento === "NOTA_FISCAL" ? identidade : [tipoDocumento, ...identidade]) : null;
  return { id, origemChave, rateios, campos: {
    fornecedorNome: texto(input.fornecedorNome, "o fornecedor", 250, true)!, fornecedorDocumento, numero, serie, identidadeNota,
    tomadorNome: texto(input.tomadorNome, "o tomador", 250), tomadorDocumento: documentoFiscal(input.tomadorDocumento, "do tomador"),
    categoriaCodigo, descricao, tipoDocumento, destinoCusto,
    emissao: tipoDocumento === "SEM_DOCUMENTO" ? "" : dataCivil(input.emissao, "emissão", tipoDocumento !== "NOTA_FISCAL") ?? "", competencia: input.competencia, vencimento: dataCivil(input.vencimento, "vencimento", true),
    total, statusRateio: input.statusRateio,
  } };
}

async function exigirAtivo(tx: Tx, tipo: string, origemId: string) {
  const estado = await tx.recursoGovernado.findUnique({ where: { tipo_origemId: { tipo, origemId } }, select: { status: true } });
  if (estado && estado.status !== "ATIVO") throw new ErroDespesa("REGISTRO_INATIVO", "Este registro foi excluído, descartado ou mesclado. Confira a lixeira antes de continuar.");
}
async function carregarFonte(tx: Tx, origemChave: string) {
  const id = /^WIDESYS:PAGAR:([^\s:]+)$/.exec(origemChave)?.[1];
  if (!id) throw new ErroDespesa("ORIGEM_INVALIDA", "Selecione uma conta a pagar válida do Widesys.");
  const fonte = await tx.tituloFinanceiroLegado.findUnique({ where: { id }, select: {
    id: true, origem: true, natureza: true, numeroDocumento: true, pessoaLegadoId: true, emissao: true, competencia: true,
    vencimento: true, pagamento: true, valorDevido: true, valorPago: true, valorAberto: true, situacaoNormalizada: true,
    snapshotHash: true, statusImportacao: true,
    planoContaLegadoId: true, planoContaRotulo: true, tipoCobrancaRotulo: true,
  } });
  if (!fonte || fonte.origem !== "WIDESYS" || fonte.natureza !== "PAGAR") throw new ErroDespesa("FONTE_NAO_ENCONTRADA", "A conta a pagar de origem não foi encontrada.");
  await exigirAtivo(tx, "TITULO", origemChave);
  if (["QUARENTENA", "AUSENTE_NA_FONTE"].includes(fonte.statusImportacao) || !fonte.valorDevido || fonte.valorDevido < 0) throw new ErroDespesa("FONTE_PENDENTE", "Resolva a inconsistência da conta a pagar antes de ratear.");
  return fonte;
}

export async function obterEditorDespesa(db: PrismaClient, selecao: { id?: string; origemChave?: string }, ator: Ator): Promise<DespesaEditor> {
  return db.$transaction(async tx => {
    const politica = await autorizar(tx, ator);
    const id = texto(selecao.id, "a identificação", 100);
    const origemChave = texto(selecao.origemChave, "a origem", 250);
    const documento = id ? await tx.despesaDocumento.findUnique({ where: { id }, select: selectDocumento })
      : origemChave ? await tx.despesaDocumento.findUnique({ where: { origemChave }, select: selectDocumento }) : null;
    if (id && !documento) throw new ErroDespesa("NAO_ENCONTRADA", "A despesa não foi encontrada.");
    if (documento && origemChave && documento.origemChave !== origemChave) throw new ErroDespesa("ORIGEM_INVALIDA", "A despesa não corresponde à origem escolhida.");
    const origem = documento?.origemChave ?? origemChave;
    if (documento) await exigirAtivo(tx, "TITULO", origem ?? `BRISA:PAGAR:${documento.id}`);
    const fonte = origem ? await carregarFonte(tx, origem) : null;
    if (!pode(politica, "comissoes.ver") && (documento?.restrita || categoriaDespesa(documento?.categoriaCodigo)?.restrita || comissaoRestrita([
      documento?.descricao,
      ...(documento?.rateios.flatMap(r => [r.descricao, r.categoria]) ?? []), fonte?.planoContaRotulo, fonte?.tipoCobrancaRotulo,
    ]))) throw new ErroDespesa("COMISSAO_RESTRITA", "Esta nota contém informações de comissão, disponíveis somente ao administrador.");
    const fornecedor = fonte?.pessoaLegadoId ? await tx.pessoa.findUnique({ where: { origem_legadoId: { origem: fonte.origem, legadoId: fonte.pessoaLegadoId } }, select: { nome: true, cpfCnpj: true } }) : null;
    const bloqueados = await tx.recursoGovernado.findMany({ where: { tipo: { in: ["EMPREENDIMENTO", "UNIDADE", "CONTA"] }, status: { not: "ATIVO" } }, select: { tipo: true, origemId: true } });
    const excluidos = (tipo: string) => bloqueados.filter(b => b.tipo === tipo).map(b => b.origemId);
    const [empreendimentos, contas, lancamento] = await Promise.all([
      tx.empreendimento.findMany({ where: { ativo: true, id: { notIn: excluidos("EMPREENDIMENTO") } }, select: { id: true, nome: true, unidades: { where: { ativo: true, id: { notIn: excluidos("UNIDADE") } }, select: { id: true, identificacao: true }, orderBy: { identificacao: "asc" } } }, orderBy: { nome: "asc" } }),
      tx.contaBancaria.findMany({ where: { ativa: true, id: { notIn: excluidos("CONTA") } }, select: { id: true, apelido: true }, orderBy: { apelido: "asc" } }),
      documento?.lancamentoCaixaId ? tx.lancamentoCaixa.findUnique({ where: { id: documento.lancamentoCaixaId }, select: selectCaixa }) : null,
    ]);
    const caixaEstado = lancamento ? await tx.recursoGovernado.findUnique({ where: { tipo_origemId: { tipo: "CAIXA", origemId: lancamento.id } }, select: { status: true } }) : null;
    const caixaDecisao = lancamento ? await tx.unificacaoRegistro.findUnique({ where: { chave: `BRISA:MOVIMENTO:${lancamento.id}` }, select: { status: true, hashFonte: true } }) : null;
    const caixaAtivo = !!lancamento && (!caixaEstado || caixaEstado.status === "ATIVO") && lancamento.tipo === "SAIDA" && lancamento.valor === documento?.total && caixaAceito(lancamento, caixaDecisao);
    const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const categoriaSugerida = categoriaWidesys(fonte?.planoContaLegadoId);
    return {
      documento: {
        ...(documento ? { id: documento.id } : {}), origemChave: origem, origemHash: fonte?.snapshotHash ?? null,
        fonteAlterada: !!documento && !!fonte && documento.origemHash !== fonte.snapshotHash,
        versao: documento?.versao ?? 0,
        fornecedorNome: documento?.fornecedorNome ?? fornecedor?.nome ?? "",
        fornecedorDocumento: documento?.fornecedorDocumento ?? fornecedor?.cpfCnpj ?? null,
        categoriaCodigo: documento?.categoriaCodigo ?? categoriaSugerida?.codigo ?? null,
        descricao: documento?.descricao ?? fonte?.planoContaRotulo ?? null,
        tipoDocumento: (documento?.tipoDocumento ?? (fonte?.numeroDocumento || fonte?.emissao ? "OUTRO" : "SEM_DOCUMENTO")) as TipoDocumentoDespesa,
        destinoCusto: (documento?.destinoCusto ?? (fonte ? "EMPREENDIMENTOS" : "ADMINISTRADORA")) as DestinoCustoDespesa,
        numero: documento?.numero ?? fonte?.numeroDocumento ?? "", serie: documento?.serie ?? null,
        tomadorNome: documento?.tomadorNome ?? null, tomadorDocumento: documento?.tomadorDocumento ?? null,
        emissao: documento?.emissao ?? fonte?.emissao ?? (fonte ? "" : hoje), competencia: documento?.competencia ?? fonte?.competencia?.slice(0, 7) ?? (fonte ? "" : hoje.slice(0, 7)),
        vencimento: documento?.vencimento ?? fonte?.vencimento ?? null, total: fonte?.valorDevido ?? documento?.total ?? 0,
        statusRateio: documento?.statusRateio === "CONFERIDO" ? "CONFERIDO" : "RASCUNHO", rateios: documento?.rateios ?? [],
      },
      pagamento: fonte ? { origem: "WIDESYS", valor: fonte.valorPago ?? 0, data: fonte.pagamento, lancamentoCaixaId: null, situacao: fonte.situacaoNormalizada, ativo: true }
        : lancamento ? { origem: "CAIXA", valor: lancamento.valor, data: lancamento.data, lancamentoCaixaId: lancamento.id, situacao: caixaAtivo ? "PAGO" : "REVISAR", ativo: caixaAtivo }
        : { origem: "NENHUM", valor: 0, data: null, lancamentoCaixaId: null, situacao: "EM_ABERTO", ativo: true },
      empreendimentos, contas, permitePagamento: pode(politica, "despesas.editar") && pode(politica, "caixa.editar") && !origem && !documento?.lancamentoCaixaId,
      categorias: CATEGORIAS_DESPESA.filter(categoria => !categoria.restrita || pode(politica, "comissoes.ver")),
      anexos: documento?.anexos ?? [],
    };
  }, { maxWait: 5000, timeout: 15000 });
}

export async function buscarPagamentosDisponiveis(db: PrismaClient, filtro: { termo?: string; total: number }, ator: Ator): Promise<PagamentoDisponivel[]> {
  const total = valorPositivo(filtro.total);
  const termo = texto(filtro.termo, "a busca", 120);
  return db.$transaction(async tx => {
    const politica = await autorizar(tx, ator, true);
    if (!pode(politica, "caixa.editar")) throw new ErroDespesa("SEM_PERMISSAO", "Você não tem permissão para vincular pagamentos.");
    const [inativos, decisoes] = await Promise.all([
      tx.recursoGovernado.findMany({ where: { tipo: "CAIXA", status: { not: "ATIVO" } }, select: { origemId: true } }),
      tx.unificacaoRegistro.findMany({ where: { origem: "BRISA", dominio: "MOVIMENTO" }, select: { origemId: true, status: true, hashFonte: true } }),
    ]);
    const rows = await tx.lancamentoCaixa.findMany({ where: {
      tipo: "SAIDA", valor: total, id: { notIn: [...inativos.map(i => i.origemId), ...decisoes.filter(d => d.status !== "ATIVO").map(d => d.origemId)] }, despesaDocumento: { is: null },
      ...(termo ? { OR: [{ descricao: { contains: termo } }, { data: { contains: termo } }, { caixaOrigem: { contains: termo } }] } : {}),
    }, select: selectCaixa, orderBy: [{ data: "desc" }, { id: "asc" }], take: 30 });
    const porId = new Map(decisoes.map(d => [d.origemId, d]));
    return rows.filter(row => caixaAceito(row, porId.get(row.id))).map(row => ({ id: row.id, data: row.data, descricao: row.descricao, valor: row.valor, centroCusto: row.centroCusto, caixaOrigem: row.caixaOrigem, assinatura: hash(row) }));
  }, { maxWait: 5000, timeout: 15000 });
}

export async function salvarDespesa(db: PrismaClient, input: SalvarDespesaEntrada, ator: Ator): Promise<ResultadoSalvarDespesa> {
  const validado = validarEntrada(input);
  const requestHash = hash({ input, ator: ator.id });
  try {
    return await db.$transaction(async tx => {
      const politica = await autorizar(tx, ator, true);
      if (input.pagamento.modo !== "MANTER" && !pode(politica, "caixa.editar")) throw new ErroDespesa("SEM_PERMISSAO", "Você não tem permissão para registrar ou vincular pagamentos.");
      const evento = await tx.despesaEvento.findUnique({ where: { requestId: input.requestId }, select: { requestHash: true, despesaId: true, versao: true, depois: true } });
      if (evento) {
        if (evento.requestHash !== requestHash) throw new ErroDespesa("REQUISICAO_REUTILIZADA", "Esta solicitação já foi usada com outros dados. Reabra a despesa.");
        const anterior = JSON.parse(evento.depois) as { lancamentoCaixaId: string | null; origemChave: string | null };
        return { id: evento.despesaId, chave: anterior.origemChave ?? `BRISA:PAGAR:${evento.despesaId}`, versao: evento.versao, repetido: true, lancamentoCaixaId: anterior.lancamentoCaixaId };
      }
      const atual = validado.id ? await tx.despesaDocumento.findUnique({ where: { id: validado.id }, select: selectDocumento }) : null;
      if (validado.id && !atual) throw new ErroDespesa("NAO_ENCONTRADA", "A despesa não foi encontrada.");
      if (atual && (atual.versao !== input.versao || atual.origemChave !== validado.origemChave)) throw new ErroDespesa("VERSAO_DESATUALIZADA", "A despesa foi alterada. Reabra antes de salvar para não perder alterações.");
      if (atual) await exigirAtivo(tx, "TITULO", atual.origemChave ?? `BRISA:PAGAR:${atual.id}`);
      const fonte = validado.origemChave ? await carregarFonte(tx, validado.origemChave) : null;
      // Remover uma linha não desclassifica anexos e auditorias anteriores.
      // Não existe desclassificação implícita de uma nota já marcada reservada.
      const restrita = !!atual?.restrita || !!categoriaDespesa(validado.campos.categoriaCodigo)?.restrita || comissaoRestrita([
        validado.campos.descricao, atual?.descricao,
        input.pagamento.modo === "REGISTRAR" && !validado.campos.categoriaCodigo ? input.pagamento.categoria : null,
        ...validado.rateios.flatMap(r => [r.descricao, r.categoria]), fonte?.planoContaRotulo, fonte?.tipoCobrancaRotulo,
      ]);
      if (!pode(politica, "comissoes.ver") && (atual?.restrita || restrita || comissaoRestrita([
        ...validado.rateios.flatMap(r => [r.descricao, r.categoria]), ...(atual?.rateios.flatMap(r => [r.descricao, r.categoria]) ?? []), fonte?.planoContaRotulo, fonte?.tipoCobrancaRotulo,
      ]))) throw new ErroDespesa("COMISSAO_RESTRITA", "Somente o administrador pode consultar ou alterar notas com comissão.");
      if (fonte) {
        if (input.origemHash !== fonte.snapshotHash || (atual && atual.origemHash !== fonte.snapshotHash && !input.confirmarFonteAlterada)) throw new ErroDespesa("FONTE_ALTERADA", "A origem Widesys mudou. Reabra e confira o rateio antes de confirmar a nova versão.");
        if (input.pagamento.modo !== "MANTER" || input.total !== fonte.valorDevido) throw new ErroDespesa("FONTE_PROTEGIDA", "O valor e o pagamento vêm do Widesys e não podem ser duplicados neste rateio.");
      }
      if (atual?.lancamentoCaixaId && (input.total !== atual.total || input.pagamento.modo !== "MANTER")) throw new ErroDespesa("PAGAMENTO_PROTEGIDO", "Esta nota já possui um pagamento. Ajuste somente o rateio, sem alterar o total ou substituir o pagamento.");
      const empreendimentosIds = [...new Set(validado.rateios.map(r => r.empreendimentoId))];
      const unidadesIds = [...new Set(validado.rateios.flatMap(r => r.unidadeId ? [r.unidadeId] : []))];
      const [empreendimentos, unidades, bloqueados] = await Promise.all([
        tx.empreendimento.findMany({ where: { id: { in: empreendimentosIds }, ativo: true }, select: { id: true } }),
        tx.unidade.findMany({ where: { id: { in: unidadesIds }, ativo: true }, select: { id: true, empreendimentoId: true } }),
        tx.recursoGovernado.findMany({ where: { status: { not: "ATIVO" }, OR: [{ tipo: "EMPREENDIMENTO", origemId: { in: empreendimentosIds } }, { tipo: "UNIDADE", origemId: { in: unidadesIds } }] }, select: { id: true } }),
      ]);
      if (bloqueados.length || empreendimentos.length !== empreendimentosIds.length || unidades.length !== unidadesIds.length || validado.rateios.some(r => r.unidadeId && unidades.find(u => u.id === r.unidadeId)?.empreendimentoId !== r.empreendimentoId)) throw new ErroDespesa("DESTINO_INVALIDO", "Escolha empreendimentos ativos e imóveis pertencentes ao empreendimento informado.");
      const id = atual?.id ?? randomUUID();
      let lancamentoCaixaId = atual?.lancamentoCaixaId ?? null;
      let contaBancariaId = atual?.contaBancariaId ?? null;
      let pagamentoVia = atual?.pagamentoVia ?? null;
      let pagamentoObservacao = atual?.pagamentoObservacao ?? null;
      if (input.pagamento.modo === "VINCULAR") {
        const p = input.pagamento;
        const pagamentoId = texto(p.lancamentoCaixaId, "o pagamento", 100, true)!;
        const caixa = await tx.lancamentoCaixa.findUnique({ where: { id: pagamentoId }, select: selectCaixa });
        if (!caixa || caixa.tipo !== "SAIDA" || caixa.valor !== validado.campos.total || hash(caixa) !== p.assinatura) throw new ErroDespesa("PAGAMENTO_ALTERADO", "O pagamento não corresponde mais ao valor ou foi alterado. Busque novamente.");
        await exigirAtivo(tx, "CAIXA", caixa.id);
        const decisao = await tx.unificacaoRegistro.findUnique({ where: { chave: `BRISA:MOVIMENTO:${caixa.id}` }, select: { status: true, hashFonte: true } });
        if (!caixaAceito(caixa, decisao)) throw new ErroDespesa("PAGAMENTO_PENDENTE", "Esta saída precisa de conferência na unificação. Resolva-a antes de vincular como pagamento.");
        if (await tx.despesaDocumento.count({ where: { lancamentoCaixaId: caixa.id } })) throw new ErroDespesa("PAGAMENTO_JA_VINCULADO", "Esta saída já paga outra nota. Não é possível utilizá-la duas vezes.");
        lancamentoCaixaId = caixa.id;
        pagamentoVia = texto(p.via, "a forma de pagamento", 30);
      } else if (input.pagamento.modo === "REGISTRAR") {
        const p = input.pagamento;
        const data = dataCivil(p.data, "pagamento")!;
        if (!["AL", "CH", "BRISA"].includes(p.centroCusto)) throw new ErroDespesa("CAIXA_INVALIDO", "Escolha o caixa responsável pelo pagamento único.");
        const categoria = categoriaDespesa(validado.campos.categoriaCodigo)?.rotulo ?? texto(p.categoria, "a categoria da saída", 120, true)!;
        contaBancariaId = texto(p.contaBancariaId, "a conta pagadora", 100);
        pagamentoVia = texto(p.via, "a forma de pagamento", 30, true);
        if (!["PIX", "TRANSFERENCIA", "DINHEIRO", "BOLETO", "CARTAO_CREDITO", "CARTAO_DEBITO"].includes(pagamentoVia!)) throw new ErroDespesa("VIA_INVALIDA", "Escolha a forma de pagamento.");
        pagamentoObservacao = texto(p.observacao, "a observação do pagamento", 500);
        if (contaBancariaId) {
          const conta = await tx.contaBancaria.findUnique({ where: { id: contaBancariaId }, select: { ativa: true } });
          if (!conta?.ativa) throw new ErroDespesa("CONTA_INVALIDA", "Escolha uma conta bancária ativa.");
          await exigirAtivo(tx, "CONTA", contaBancariaId);
        }
        const descricaoSaida = `${validado.campos.descricao ?? `Documento ${validado.campos.numero}`} · ${validado.campos.fornecedorNome}`;
        const saida = await tx.lancamentoCaixa.create({ data: { tipo: "SAIDA", mesReferencia: data.slice(0, 7), data, centroCusto: p.centroCusto, categoria, valor: validado.campos.total, descricao: descricaoSaida, caixaOrigem: "BRISA:DESPESA" }, select: { id: true } });
        lancamentoCaixaId = saida.id;
      }
      const versao = (atual?.versao ?? 0) + 1;
      const dados = { ...validado.campos, restrita, origemHash: fonte?.snapshotHash ?? null, lancamentoCaixaId, contaBancariaId, pagamentoVia, pagamentoObservacao, atualizadoPorId: ator.id, versao };
      if (atual) {
        const alterado = await tx.despesaDocumento.updateMany({ where: { id, versao: input.versao }, data: dados });
        if (alterado.count !== 1) throw new ErroDespesa("VERSAO_DESATUALIZADA", "A despesa foi alterada por outra pessoa. Reabra antes de salvar.");
        await tx.despesaRateio.deleteMany({ where: { despesaId: id } });
      } else {
        await tx.despesaDocumento.create({ data: { id, ...dados, origemChave: validado.origemChave, criadoPorId: ator.id } });
      }
      if (validado.rateios.length) await tx.despesaRateio.createMany({ data: validado.rateios.map(r => ({ ...r, despesaId: id })) });
      await tx.despesaEvento.create({ data: { despesaId: id, requestId: input.requestId, requestHash, autorId: ator.id, versao, antes: atual ? JSON.stringify(atual) : null, depois: JSON.stringify({ ...dados, origemChave: validado.origemChave, rateios: validado.rateios }) } });
      return { id, chave: validado.origemChave ?? `BRISA:PAGAR:${id}`, versao, repetido: false, lancamentoCaixaId };
    }, { maxWait: 5000, timeout: 15000 });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") throw new ErroDespesa("DUPLICIDADE", "Esta nota, origem ou pagamento já está cadastrado. Abra o registro existente para ratear sem duplicar.");
    throw erro;
  }
}
