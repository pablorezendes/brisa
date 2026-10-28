import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarSchemaSinteticoDespesas } from "../despesas/testes-banco";
import { obterRevisaoFinanceira, concluirRevisaoFinanceira } from "./revisao-financeira";
import { analisarUnificacao, lerOperacaoUnificada } from "./servico";
import type { ConcluirRevisaoFinanceiraEntrada, RevisaoFinanceira } from "./tipos-revisao-financeira";

let diretorio: string;
let db: PrismaClient;
let contador = 0;
const ator = { id: "admin" };
const banco = (path: string) => new PrismaClient({ datasourceUrl: `file:${path.replaceAll("\\", "/")}` });
beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-revisao-financeira-"));
  const modelo = banco(join(diretorio, "modelo.db"));
  await criarSchemaSinteticoDespesas(modelo);
  await modelo.$disconnect();
}, 30000);
beforeEach(async () => {
  const arquivo = join(diretorio, `teste-${++contador}.db`);
  copyFileSync(join(diretorio, "modelo.db"), arquivo);
  db = banco(arquivo);
  await db.usuario.createMany({ data: [
    { id: "admin", nome: "Admin sintético", usuario: "admin", senhaHash: "sem-login", perfil: "ADMINISTRADOR" },
    { id: "fin", nome: "Financeiro sintético", usuario: "fin", senhaHash: "sem-login", perfil: "FINANCEIRO", acessoGlobal: true,
      permissoesExtras: '["cadastros.sensiveis","unificacao.ver","unificacao.editar","pagamentos.conciliar"]' },
  ] });
});
afterEach(async () => { await db.$disconnect(); });
afterAll(() => {
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-revisao-financeira-")) throw new Error("Fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});

async function legado(id = "legado") {
  return db.tituloFinanceiroLegado.create({ data: {
    id, origem: "WIDESYS", escopo: "TITULO_RECEBER", legadoId: id, ultimoItemId: `item-${id}`, natureza: "RECEBER",
    numeroDocumento: "42", valorDevido: 120000, valorPago: 70000, valorAberto: 50000, competencia: "2026-04", vencimento: "2026-04-10",
    pagamento: "2026-04-17", situacaoNormalizada: "PARCIAL", tipoCobrancaRotulo: "Aluguel",
    capturadoEm: new Date(), snapshot: "{}", snapshotHash: "hash-v1",
  } });
}
async function nativo() {
  await db.empreendimento.create({ data: { id: "emp", nome: "Edifício sintético" } });
  await db.unidade.create({ data: { id: "un", empreendimentoId: "emp", identificacao: "SALA SINTETICA" } });
  await db.locatario.create({ data: { id: "loc", nome: "Locatário sintético", nomeNorm: "LOCATARIO SINTETICO" } });
  await db.contrato.create({ data: { id: "contrato", unidadeId: "un", locatarioId: "loc", diaVencimento: 10, valorBase: 100000 } });
  return db.recebimento.create({ data: { id: "nativo", contratoId: "contrato", empreendimentoId: "emp", competencia: "2026-04", mesLancamento: "2026-04", valor: 100000, iptu: 10000, cond: 10000, recebido: 70000, taxaComissaoBps: 750 } });
}
const ler = (chave = "WIDESYS:RECEBER:legado", usuario = ator) => obterRevisaoFinanceira(db, { chave }, usuario);
function entrada(r: RevisaoFinanceira, extra: Partial<ConcluirRevisaoFinanceiraEntrada> = {}): ConcluirRevisaoFinanceiraEntrada {
  return { chave: r.chave, hashFonte: r.hashFonte, versao: r.versao, assinatura: r.assinatura, acao: "DISTINTO", justificativa: "Conferi a cobrança e confirmo este lançamento.", ...extra };
}

describe("conferência financeira compartilhada em contas a receber", () => {
  it.each(["WIDESYS", "BRISA"])("confirma %s automático e deixa a confirmação manual apenas para leitura", async origem => {
    const original = origem === "WIDESYS" ? await legado() : await nativo();
    await analisarUnificacao(db, ator.id);
    const chave = `${origem}:RECEBER:${original.id}`;
    const automatico = await ler(chave);
    expect(automatico).toMatchObject({ dominio: "RECEBER", estado: "ATIVO", podeConcluir: origem === "BRISA", conferidoManualmente: false, incluidoNosTotais: true });
    if (origem === "BRISA") {
      const resultado = await concluirRevisaoFinanceira(db, entrada(automatico), ator);
      expect(resultado.revisao).toMatchObject({ estado: "ATIVO", podeConcluir: false, conferidoManualmente: true, incluidoNosTotais: true });
      await expect(concluirRevisaoFinanceira(db, entrada(resultado.revisao), ator)).rejects.toMatchObject({ codigo: "REVISAO_INDISPONIVEL" });
    } else {
      expect(automatico.conferidoPorRegra).toBe(true);
      await expect(concluirRevisaoFinanceira(db, entrada(automatico), ator)).rejects.toMatchObject({ codigo: "REVISAO_INDISPONIVEL" });
    }
    const atual = origem === "WIDESYS" ? await db.tituloFinanceiroLegado.findUniqueOrThrow({ where: { id: original.id } }) : await db.recebimento.findUniqueOrThrow({ where: { id: original.id } });
    expect(atual).toEqual(original);
    expect(await db.pagamentoRecebimento.count()).toBe(0);
    expect(await db.lancamentoCaixa.count()).toBe(0);
  });

  it("vincula o Widesys ao recebimento nativo e mantém uma única obrigação e pagamento", async () => {
    const original = await nativo(); await legado();
    await analisarUnificacao(db, ator.id);
    const revisao = await ler();
    expect(revisao.estado).toBe("PENDENTE");
    expect(revisao.candidatos).toHaveLength(1);
    const alvo = revisao.candidatos[0];
    const resultado = await concluirRevisaoFinanceira(db, entrada(revisao, { acao: "VINCULAR", destinoChave: alvo.chave, hashDestino: alvo.hash }), ator);
    expect(resultado.revisao).toMatchObject({ estado: "VINCULADO", conferidoManualmente: true, podeConcluir: false, incluidoNosTotais: false });
    const linhas = (await lerOperacaoUnificada(db)).linhas.filter(l => l.dominio === "RECEBER" && l.contabiliza);
    expect(linhas.reduce((n, l) => n + (l.valor ?? 0), 0)).toBe(120000);
    expect(linhas.reduce((n, l) => n + (l.pago ?? 0), 0)).toBe(70000);
    expect(await db.recebimento.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(await db.recebimento.count()).toBe(1);
    expect(await db.tituloFinanceiroLegado.count()).toBe(1);
    expect(await db.pagamentoRecebimento.count()).toBe(0);
    expect(await db.lancamentoCaixa.count()).toBe(0);
  });

  it("rejeita fonte, candidato ou versão alterados depois de abrir a conferência", async () => {
    await nativo(); await legado(); await analisarUnificacao(db, ator.id);
    const primeira = await ler();
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { valorPago: 60000, valorAberto: 60000 } });
    await expect(concluirRevisaoFinanceira(db, entrada(primeira), ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    const segunda = await ler();
    await db.recebimento.update({ where: { id: "nativo" }, data: { recebido: 65000 } });
    expect((await ler()).hashFonte).toBe(segunda.hashFonte);
    await expect(concluirRevisaoFinanceira(db, entrada(segunda), ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    const terceira = await ler();
    await db.unificacaoRegistro.update({ where: { chave: terceira.chave }, data: { versao: { increment: 1 } } });
    await expect(concluirRevisaoFinanceira(db, entrada(terceira), ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
  });

  it("mês fechado bloqueia confirmação nativa e vínculo com o nativo sem gravar decisão parcial", async () => {
    await nativo(); await legado(); await analisarUnificacao(db, ator.id);
    const n = await ler("BRISA:RECEBER:nativo");
    const w = await ler();
    await db.fechamentoMensal.create({ data: { mesLancamento: "2026-04", comissaoTotal: 0, detalhe: "{}" } });
    const antes = await db.unificacaoRegistro.findMany({ orderBy: { chave: "asc" } });
    await expect(concluirRevisaoFinanceira(db, entrada(n), ator)).rejects.toMatchObject({ codigo: "MES_FECHADO" });
    await expect(concluirRevisaoFinanceira(db, entrada(w, { acao: "VINCULAR", destinoChave: w.candidatos[0].chave, hashDestino: w.candidatos[0].hash }), ator)).rejects.toMatchObject({ codigo: "MES_FECHADO" });
    expect(await db.unificacaoRegistro.findMany({ orderBy: { chave: "asc" } })).toEqual(antes);
    expect(await db.unificacaoDecisao.count({ where: { acao: { in: ["DISTINTO", "VINCULAR"] } } })).toBe(0);
  });

  it.each(["BOLETO_ATIVO", "RESERVA_EMISSAO"])("preserva proteção de %s ao vincular", async tipo => {
    await nativo(); await legado(); await analisarUnificacao(db, ator.id);
    const r = await ler();
    if (tipo === "RESERVA_EMISSAO") await db.recebimento.update({ where: { id: "nativo" }, data: { reservaEmissaoToken: "reserva-sintetica" } });
    else {
      await db.contaBancaria.create({ data: { id: "conta", codigoBanco: "756", nomeBanco: "Banco sintético", agencia: "1", numero: "2", apelido: "Teste" } });
      await db.boleto.create({ data: { contaBancariaId: "conta", recebimentoId: "nativo", chaveIdempotencia: "boleto-sintetico", seuNumero: "BOLETO-SINTETICO", ambienteBanco: "SANDBOX", numeroClienteBanco: 1, numeroContaBanco: 2, codigoModalidadeBanco: 1, especieDocumentoBanco: "DS", status: "REGISTRADO", valor: 120000, dataVencimento: "2026-04-10", pagadorNome: "Locatário sintético", pagadorCpfCnpj: "12345678901" } });
    }
    await expect(concluirRevisaoFinanceira(db, entrada(r, { acao: "VINCULAR", destinoChave: r.candidatos[0].chave, hashDestino: r.candidatos[0].hash }), ator)).rejects.toMatchObject({ codigo: "EMISSAO_EM_ANDAMENTO" });
    expect((await ler()).conferidoManualmente).toBe(false);
  });

  it("revalida papel, escopo e permissões no servidor", async () => {
    await legado(); await analisarUnificacao(db, ator.id);
    await db.unificacaoRegistro.update({ where: { chave: "WIDESYS:RECEBER:legado" }, data: { status: "PENDENTE", decisao: "MANUAL" } });
    const r = await ler(undefined, { id: "fin" });
    expect(r.podeConcluir).toBe(true);
    for (const permissao of ["financeiro.ver", "cadastros.sensiveis"]) {
      await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: JSON.stringify([permissao]) } });
      await expect(ler(undefined, { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
      await expect(concluirRevisaoFinanceira(db, entrada(r), { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    }
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: '["pagamentos.conciliar"]' } });
    expect((await ler(undefined, { id: "fin" })).podeConcluir).toBe(false);
    await expect(concluirRevisaoFinanceira(db, entrada(r), { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: '["unificacao.ver"]' } });
    await expect(ler(undefined, { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: "[]", acessoGlobal: false } });
    await expect(ler(undefined, { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { acessoGlobal: true, perfil: "CONTABILIDADE" } });
    await expect(ler(undefined, { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "admin" }, data: { ativo: false } });
    await expect(ler()).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });

  it("revalida comissão explícita em receber e permite somente o administrador", async () => {
    await legado(); await analisarUnificacao(db, ator.id);
    const abertaAntesDaRestricao = await ler(undefined, { id: "fin" });
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { planoContaRotulo: "Comissão de administração" } });
    await expect(ler(undefined, { id: "fin" })).rejects.toMatchObject({ codigo: "NAO_ENCONTRADA" });
    await expect(concluirRevisaoFinanceira(db, entrada(abertaAntesDaRestricao), { id: "fin" })).rejects.toMatchObject({ codigo: "NAO_ENCONTRADA" });
    const admin = await ler();
    expect(admin.registro.descricao).toContain("Comissão de administração");
    await expect(concluirRevisaoFinanceira(db, entrada(admin), { id: "fin" })).rejects.toMatchObject({ codigo: "NAO_ENCONTRADA" });
    const concluida = await concluirRevisaoFinanceira(db, entrada(admin), ator);
    expect(concluida.revisao).toMatchObject({ conferidoManualmente: true, estado: "ATIVO" });
  });

  it("não revela candidato de comissão nem permite forçar seu vínculo em receber", async () => {
    await db.pessoa.create({ data: { id: "pessoa", origem: "WIDESYS", legadoId: "pessoa", nome: "Pessoa sintética", nomeNorm: "PESSOA SINTETICA", snapshot: "{}", snapshotHash: "pessoa-v1" } });
    await legado("a"); await legado("b");
    await db.tituloFinanceiroLegado.updateMany({ data: { pessoaLegadoId: "pessoa" } });
    await db.tituloFinanceiroLegado.update({ where: { id: "a" }, data: { planoContaRotulo: "Comissão de administração" } });
    await analisarUnificacao(db, ator.id);
    await db.unificacaoRegistro.update({ where: { chave: "WIDESYS:RECEBER:b" }, data: { status: "PENDENTE", decisao: "MANUAL" } });
    const admin = await ler("WIDESYS:RECEBER:b");
    expect(admin.candidatos).toHaveLength(1);
    const fin = await ler("WIDESYS:RECEBER:b", { id: "fin" });
    expect(fin.candidatos).toEqual([]);
    expect(fin.candidatosIndisponiveis).toBe(0);
    expect(JSON.stringify(fin)).not.toContain("Comissão de administração");
    expect(JSON.stringify(fin)).not.toContain("WIDESYS:RECEBER:a");
    const alvo = admin.candidatos[0];
    await expect(concluirRevisaoFinanceira(db, entrada(fin, { acao: "VINCULAR", destinoChave: alvo.chave, hashDestino: alvo.hash }), { id: "fin" })).rejects.toMatchObject({ codigo: "DESTINO_INVALIDO" });
    const concluida = await concluirRevisaoFinanceira(db, entrada(admin, { acao: "VINCULAR", destinoChave: alvo.chave, hashDestino: alvo.hash }), ator);
    expect(concluida.revisao).toMatchObject({ estado: "VINCULADO", conferidoManualmente: true });
    await expect(ler("WIDESYS:RECEBER:b", { id: "fin" })).rejects.toMatchObject({ codigo: "NAO_ENCONTRADA" });
  });
});
