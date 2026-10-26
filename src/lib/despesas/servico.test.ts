import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buscarPagamentosDisponiveis, obterEditorDespesa, salvarDespesa } from "./servico";
import type { SalvarDespesaEntrada } from "./tipos";
import { criarSchemaSinteticoDespesas } from "./testes-banco";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao, fonteLancamentoCaixa } from "../unificacao/fontes";
import { filtroCaixaDespesasRestritas } from "./sigilo-caixa";
import { categoriaWidesys } from "./categorias";

let diretorio: string;
let contador = 0;
let requisicao = 0;
const banco = (arquivo: string) => new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}` });
let db: PrismaClient;
const ator = { id: "admin" };
beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-despesas-"));
  const modelo = banco(join(diretorio, "modelo.db"));
  await criarSchemaSinteticoDespesas(modelo);
  await modelo.$disconnect();
}, 30000);
beforeEach(async () => {
  const arquivo = join(diretorio, `teste-${++contador}.db`);
  copyFileSync(join(diretorio, "modelo.db"), arquivo);
  db = banco(arquivo);
  await db.usuario.createMany({ data: [
    { id: "admin", nome: "Administrador sintético", usuario: "admin", senhaHash: "nao-autenticavel", perfil: "ADMINISTRADOR" },
    { id: "fin", nome: "Financeiro sintético", usuario: "fin", senhaHash: "nao-autenticavel", perfil: "FINANCEIRO", acessoGlobal: true, permissoesExtras: '["despesas.ver","despesas.editar"]' },
  ] });
  await db.empreendimento.createMany({ data: [{ id: "e1", nome: "Empreendimento A" }, { id: "e2", nome: "Empreendimento B" }] });
  await db.unidade.create({ data: { id: "u1", empreendimentoId: "e1", identificacao: "Unidade A" } });
});
afterEach(async () => { await db?.$disconnect(); });
afterAll(() => {
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-despesas-")) throw new Error("Fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});
function entrada(extra: Partial<SalvarDespesaEntrada> = {}): SalvarDespesaEntrada {
  return { requestId: `requisicao-sintetica-${++requisicao}`, fornecedorNome: "Fornecedor sintético", fornecedorDocumento: "12345678000199", numero: "42", emissao: "2026-10-07", competencia: "2026-10", vencimento: "2026-10-15", total: 256000, statusRateio: "CONFERIDO", rateios: [
    { empreendimentoId: "e1", unidadeId: "u1", descricao: "Serviço A", valor: 43000 },
    { empreendimentoId: "e2", descricao: "Serviço B", valor: 213000 },
  ], pagamento: { modo: "MANTER" }, ...extra };
}
async function caixa(extra: Prisma.LancamentoCaixaUncheckedCreateInput = { id: "saida" , tipo: "SAIDA", valor: 256000, mesReferencia: "2026-10", centroCusto: "AL" }) {
  return db.lancamentoCaixa.create({ data: { data: "2026-10-08", descricao: "PIX sintético", categoria: "Manutenção", ...extra } });
}
async function legado() {
  return db.tituloFinanceiroLegado.create({ data: { id: "legado", origem: "WIDESYS", escopo: "TITULO_PAGAR", legadoId: "42", ultimoItemId: "item", natureza: "PAGAR", numeroDocumento: "42", valorDevido: 256000, valorPago: 256000, valorAberto: 0, emissao: "2026-10-07", competencia: "2026-10", pagamento: "2026-10-08", situacaoNormalizada: "PAGO", capturadoEm: new Date(), snapshot: "{\"sintetico\":true}", snapshotHash: "hash-v1" } });
}

function administrativa(extra: Partial<SalvarDespesaEntrada> = {}) {
  return entrada({ categoriaCodigo: "PROGRAMA_WIDESYS", descricao: "Mensalidade do sistema", tipoDocumento: "SEM_DOCUMENTO", destinoCusto: "ADMINISTRADORA", numero: "", emissao: "", rateios: [], ...extra });
}

describe("despesas administrativas simplificadas", () => {
  it("conclui uma despesa da administradora sem inventar empreendimento, nota ou pagamento", async () => {
    const r = await salvarDespesa(db, administrativa(), ator);
    const documento = await db.despesaDocumento.findUniqueOrThrow({ where: { id: r.id } });
    expect(documento).toMatchObject({ destinoCusto: "ADMINISTRADORA", tipoDocumento: "SEM_DOCUMENTO", categoriaCodigo: "PROGRAMA_WIDESYS", descricao: "Mensalidade do sistema", numero: "", emissao: "", identidadeNota: null, statusRateio: "CONFERIDO" });
    expect(await db.despesaRateio.count()).toBe(0);
    expect(await db.lancamentoCaixa.count()).toBe(0);
    const editor = await obterEditorDespesa(db, { id: r.id }, ator);
    expect(editor.documento).toMatchObject({ destinoCusto: "ADMINISTRADORA", categoriaCodigo: "PROGRAMA_WIDESYS", tipoDocumento: "SEM_DOCUMENTO" });
    expect(editor.pagamento.situacao).toBe("EM_ABERTO");
  });

  it("paga uma vez, usa a categoria principal no caixa e mantém a descrição sem NF fictícia", async () => {
    const dados = administrativa({ pagamento: { modo: "REGISTRAR", data: "2026-10-08", centroCusto: "BRISA", categoria: "Texto diferente não confiável", via: "CARTAO_CREDITO" } });
    const r = await salvarDespesa(db, dados, ator);
    expect((await salvarDespesa(db, dados, ator)).repetido).toBe(true);
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(await db.lancamentoCaixa.count()).toBe(1);
    const pagamento = await db.lancamentoCaixa.findUniqueOrThrow({ where: { id: r.lancamentoCaixaId! } });
    expect(pagamento).toMatchObject({ categoria: "Programa Widesys", descricao: "Mensalidade do sistema · Fornecedor sintético", valor: 256000, centroCusto: "BRISA" });
    const doc = await db.despesaDocumento.findUniqueOrThrow({ where: { id: r.id } });
    expect(doc.pagamentoVia).toBe("CARTAO_CREDITO");
  });

  it("vincula saída existente sem reclassificar sua origem nem criar outra", async () => {
    await caixa();
    const [p] = await buscarPagamentosDisponiveis(db, { total: 256000 }, ator);
    await salvarDespesa(db, administrativa({ pagamento: { modo: "VINCULAR", lancamentoCaixaId: p.id, assinatura: p.assinatura } }), ator);
    expect(await db.lancamentoCaixa.count()).toBe(1);
    expect((await db.lancamentoCaixa.findUniqueOrThrow({ where: { id: p.id } })).categoria).toBe("Manutenção");
    await expect(salvarDespesa(db, administrativa({ pagamento: { modo: "VINCULAR", lancamentoCaixaId: p.id, assinatura: p.assinatura } }), ator)).rejects.toMatchObject({ codigo: "PAGAMENTO_JA_VINCULADO" });
  });

  it("categoria e descrição são exigidas no fluxo simplificado, e categoria desconhecida é rejeitada", async () => {
    await expect(salvarDespesa(db, administrativa({ categoriaCodigo: null }), ator)).rejects.toMatchObject({ codigo: "CATEGORIA_INVALIDA" });
    await expect(salvarDespesa(db, administrativa({ categoriaCodigo: "INEXISTENTE" }), ator)).rejects.toMatchObject({ codigo: "CATEGORIA_INVALIDA" });
    await expect(salvarDespesa(db, administrativa({ descricao: " " }), ator)).rejects.toMatchObject({ codigo: "CAMPO_INVALIDO" });
    expect(await db.despesaDocumento.count()).toBe(0);
  });

  it("não mistura administradora e rateios nem permite concluir empreendimento sem distribuir", async () => {
    await expect(salvarDespesa(db, administrativa({ rateios: [{ empreendimentoId: "e1", descricao: "Parcela", valor: 256000 }] }), ator)).rejects.toMatchObject({ codigo: "DESTINO_INVALIDO" });
    await expect(salvarDespesa(db, administrativa({ destinoCusto: "EMPREENDIMENTOS" }), ator)).rejects.toMatchObject({ codigo: "RATEIO_NAO_FECHA" });
    await salvarDespesa(db, administrativa({ destinoCusto: "EMPREENDIMENTOS", rateios: [{ empreendimentoId: "e1", descricao: "Despesa única do empreendimento", categoria: "Programa Widesys", valor: 256000 }] }), ator);
    expect(await db.despesaRateio.count()).toBe(1);
  });

  it("documentos opcionais sem número não colidem; guia e NF têm identidades distintas", async () => {
    await salvarDespesa(db, administrativa({ tipoDocumento: "GUIA" }), ator);
    await salvarDespesa(db, administrativa({ tipoDocumento: "GUIA" }), ator);
    expect(await db.despesaDocumento.count({ where: { identidadeNota: null } })).toBe(2);
    await salvarDespesa(db, administrativa({ tipoDocumento: "NOTA_FISCAL", numero: "42", emissao: "2026-10-07" }), ator);
    await salvarDespesa(db, administrativa({ tipoDocumento: "GUIA", numero: "42" }), ator);
    await expect(salvarDespesa(db, administrativa({ tipoDocumento: "GUIA", numero: "42" }), ator)).rejects.toMatchObject({ codigo: "DUPLICIDADE" });
    await expect(salvarDespesa(db, administrativa({ tipoDocumento: "NOTA_FISCAL" }), ator)).rejects.toMatchObject({ codigo: "CAMPO_INVALIDO" });
  });

  it("preserva identidade fiscal de notas anteriores ao novo formulário", async () => {
    await salvarDespesa(db, entrada(), ator);
    await expect(salvarDespesa(db, administrativa({ tipoDocumento: "NOTA_FISCAL", numero: "42", emissao: "2026-10-07" }), ator)).rejects.toMatchObject({ codigo: "DUPLICIDADE" });
    expect(await db.despesaDocumento.count()).toBe(1);
  });

  it("categoria explícita e descrição de comissão protegem editor, caixa e catálogo do financeiro", async () => {
    const fin = { id: "fin" };
    const editor = await obterEditorDespesa(db, {}, fin);
    expect(editor.categorias.some(c => c.codigo === "ADMINISTRACAO_COMISSAO")).toBe(false);
    expect((await obterEditorDespesa(db, {}, ator)).categorias.some(c => c.codigo === "ADMINISTRACAO_COMISSAO")).toBe(true);
    await expect(salvarDespesa(db, administrativa({ categoriaCodigo: "ADMINISTRACAO_COMISSAO" }), fin)).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
    await expect(salvarDespesa(db, administrativa({ descricao: "Comissão de administração" }), fin)).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
    const r = await salvarDespesa(db, administrativa({ categoriaCodigo: "ADMINISTRACAO_COMISSAO", pagamento: { modo: "REGISTRAR", data: "2026-10-08", centroCusto: "BRISA", categoria: "Outra", via: "PIX" } }), ator);
    expect((await db.despesaDocumento.findUniqueOrThrow({ where: { id: r.id } })).restrita).toBe(true);
    expect(await db.lancamentoCaixa.count({ where: filtroCaixaDespesasRestritas("FINANCEIRO") })).toBe(0);
    await salvarDespesa(db, administrativa({ id: r.id, versao: r.versao }), ator);
    await expect(obterEditorDespesa(db, { id: r.id }, fin)).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
  });

  it("sugere somente mapeamentos comprovados e preserva obrigação e pagamento Widesys", async () => {
    await legado();
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { planoContaLegadoId: "637", planoContaRotulo: "Programa WIDESYS" } });
    const fonteAntes = await db.tituloFinanceiroLegado.findUniqueOrThrow({ where: { id: "legado" } });
    const editor = await obterEditorDespesa(db, { origemChave: "WIDESYS:PAGAR:legado" }, ator);
    expect(editor.documento).toMatchObject({ categoriaCodigo: "PROGRAMA_WIDESYS", descricao: "Programa WIDESYS" });
    const r = await salvarDespesa(db, administrativa({ origemChave: "WIDESYS:PAGAR:legado", origemHash: "hash-v1" }), ator);
    expect(r.chave).toBe("WIDESYS:PAGAR:legado");
    expect(await db.tituloFinanceiroLegado.findUniqueOrThrow({ where: { id: "legado" } })).toEqual(fonteAntes);
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(categoriaWidesys("333")).toBeNull();
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { planoContaLegadoId: "333", planoContaRotulo: "Administração BRISA" } });
    expect((await obterEditorDespesa(db, { id: r.id }, { id: "fin" })).documento.categoriaCodigo).toBe("PROGRAMA_WIDESYS");
  });

  it("novo overlay não atribui custo à administradora nem descarta documento legado sem tipo conhecido", async () => {
    await legado();
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { planoContaLegadoId: "637", planoContaRotulo: "Programa WIDESYS" } });
    const fonteAntes = await db.tituloFinanceiroLegado.findUniqueOrThrow({ where: { id: "legado" } });
    const editor = await obterEditorDespesa(db, { origemChave: "WIDESYS:PAGAR:legado" }, ator);
    expect(editor.documento).toMatchObject({ destinoCusto: "EMPREENDIMENTOS", tipoDocumento: "OUTRO", numero: "42", emissao: "2026-10-07" });
    const dados = entrada({ ...editor.documento, fornecedorNome: "Fornecedor sintético", statusRateio: "CONFERIDO", rateios: [] });
    await expect(salvarDespesa(db, dados, ator)).rejects.toMatchObject({ codigo: "RATEIO_NAO_FECHA" });
    const r = await salvarDespesa(db, { ...dados, destinoCusto: "ADMINISTRADORA" }, ator);
    expect((await obterEditorDespesa(db, { id: r.id }, ator)).documento).toMatchObject({ tipoDocumento: "OUTRO", numero: "42", emissao: "2026-10-07", destinoCusto: "ADMINISTRADORA" });
    expect(await db.tituloFinanceiroLegado.findUniqueOrThrow({ where: { id: "legado" } })).toEqual(fonteAntes);
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(await db.lancamentoCaixa.count()).toBe(0);
  });

  it("emissão isolada do legado também é preservada sem inventar número ou nota fiscal", async () => {
    await legado();
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { numeroDocumento: null, planoContaLegadoId: "619", planoContaRotulo: "Impostos Brisa" } });
    const editor = await obterEditorDespesa(db, { origemChave: "WIDESYS:PAGAR:legado" }, ator);
    expect(editor.documento).toMatchObject({ tipoDocumento: "OUTRO", numero: "", emissao: "2026-10-07" });
    const r = await salvarDespesa(db, entrada({ ...editor.documento, fornecedorNome: "Fornecedor sintético", destinoCusto: "ADMINISTRADORA", rateios: [] }), ator);
    expect((await db.despesaDocumento.findUniqueOrThrow({ where: { id: r.id } })).identidadeNota).toBeNull();
    expect((await obterEditorDespesa(db, { id: r.id }, ator)).documento.emissao).toBe("2026-10-07");
  });
});
describe("despesa única com rateio manual", () => {
  it("cria uma nota e rateios sem gerar pagamento ou alterar financeiro externo", async () => {
    const r = await salvarDespesa(db, entrada(), ator);
    expect(r.chave).toBe(`BRISA:PAGAR:${r.id}`);
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(await db.despesaRateio.count()).toBe(2);
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect(await db.despesaEvento.count()).toBe(1);
    const editor = await obterEditorDespesa(db, { id: r.id }, ator);
    expect(editor.documento.total).toBe(256000);
    expect(editor.pagamento.origem).toBe("NENHUM");
  });
  it("rascunho pode ficar incompleto, mas conferido não pode sobrar nem exceder", async () => {
    const rateios = [{ empreendimentoId: "e1", descricao: "Parte", valor: 43000 }];
    await expect(salvarDespesa(db, entrada({ rateios }), ator)).rejects.toMatchObject({ codigo: "RATEIO_NAO_FECHA" });
    await salvarDespesa(db, entrada({ rateios, statusRateio: "RASCUNHO" }), ator);
    await expect(salvarDespesa(db, entrada({ total: 10000, rateios, statusRateio: "RASCUNHO" }), ator)).rejects.toMatchObject({ codigo: "RATEIO_NAO_FECHA" });
  });
  it("registra uma única saída e repetição do envio não duplica nota, parcelas ou pagamento", async () => {
    const dados = entrada({ pagamento: { modo: "REGISTRAR", data: "2026-10-08", centroCusto: "AL", categoria: "Manutenção", via: "PIX" } });
    const primeiro = await salvarDespesa(db, dados, ator);
    const repetido = await salvarDespesa(db, dados, ator);
    expect(repetido).toMatchObject({ ...primeiro, repetido: true });
    expect(await db.lancamentoCaixa.count()).toBe(1);
    expect((await db.lancamentoCaixa.findFirst())?.valor).toBe(256000);
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(await db.despesaEvento.count()).toBe(1);
  });
  it("não reutiliza requestId para dados diferentes", async () => {
    const dados = entrada();
    await salvarDespesa(db, dados, ator);
    await expect(salvarDespesa(db, { ...dados, numero: "43" }, ator)).rejects.toMatchObject({ codigo: "REQUISICAO_REUTILIZADA" });
    expect(await db.despesaDocumento.count()).toBe(1);
  });
  it("vincula PIX existente, sem outra saída, e impede usar o mesmo pagamento para outra nota", async () => {
    await caixa();
    const [p] = await buscarPagamentosDisponiveis(db, { total: 256000 }, ator);
    await salvarDespesa(db, entrada({ pagamento: { modo: "VINCULAR", lancamentoCaixaId: p.id, assinatura: p.assinatura } }), ator);
    expect(await db.lancamentoCaixa.count()).toBe(1);
    expect(await buscarPagamentosDisponiveis(db, { total: 256000 }, ator)).toHaveLength(0);
    await expect(salvarDespesa(db, entrada({ numero: "43", pagamento: { modo: "VINCULAR", lancamentoCaixaId: p.id, assinatura: p.assinatura } }), ator)).rejects.toMatchObject({ codigo: "PAGAMENTO_JA_VINCULADO" });
  });
  it("detecta pagamento alterado depois da escolha antes de salvar", async () => {
    await caixa();
    const [p] = await buscarPagamentosDisponiveis(db, { total: 256000 }, ator);
    await db.lancamentoCaixa.update({ where: { id: p.id }, data: { descricao: "Alterado" } });
    await expect(salvarDespesa(db, entrada({ pagamento: { modo: "VINCULAR", lancamentoCaixaId: p.id, assinatura: p.assinatura } }), ator)).rejects.toMatchObject({ codigo: "PAGAMENTO_ALTERADO" });
    expect(await db.despesaDocumento.count()).toBe(0);
  });
  it("busca somente saídas exatas, ativas e até 30 resultados", async () => {
    await caixa();
    await db.lancamentoCaixa.createMany({ data: [
      { id: "entrada", tipo: "ENTRADA", valor: 256000, mesReferencia: "2026-10", centroCusto: "AL" },
      { id: "menor", tipo: "SAIDA", valor: 10000, mesReferencia: "2026-10", centroCusto: "AL" },
      { id: "apagado", tipo: "SAIDA", valor: 256000, mesReferencia: "2026-10", centroCusto: "AL" },
    ] });
    await db.recursoGovernado.create({ data: { tipo: "CAIXA", origemId: "apagado", status: "EXCLUIDO", motivo: "Teste", autorId: "admin" } });
    expect((await buscarPagamentosDisponiveis(db, { total: 256000 }, ator)).map(r => r.id)).toEqual(["saida"]);
  });
  it("editar rateio pago não cria outra saída e não permite mudar total ou pagamento", async () => {
    const dados = entrada({ pagamento: { modo: "REGISTRAR", data: "2026-10-08", centroCusto: "AL", categoria: "Manutenção", via: "PIX" } });
    const r = await salvarDespesa(db, dados, ator);
    const nova = entrada({ id: r.id, versao: r.versao, rateios: [{ empreendimentoId: "e2", descricao: "Reclassificado", valor: 256000 }] });
    await salvarDespesa(db, nova, ator);
    expect(await db.lancamentoCaixa.count()).toBe(1);
    expect(await db.despesaRateio.count()).toBe(1);
    await expect(salvarDespesa(db, entrada({ id: r.id, versao: 2, total: 256001, rateios: [], statusRateio: "RASCUNHO" }), ator)).rejects.toMatchObject({ codigo: "PAGAMENTO_PROTEGIDO" });
  });
  it("controle de versão impede sobrescrever edição concorrente", async () => {
    const r = await salvarDespesa(db, entrada(), ator);
    await salvarDespesa(db, entrada({ id: r.id, versao: 1 }), ator);
    await expect(salvarDespesa(db, entrada({ id: r.id, versao: 1 }), ator)).rejects.toMatchObject({ codigo: "VERSAO_DESATUALIZADA" });
    expect(await db.despesaEvento.count()).toBe(2);
  });
  it("identidade fiscal impede duplicar nota e rollback remove saída provisória", async () => {
    await salvarDespesa(db, entrada(), ator);
    await expect(salvarDespesa(db, entrada({ pagamento: { modo: "REGISTRAR", data: "2026-10-08", centroCusto: "AL", categoria: "Manutenção", via: "PIX" } }), ator)).rejects.toMatchObject({ codigo: "DUPLICIDADE" });
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect(await db.despesaDocumento.count()).toBe(1);
  });
  it("não admite imóvel de outro empreendimento ou empreendimento inativo", async () => {
    await expect(salvarDespesa(db, entrada({ rateios: [{ empreendimentoId: "e2", unidadeId: "u1", descricao: "Inconsistente", valor: 256000 }] }), ator)).rejects.toMatchObject({ codigo: "DESTINO_INVALIDO" });
    await db.empreendimento.update({ where: { id: "e2" }, data: { ativo: false } });
    await expect(salvarDespesa(db, entrada(), ator)).rejects.toMatchObject({ codigo: "DESTINO_INVALIDO" });
  });
  it("não permite ratear registro excluído ou reabrir nota excluída", async () => {
    const r = await salvarDespesa(db, entrada(), ator);
    await db.recursoGovernado.create({ data: { tipo: "TITULO", origemId: r.chave, status: "EXCLUIDO", motivo: "Teste", autorId: "admin" } });
    await expect(obterEditorDespesa(db, { id: r.id }, ator)).rejects.toMatchObject({ codigo: "REGISTRO_INATIVO" });
    await expect(salvarDespesa(db, entrada({ id: r.id, versao: 1 }), ator)).rejects.toMatchObject({ codigo: "REGISTRO_INATIVO" });
  });
  it("Widesys recebe apenas overlay, preservando título, baixa e caixa", async () => {
    const antes = await legado();
    const r = await salvarDespesa(db, entrada({ origemChave: "WIDESYS:PAGAR:legado", origemHash: "hash-v1" }), ator);
    expect(r.chave).toBe("WIDESYS:PAGAR:legado");
    expect(await db.tituloFinanceiroLegado.findUnique({ where: { id: "legado" } })).toEqual(antes);
    expect(await db.lancamentoCaixa.count()).toBe(0);
    const editor = await obterEditorDespesa(db, { origemChave: r.chave }, ator);
    expect(editor.pagamento).toMatchObject({ origem: "WIDESYS", valor: 256000 });
    expect(editor.permitePagamento).toBe(false);
    await expect(salvarDespesa(db, entrada({ numero: "43", origemChave: r.chave, origemHash: "hash-v1", pagamento: { modo: "REGISTRAR", data: "2026-10-08", centroCusto: "AL", categoria: "Manutenção", via: "PIX" } }), ator)).rejects.toMatchObject({ codigo: "FONTE_PROTEGIDA" });
  });
  it("Widesys atualizado exige leitura nova e confirmação explícita do rateio", async () => {
    await legado();
    const r = await salvarDespesa(db, entrada({ origemChave: "WIDESYS:PAGAR:legado", origemHash: "hash-v1" }), ator);
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { snapshotHash: "hash-v2" } });
    const editor = await obterEditorDespesa(db, { id: r.id }, ator);
    expect(editor.documento.fonteAlterada).toBe(true);
    const atualizado = entrada({ id: r.id, versao: 1, origemChave: r.chave, origemHash: "hash-v2" });
    await expect(salvarDespesa(db, atualizado, ator)).rejects.toMatchObject({ codigo: "FONTE_ALTERADA" });
    await salvarDespesa(db, { ...atualizado, confirmarFonteAlterada: true }, ator);
    expect((await obterEditorDespesa(db, { id: r.id }, ator)).documento.fonteAlterada).toBe(false);
  });
  it("nega sessão desativada, escopo parcial e perfil somente leitura mesmo com extras", async () => {
    await db.usuario.update({ where: { id: "admin" }, data: { ativo: false } });
    await expect(salvarDespesa(db, entrada(), ator)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { acessoGlobal: false } });
    await expect(obterEditorDespesa(db, {}, { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { perfil: "SOCIO", acessoGlobal: true } });
    await expect(obterEditorDespesa(db, {}, { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });
  it("financeiro pode ratear com permissão mas pagar exige caixa.editar", async () => {
    await salvarDespesa(db, entrada(), { id: "fin" });
    await expect(salvarDespesa(db, entrada({ numero: "43", pagamento: { modo: "REGISTRAR", data: "2026-10-08", centroCusto: "AL", categoria: "Manutenção", via: "PIX" } }), { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });
  it("informações de comissão ficam restritas ao administrador também no editor", async () => {
    const dados = entrada({ rateios: [{ empreendimentoId: "e1", descricao: "Comissão reservada", categoria: "Corretagem", valor: 256000 }] });
    await expect(salvarDespesa(db, dados, { id: "fin" })).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
    const r = await salvarDespesa(db, dados, ator);
    expect((await db.despesaDocumento.findUniqueOrThrow({ where: { id: r.id } })).restrita).toBe(true);
    await expect(obterEditorDespesa(db, { id: r.id }, { id: "fin" })).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
    await expect(salvarDespesa(db, entrada({ id: r.id, versao: 1 }), { id: "fin" })).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
    expect((await obterEditorDespesa(db, { id: r.id }, ator)).documento.rateios[0].descricao).toBe("Comissão reservada");
  });
  it("comissão na classificação da fonte Widesys também restringe editor", async () => {
    await legado();
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { planoContaRotulo: "Taxa de administração" } });
    await expect(obterEditorDespesa(db, { origemChave: "WIDESYS:PAGAR:legado" }, { id: "fin" })).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
  });
  it("honorários do Widesys não presumem comissão; uma proteção já registrada permanece", async () => {
    await legado();
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { planoContaRotulo: "Honorários" } });
    const fonte = async () => (await derivarFontesUnificacao(await carregarDadosFontesUnificacao(db, "PAGAR"))).find(f => f.chave === "WIDESYS:PAGAR:legado");
    expect((await fonte())?.restrito).toBe(false);
    expect((await obterEditorDespesa(db, { origemChave: "WIDESYS:PAGAR:legado" }, { id: "fin" })).sigilo?.restrita).toBe(false);
    const resultado = await salvarDespesa(db, administrativa({ categoriaCodigo: "OUTRAS", descricao: "Honorários contábeis", origemChave: "WIDESYS:PAGAR:legado", origemHash: "hash-v1" }), { id: "fin" });
    await db.despesaDocumento.update({ where: { id: resultado.id }, data: { restrita: true } });
    expect((await fonte())?.restrito).toBe(true);
    await expect(obterEditorDespesa(db, { id: resultado.id }, { id: "fin" })).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
  });
  it("flag restrita é derivada no servidor e não pode ser apagada enviando parâmetro extra", async () => {
    const dados = { ...entrada({ rateios: [{ empreendimentoId: "e1", descricao: "Honorários de administração", valor: 256000 }] }), restrita: false };
    const r = await salvarDespesa(db, dados, ator);
    expect((await db.despesaDocumento.findUniqueOrThrow({ where: { id: r.id } })).restrita).toBe(true);
    const publico = { ...entrada({ numero: "43" }), restrita: true };
    const p = await salvarDespesa(db, publico, ator);
    expect((await db.despesaDocumento.findUniqueOrThrow({ where: { id: p.id } })).restrita).toBe(false);
    await salvarDespesa(db, entrada({ id: r.id, versao: 1 }), ator);
    expect((await db.despesaDocumento.findUniqueOrThrow({ where: { id: r.id } })).restrita).toBe(true);
    await expect(obterEditorDespesa(db, { id: r.id }, { id: "fin" })).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
  });
  it("SQL oculta a saída reservada antes de listar, somar ou alterar, mantendo acesso do administrador", async () => {
    const r = await salvarDespesa(db, entrada({ rateios: [{ empreendimentoId: "e1", descricao: "Comissão reservada", valor: 256000 }], pagamento: { modo: "REGISTRAR", data: "2026-10-08", centroCusto: "AL", categoria: "Manutenção", via: "PIX" } }), ator);
    await caixa({ id: "publico", tipo: "SAIDA", valor: 10000, mesReferencia: "2026-10", centroCusto: "AL" });
    const filtro = filtroCaixaDespesasRestritas("FINANCEIRO");
    expect((await db.lancamentoCaixa.findMany({ where: filtro })).map(c => c.id)).toEqual(["publico"]);
    expect((await db.lancamentoCaixa.aggregate({ where: filtro, _sum: { valor: true } }))._sum.valor).toBe(10000);
    expect((await db.lancamentoCaixa.updateMany({ where: { AND: [{ id: r.lancamentoCaixaId! }, filtro] }, data: { valor: 1 } })).count).toBe(0);
    expect((await db.lancamentoCaixa.findUniqueOrThrow({ where: { id: r.lancamentoCaixaId! } })).valor).toBe(256000);
    expect(await db.lancamentoCaixa.count({ where: filtroCaixaDespesasRestritas("ADMINISTRADOR") })).toBe(2);
  });
  it("não oferece nem vincula saída que ficou pendente na unificação", async () => {
    const c = await caixa();
    const [p] = await buscarPagamentosDisponiveis(db, { total: 256000 }, ator);
    await db.unificacaoRegistro.create({ data: { chave: `BRISA:MOVIMENTO:${c.id}`, dominio: "MOVIMENTO", origem: "BRISA", origemId: c.id, status: "PENDENTE", hashFonte: fonteLancamentoCaixa(c).hash } });
    expect(await buscarPagamentosDisponiveis(db, { total: 256000 }, ator)).toHaveLength(0);
    await expect(salvarDespesa(db, entrada({ pagamento: { modo: "VINCULAR", lancamentoCaixaId: p.id, assinatura: p.assinatura } }), ator)).rejects.toMatchObject({ codigo: "PAGAMENTO_PENDENTE" });
  });
  it("saída com decisão antiga precisa revisão e pagamento vinculado é sinalizado", async () => {
    const c = await caixa();
    await db.unificacaoRegistro.create({ data: { chave: `BRISA:MOVIMENTO:${c.id}`, dominio: "MOVIMENTO", origem: "BRISA", origemId: c.id, status: "ATIVO", decisao: "MANUAL", hashFonte: fonteLancamentoCaixa(c).hash } });
    const [p] = await buscarPagamentosDisponiveis(db, { total: 256000 }, ator);
    const r = await salvarDespesa(db, entrada({ pagamento: { modo: "VINCULAR", lancamentoCaixaId: p.id, assinatura: p.assinatura } }), ator);
    await db.lancamentoCaixa.update({ where: { id: c.id }, data: { categoria: "Reclassificada" } });
    expect((await obterEditorDespesa(db, { id: r.id }, ator)).pagamento).toMatchObject({ ativo: false, situacao: "REVISAR" });
  });
  it("todos os destinos são validados antes de registrar pagamento", async () => {
    await expect(salvarDespesa(db, entrada({ rateios: [{ empreendimentoId: "inexistente", descricao: "Erro", valor: 256000 }], pagamento: { modo: "REGISTRAR", data: "2026-10-08", centroCusto: "AL", categoria: "Manutenção", via: "PIX" } }), ator)).rejects.toMatchObject({ codigo: "DESTINO_INVALIDO" });
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect(await db.despesaDocumento.count()).toBe(0);
  });
  it.each(["2026-02-30", "2026-99-01", "ontem"])("data civil inválida %s rejeitada sem lançar", async emissao => {
    await expect(salvarDespesa(db, entrada({ emissao }), ator)).rejects.toMatchObject({ codigo: "DATA_INVALIDA" });
    expect(await db.despesaDocumento.count()).toBe(0);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])("valor inválido %s rejeitado", async total => {
    await expect(salvarDespesa(db, entrada({ total }), ator)).rejects.toMatchObject({ codigo: "VALOR_INVALIDO" });
  });
});
