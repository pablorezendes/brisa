import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarSchemaSinteticoDespesas } from "../despesas/testes-banco";
import { prepararConferenciaLote, concluirConferenciaLote } from "./conferencia-lote";
import { carregarFontesUnificacao } from "./fontes";
import { lerOperacaoUnificada } from "./servico";
import type { DominioConferenciaLote, PreviaConferenciaLote } from "./tipos-conferencia-lote";

let diretorio: string, db: PrismaClient, contador = 0;
const consultas: string[] = [];
const ator = { id: "admin" };
const banco = (path: string) => new PrismaClient({ datasourceUrl: `file:${path.replaceAll("\\", "/")}` });
beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-conferencia-lote-"));
  const modelo = banco(join(diretorio, "modelo.db"));
  try { await criarSchemaSinteticoDespesas(modelo); } finally { await modelo.$disconnect(); }
}, 30000);
beforeEach(async () => {
  const arquivo = join(diretorio, `teste-${++contador}.db`);
  copyFileSync(join(diretorio, "modelo.db"), arquivo);
  const monitorado = new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}`, log: [{ level: "query", emit: "event" }] });
  monitorado.$on("query", evento => consultas.push(evento.query)); db = monitorado;
  consultas.length = 0;
  await db.usuario.createMany({ data: [
    { id: "admin", nome: "Admin sintético", usuario: "admin", senhaHash: "sem-login", perfil: "ADMINISTRADOR" },
    { id: "fin", nome: "Financeiro sintético", usuario: "fin", senhaHash: "sem-login", perfil: "FINANCEIRO", acessoGlobal: true,
      permissoesExtras: '["despesas.ver","financeiro.ver","cadastros.sensiveis","unificacao.ver","unificacao.editar","pagamentos.conciliar"]' },
  ] });
});
afterEach(async () => { await db?.$disconnect(); });
afterAll(() => {
  if (!diretorio) return;
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-conferencia-lote-")) throw new Error("Fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});

async function legado(id: string, valor = 10000, natureza: DominioConferenciaLote = "PAGAR") {
  return db.tituloFinanceiroLegado.create({ data: { id, origem: "WIDESYS", escopo: `TITULO_${natureza}`, legadoId: id,
    ultimoItemId: `item-${id}`, natureza, numeroDocumento: id, valorDevido: valor, valorPago: Math.round(valor / 2), valorAberto: Math.round(valor / 2),
    competencia: "2026-04", vencimento: "2026-04-10", pagamento: "2026-04-17", situacaoNormalizada: "PARCIAL", planoContaRotulo: "Manutenção",
    capturadoEm: new Date(), snapshot: "{}", snapshotHash: "sintetico-v1" } });
}
async function nativo() {
  await db.empreendimento.create({ data: { id: "emp", nome: "Edifício sintético" } });
  await db.unidade.create({ data: { id: "un", empreendimentoId: "emp", identificacao: "SALA SINTETICA" } });
  await db.locatario.create({ data: { id: "loc", nome: "Locatário sintético", nomeNorm: "LOCATARIO SINTETICO" } });
  await db.contrato.create({ data: { id: "contrato", unidadeId: "un", locatarioId: "loc", diaVencimento: 10, valorBase: 10000 } });
  return db.recebimento.create({ data: { id: "nativo", contratoId: "contrato", empreendimentoId: "emp", competencia: "2026-04", mesLancamento: "2026-05", valor: 10000, recebido: 5000, taxaComissaoBps: 0 } });
}
async function semPagamento() {
  return db.despesaDocumento.create({ data: { id: "despesa", fornecedorNome: "Fornecedor nativo sintético", numero: "1", emissao: "2026-04-01", competencia: "2026-04", total: 8000,
    criadoPorId: "admin", atualizadoPorId: "admin" } });
}
async function analisar(status: Record<string, string> = {}) {
  for (const f of await carregarFontesUnificacao(db)) if (f.dominio === "PAGAR" || f.dominio === "RECEBER") await db.unificacaoRegistro.create({ data: {
    chave: f.chave, dominio: f.dominio, origem: f.origem, origemId: f.origemId, hashFonte: f.hash, status: status[f.origemId] ?? "ATIVO", candidatos: "[]", motivos: "[]",
  } });
}
const chave = (id: string, dominio: DominioConferenciaLote = "PAGAR") => `WIDESYS:${dominio}:${id}`;
const preparar = (chaves: string[], dominio: DominioConferenciaLote = "PAGAR", usuario = ator) => prepararConferenciaLote(db, { dominio, chaves }, usuario);
const entrada = (previa: PreviaConferenciaLote) => ({ dominio: previa.dominio, chaves: previa.itens.map(i => i.chave), assinatura: previa.assinatura, confirmado: true });
const decisoes = () => db.unificacaoRegistro.findMany({ orderBy: { chave: "asc" } });
const auditorias = () => db.unificacaoDecisao.findMany({ orderBy: { registroChave: "asc" } });
async function origens() {
  return { titulos: await db.tituloFinanceiroLegado.findMany({ orderBy: { id: "asc" } }), recebimentos: await db.recebimento.findMany({ orderBy: { id: "asc" } }),
    despesas: await db.despesaDocumento.findMany({ orderBy: { id: "asc" } }), pagamentos: await db.pagamentoRecebimento.findMany(), caixa: await db.lancamentoCaixa.findMany() };
}

describe("conferência em lote de contas a pagar e a receber", () => {
  it.each(["PAGAR", "RECEBER"] as const)("confere %s, soma só novos incluídos e repetir não modifica decisões ou origens", async dominio => {
    await legado("ativo", 10000, dominio); await legado("pendente", 25000, dominio); await legado("manual", 30000, dominio);
    await analisar({ pendente: "PENDENTE" });
    await db.unificacaoRegistro.update({ where: { chave: chave("manual", dominio) }, data: { decisao: "MANUAL" } });
    const fontesAntes = await origens(), decisoesAntes = await decisoes();
    const previa = await preparar([chave("ativo", dominio), chave("pendente", dominio), chave("manual", dominio), chave("ativo", dominio)], dominio);
    expect(previa.resumo).toEqual({ selecionados: 3, conferiveis: 2, jaConferidos: 1, bloqueados: 0 });
    expect(previa.impacto).toEqual({ devido: 25000, pago: 12500, aberto: 12500 });
    expect(await decisoes()).toEqual(decisoesAntes); expect(await auditorias()).toHaveLength(0);
    expect(await concluirConferenciaLote(db, entrada(previa), ator)).toMatchObject({ conferidos: 2, jaConferidos: 1, bloqueados: 0 });
    const gravadas = await decisoes(), trilha = await auditorias();
    expect(trilha).toHaveLength(2);
    expect(trilha.every(a => a.acao === "CONFERIR_LOTE" && a.usuarioId === ator.id && JSON.parse(a.justificativa).antes === previa.assinatura)).toBe(true);
    expect(gravadas.every(d => d.status === "ATIVO" && d.decisao === "MANUAL")).toBe(true);
    const linhas = (await lerOperacaoUnificada(db)).linhas.filter(l => l.dominio === dominio);
    expect(linhas.every(l => l.conferidoManualmente && l.contabiliza)).toBe(true);
    expect(linhas.reduce((s, l) => s + l.valor!, 0)).toBe(65000);
    expect(await concluirConferenciaLote(db, entrada(previa), ator)).toMatchObject({ conferidos: 0, jaConferidos: 3 });
    expect(await decisoes()).toEqual(gravadas); expect(await auditorias()).toEqual(trilha);
    const novamente = await preparar(previa.itens.map(i => i.chave), dominio);
    expect(novamente.impacto).toEqual({ devido: 0, pago: 0, aberto: 0 });
    expect(await concluirConferenciaLote(db, entrada(novamente), ator)).toMatchObject({ conferidos: 0, jaConferidos: 3 });
    expect(await origens()).toEqual(fontesAntes);
  });

  it("permite confirmar títulos distintos mesmo com valor igual sem inferir união", async () => {
    await legado("a"); await legado("b"); await analisar({ b: "PENDENTE" });
    const previa = await preparar([chave("a"), chave("b")]);
    expect(previa.impacto.devido).toBe(10000);
    await concluirConferenciaLote(db, entrada(previa), ator);
    expect((await lerOperacaoUnificada(db)).linhas.filter(l => l.dominio === "PAGAR" && l.contabiliza).reduce((s, l) => s + l.valor!, 0)).toBe(20000);
    expect((await decisoes()).every(d => !d.destinoChave)).toBe(true);
  });

  it("confere fontes sem decisão prévia, incluindo despesa nativa ainda não paga", async () => {
    await semPagamento(); await nativo(); await legado("a", 7000);
    const antes = await origens();
    const pagar = await preparar(["BRISA:PAGAR:despesa", chave("a")]);
    expect(pagar.itens.find(i => i.chave === "BRISA:PAGAR:despesa")).toMatchObject({ estado: "CONFERIR", valor: 8000, pago: 0, aberto: 8000 });
    expect(pagar.impacto).toEqual({ devido: 7000, pago: 3500, aberto: 3500 });
    expect(await concluirConferenciaLote(db, entrada(pagar), ator)).toMatchObject({ conferidos: 2 });
    const receber = await preparar(["BRISA:RECEBER:nativo"], "RECEBER");
    expect(receber.impacto.devido).toBe(0);
    await concluirConferenciaLote(db, entrada(receber), ator);
    expect(await origens()).toEqual(antes);
    expect(await db.unificacaoRegistro.count()).toBe(3);
  });

  it("preserva vínculos mesmo obsoletos, quarentena, cancelamento, valor desconhecido e exclusão", async () => {
    for (const id of ["principal", "copia", "antiga", "quarentena", "cancelado", "desconhecido", "excluido", "bom"]) await legado(id);
    await analisar({ bom: "PENDENTE", quarentena: "QUARENTENA" });
    const principal = await db.unificacaoRegistro.findUniqueOrThrow({ where: { chave: chave("principal") } });
    await db.unificacaoRegistro.updateMany({ where: { chave: { in: [chave("copia"), chave("antiga")] } }, data: { status: "VINCULADO", decisao: "MANUAL", destinoChave: principal.chave, hashDestino: principal.hashFonte } });
    await db.tituloFinanceiroLegado.update({ where: { id: "antiga" }, data: { valorDevido: 15000 } });
    await db.tituloFinanceiroLegado.update({ where: { id: "quarentena" }, data: { statusImportacao: "QUARENTENA", quarentenaMotivo: "VALOR_INVALIDO" } });
    await db.tituloFinanceiroLegado.update({ where: { id: "cancelado" }, data: { situacaoNormalizada: "CANCELADO" } });
    await db.tituloFinanceiroLegado.update({ where: { id: "desconhecido" }, data: { valorDevido: null } });
    await db.recursoGovernado.create({ data: { tipo: "TITULO", origemId: chave("excluido"), status: "EXCLUIDO", autorId: "admin", motivo: "Teste" } });
    const ids = ["copia", "antiga", "quarentena", "cancelado", "desconhecido", "excluido", "bom"];
    const antes = await decisoes();
    const previa = await preparar(ids.map(id => chave(id)));
    expect(previa.resumo).toMatchObject({ conferiveis: 1, bloqueados: 6 });
    expect(previa.itens.find(i => i.chave === chave("excluido"))).toMatchObject({ titulo: "Registro indisponível", valor: null, estado: "BLOQUEADO" });
    await concluirConferenciaLote(db, entrada(previa), ator);
    expect((await decisoes()).filter(d => d.chave !== chave("bom"))).toEqual(antes.filter(d => d.chave !== chave("bom")));
  });

  it.each(["MES_FECHADO", "BOLETO", "RESERVA"])("preserva recebimento com %s e valida novamente antes de aplicar", async tipo => {
    await nativo(); await analisar(); const previa = await preparar(["BRISA:RECEBER:nativo"], "RECEBER");
    if (tipo === "MES_FECHADO") await db.fechamentoMensal.create({ data: { mesLancamento: "2026-05", comissaoTotal: 0, detalhe: "{}" } });
    if (tipo === "RESERVA") await db.recebimento.update({ where: { id: "nativo" }, data: { reservaEmissaoToken: "sintetica" } });
    if (tipo === "BOLETO") {
      await db.contaBancaria.create({ data: { id: "conta", codigoBanco: "756", nomeBanco: "Banco sintético", agencia: "1", numero: "2", apelido: "Teste" } });
      await db.boleto.create({ data: { contaBancariaId: "conta", recebimentoId: "nativo", chaveIdempotencia: "sintetico", seuNumero: "SINTETICO", ambienteBanco: "SANDBOX", numeroClienteBanco: 1, numeroContaBanco: 2, codigoModalidadeBanco: 1, especieDocumentoBanco: "DS", status: "REGISTRADO", valor: 10000, dataVencimento: "2026-04-10", pagadorNome: "Locatário sintético", pagadorCpfCnpj: "12345678901" } });
    }
    const antes = await decisoes();
    await expect(concluirConferenciaLote(db, entrada(previa), ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    const atual = await preparar(["BRISA:RECEBER:nativo"], "RECEBER");
    expect(atual.resumo).toMatchObject({ conferiveis: 0, bloqueados: 1 });
    await concluirConferenciaLote(db, entrada(atual), ator);
    expect(await decisoes()).toEqual(antes); expect(await auditorias()).toHaveLength(0);
  });

  it.each(["FONTE", "CANDIDATO", "VERSAO", "EXCLUSAO"])("alteração de %s depois da prévia aborta o lote inteiro", async tipo => {
    await legado("a"); await legado("b"); await legado("outro");
    await db.pessoa.create({ data: { id: "pessoa", origem: "WIDESYS", legadoId: "pessoa", nome: "Fornecedor sintético", nomeNorm: "FORNECEDOR SINTETICO", snapshot: "{}", snapshotHash: "pessoa-v1" } });
    await db.tituloFinanceiroLegado.updateMany({ data: { pessoaLegadoId: "pessoa" } });
    await analisar({ a: "PENDENTE", b: "PENDENTE" });
    const previa = await preparar([chave("a"), chave("b")]);
    if (tipo === "FONTE") await db.tituloFinanceiroLegado.update({ where: { id: "b" }, data: { valorPago: 0, valorAberto: 10000 } });
    if (tipo === "CANDIDATO") await db.tituloFinanceiroLegado.update({ where: { id: "outro" }, data: { valorPago: 0, valorAberto: 10000 } });
    if (tipo === "VERSAO") await db.unificacaoRegistro.update({ where: { chave: chave("b") }, data: { versao: { increment: 1 } } });
    if (tipo === "EXCLUSAO") await db.recursoGovernado.create({ data: { tipo: "TITULO", origemId: chave("b"), status: "EXCLUIDO", autorId: "admin", motivo: "Teste" } });
    const antes = await decisoes();
    await expect(concluirConferenciaLote(db, entrada(previa), ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    expect(await decisoes()).toEqual(antes); expect(await auditorias()).toHaveLength(0);
  });

  it("replay não esconde alteração posterior do título ou da seleção", async () => {
    await legado("a"); await legado("b"); await analisar();
    const previa = await preparar([chave("a"), chave("b")]);
    await concluirConferenciaLote(db, entrada(previa), ator);
    const trilha = await auditorias();
    await expect(concluirConferenciaLote(db, { ...entrada(previa), chaves: [chave("a")] }, ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    await db.tituloFinanceiroLegado.update({ where: { id: "a" }, data: { situacaoNormalizada: "CANCELADO" } });
    await expect(concluirConferenciaLote(db, entrada(previa), ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    expect(await auditorias()).toEqual(trilha);
  });

  it("revalida papel, escopo e permissões sem depender do botão", async () => {
    await legado("a"); await analisar(); const fin = { id: "fin" };
    const previa = await preparar([chave("a")], "PAGAR", fin);
    for (const permissao of ["despesas.ver", "cadastros.sensiveis", "unificacao.editar", "pagamentos.conciliar"]) {
      await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: JSON.stringify([permissao]) } });
      await expect(preparar([chave("a")], "PAGAR", fin)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
      await expect(concluirConferenciaLote(db, entrada(previa), fin)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    }
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: "[]", acessoGlobal: false } });
    await expect(preparar([chave("a")], "PAGAR", fin)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { acessoGlobal: true, perfil: "CONTABILIDADE" } });
    await expect(preparar([chave("a")], "PAGAR", fin)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    expect(await auditorias()).toHaveLength(0);
  });

  it.each(["PAGAR", "RECEBER"] as const)("não revela comissão %s nem dados protegidos propagados ao vínculo antigo", async dominio => {
    await legado("restrito", 333333, dominio); await legado("vinculado", 333333, dominio); await analisar();
    await db.unificacaoRegistro.update({ where: { chave: chave("vinculado", dominio) }, data: { destinoChave: chave("restrito", dominio), status: "REVISAR" } });
    const aberta = await preparar([chave("restrito", dominio)], dominio, { id: "fin" });
    await db.tituloFinanceiroLegado.update({ where: { id: "restrito" }, data: { planoContaRotulo: "Comissão reservada sintética" } });
    const previa = await preparar([chave("restrito", dominio), chave("vinculado", dominio), chave("inexistente", dominio)], dominio, { id: "fin" });
    expect(previa.resumo.bloqueados).toBe(3);
    expect(previa.itens.every(i => i.valor === null && i.titulo === "Registro indisponível")).toBe(true);
    expect(JSON.stringify(previa)).not.toContain("333333"); expect(JSON.stringify(previa)).not.toContain("Comissão reservada");
    await expect(concluirConferenciaLote(db, entrada(aberta), { id: "fin" })).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    const admin = await preparar([chave("restrito", dominio)], dominio);
    expect(admin.resumo.conferiveis).toBe(1);
    await concluirConferenciaLote(db, entrada(admin), ator);
  });

  it("bloqueia efeito financeiro indireto em lançamento fora da seleção", async () => {
    await nativo(); await legado("a", 10000, "RECEBER");
    // Nativo ainda não analisado seria incluído; confirmar o Widesys como
    // principal mudaria sua classificação sem ele ter sido selecionado.
    await expect(preparar([chave("a", "RECEBER")], "RECEBER")).rejects.toMatchObject({ codigo: "EFEITO_FORA_SELECAO" });
    expect(await auditorias()).toHaveLength(0);
    expect(await db.unificacaoRegistro.count()).toBe(0);
    const juntos = await preparar([chave("a", "RECEBER"), "BRISA:RECEBER:nativo"], "RECEBER");
    expect(juntos.resumo.conferiveis).toBe(2);
    await concluirConferenciaLote(db, entrada(juntos), ator);
  });

  it("limita o lote, exige ciência e deduplica a mesma chave", async () => {
    await legado("a"); await analisar(); const previa = await preparar([chave("a"), chave("a")]);
    expect(previa.itens).toHaveLength(1);
    for (const chaves of [[], Array.from({ length: 101 }, (_, i) => chave(String(i))), ["WIDESYS:RECEBER:a"], ["chave inválida"]]) {
      await expect(preparar(chaves)).rejects.toMatchObject({ codigo: "SELECAO_INVALIDA" });
    }
    await expect(concluirConferenciaLote(db, { ...entrada(previa), confirmado: false }, ator)).rejects.toMatchObject({ codigo: "CONFIRMACAO_OBRIGATORIA" });
    await expect(concluirConferenciaLote(db, { ...entrada(previa), assinatura: "forjada" }, ator)).rejects.toMatchObject({ codigo: "CONFIRMACAO_OBRIGATORIA" });
  });

  it("processa 100 títulos em uma única fotografia sem recarregar todas as fontes para cada item", async () => {
    for (let i = 0; i < 100; i++) await legado(`lote-${i}`, 10000 + i * 100);
    const selecao = Array.from({ length: 100 }, (_, i) => chave(`lote-${i}`));
    const previa = await preparar(selecao);
    expect(previa.resumo.conferiveis).toBe(100);
    consultas.length = 0;
    expect(await concluirConferenciaLote(db, entrada(previa), ator)).toMatchObject({ conferidos: 100 });
    expect(consultas.filter(q => q.startsWith("SELECT") && q.includes("TituloFinanceiroLegado"))).toHaveLength(1);
    expect(await db.unificacaoRegistro.count()).toBe(100); expect(await db.unificacaoDecisao.count()).toBe(100);
    expect(await db.tituloFinanceiroLegado.count()).toBe(100); expect(await db.lancamentoCaixa.count()).toBe(0);
  });
});
