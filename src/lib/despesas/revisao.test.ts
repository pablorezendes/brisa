import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { carregarFontesUnificacao, hashUnificacao } from "../unificacao/fontes";
import { hashFonteCorresponde } from "../unificacao/hashes";
import { analisarUnificacao, lerOperacaoUnificada } from "../unificacao/servico";
import { criarSchemaSinteticoDespesas } from "./testes-banco";
import { concluirRevisaoDespesa, obterRevisaoDespesa } from "./revisao";
import { salvarDespesa } from "./servico";
import type { ConcluirRevisaoDespesaEntrada, RevisaoDespesa } from "./tipos-revisao";

let diretorio: string;
let db: PrismaClient;
let contador = 0;
const ator = { id: "admin" };
const banco = (path: string) => new PrismaClient({ datasourceUrl: `file:${path.replaceAll("\\", "/")}` });
beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-revisao-despesas-"));
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
      permissoesExtras: '["cadastros.sensiveis","unificacao.editar","pagamentos.conciliar","despesas.editar"]' },
  ] });
});
afterEach(async () => { await db.$disconnect(); });
afterAll(() => {
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-revisao-despesas-")) throw new Error("Fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});

async function legado(id = "legado", plano = "Honorários contábeis") {
  return db.tituloFinanceiroLegado.create({ data: {
    id, origem: "WIDESYS", escopo: "TITULO_PAGAR", legadoId: id, ultimoItemId: `item-${id}`, natureza: "PAGAR",
    numeroDocumento: "42", valorDevido: 162100, valorPago: 162100, valorAberto: 0, emissao: "2026-04-01", competencia: "2026-04",
    vencimento: "2026-04-17", pagamento: "2026-04-17", situacaoNormalizada: "PAGO", planoContaRotulo: plano,
    capturadoEm: new Date(), snapshot: "{}", snapshotHash: "hash-v1",
  } });
}
async function revisao(id = "legado", usuario = ator) {
  return (await obterRevisaoDespesa(db, { origemChave: `WIDESYS:PAGAR:${id}` }, usuario))!;
}
function entrada(r: RevisaoDespesa, extra: Partial<ConcluirRevisaoDespesaEntrada> = {}): ConcluirRevisaoDespesaEntrada {
  return { chave: r.chave, hashFonte: r.hashFonte, versao: r.versao, assinatura: r.assinatura, acao: "DISTINTO", justificativa: "Conferi o documento e confirmo uma despesa distinta.", ...extra };
}
async function pendente(id = "legado") {
  await analisarUnificacao(db, ator.id);
  await db.unificacaoRegistro.update({ where: { chave: `WIDESYS:PAGAR:${id}` }, data: { status: "REVISAR", decisao: "MANUAL", hashFonte: "captura-anterior" } });
}

describe("conferência explícita no editor de despesas", () => {
  it("conclui decisão desatualizada no mesmo fluxo sem alterar título, pagamento ou outras decisões", async () => {
    const original = await legado();
    await legado("outra", "Energia");
    await pendente();
    const outra = await db.unificacaoRegistro.findUniqueOrThrow({ where: { chave: "WIDESYS:PAGAR:outra" } });
    await salvarDespesa(db, {
      requestId: "classificacao-sintetica-01", origemChave: "WIDESYS:PAGAR:legado", origemHash: "hash-v1",
      fornecedorNome: "Contador sintético", categoriaCodigo: "DESPESAS_DIVERSAS", descricao: "Honorários contábeis",
      tipoDocumento: "SEM_DOCUMENTO", destinoCusto: "ADMINISTRADORA", numero: "", emissao: "", competencia: "2026-04", total: 162100,
      statusRateio: "CONFERIDO", rateios: [], pagamento: { modo: "MANTER" },
    }, ator);
    const r = await revisao();
    expect(r).toMatchObject({ estado: "REVISAR", pendente: true, podeConcluir: true });
    const concluida = await concluirRevisaoDespesa(db, entrada(r), ator);
    expect(concluida).toMatchObject({ estado: "ATIVO", revisao: { pendente: false, estado: "ATIVO" } });
    expect((await revisao()).pendente).toBe(false);
    expect(await db.tituloFinanceiroLegado.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(await db.unificacaoRegistro.findUniqueOrThrow({ where: { chave: outra.chave } })).toEqual(outra);
    expect(await db.unificacaoDecisao.count({ where: { registroChave: r.chave, acao: "DISTINTO" } })).toBe(1);
  });

  it("confirma vínculo mantendo uma obrigação e um pagamento no consolidado", async () => {
    await legado("a");
    await legado("b");
    await db.pessoa.create({ data: { id: "pessoa", origem: "WIDESYS", legadoId: "pessoa", nome: "Fornecedor sintético", nomeNorm: "FORNECEDOR SINTETICO", tipoPessoa: "JURIDICA", snapshot: "{}", snapshotHash: "pessoa-v1" } });
    await db.tituloFinanceiroLegado.updateMany({ data: { pessoaLegadoId: "pessoa" } });
    await analisarUnificacao(db, ator.id);
    const r = await revisao("b");
    expect(r.estado).toBe("PENDENTE");
    expect(r.candidatos).toHaveLength(1);
    const principal = r.candidatos[0];
    const resultado = await concluirRevisaoDespesa(db, entrada(r, { acao: "VINCULAR", destinoChave: principal.chave, hashDestino: principal.hash }), ator);
    expect(resultado).toMatchObject({ estado: "VINCULADO", revisao: { pendente: false } });
    const linhas = (await lerOperacaoUnificada(db)).linhas.filter(l => l.dominio === "PAGAR" && l.contabiliza);
    expect(linhas.reduce((n, l) => n + (l.valor ?? 0), 0)).toBe(162100);
    expect(linhas.reduce((n, l) => n + (l.pago ?? 0), 0)).toBe(162100);
    expect(await db.tituloFinanceiroLegado.count()).toBe(2);
    expect(await db.lancamentoCaixa.count()).toBe(0);
  });

  it("rejeita mudança financeira, mudança de decisão e mudança de candidato após abrir", async () => {
    await legado();
    await db.pessoa.create({ data: { id: "pessoa", origem: "WIDESYS", legadoId: "pessoa", nome: "Fornecedor sintético", nomeNorm: "FORNECEDOR SINTETICO", tipoPessoa: "JURIDICA", snapshot: "{}", snapshotHash: "pessoa-v1" } });
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { pessoaLegadoId: "pessoa" } });
    await pendente();
    const r = await revisao();
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { valorPago: 150000, valorAberto: 12100 } });
    await expect(concluirRevisaoDespesa(db, entrada(r), ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    const atual = await revisao();
    await db.unificacaoRegistro.update({ where: { chave: atual.chave }, data: { versao: { increment: 1 } } });
    await expect(concluirRevisaoDespesa(db, entrada(atual), ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    const nova = await revisao();
    await legado("candidato");
    // Cruzar origens não é necessário: identidade e descrição iguais bastam
    // para sugerir um candidato, nunca para unir automaticamente.
    await db.tituloFinanceiroLegado.update({ where: { id: "candidato" }, data: { pessoaLegadoId: "pessoa" } });
    expect((await revisao()).hashFonte).toBe(nova.hashFonte);
    await expect(concluirRevisaoDespesa(db, entrada(nova), ator)).rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
  });

  it("consulta permissões atuais e não deixa concluir comissão nem carteiras parciais", async () => {
    await legado(); await pendente();
    const r = await revisao("legado", { id: "fin" });
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: '["pagamentos.conciliar"]' } });
    await expect(concluirRevisaoDespesa(db, entrada(r), { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    expect((await revisao("legado", { id: "fin" })).podeConcluir).toBe(false);
    await db.usuario.update({ where: { id: "fin" }, data: { acessoGlobal: false } });
    await expect(revisao("legado", { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { acessoGlobal: true, permissoesNegadas: "[]" } });
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { planoContaRotulo: "Comissão de administração" } });
    await expect(revisao("legado", { id: "fin" })).rejects.toMatchObject({ codigo: "NAO_ENCONTRADA" });
    expect((await revisao()).registro.valor).toBe(162100);
    await db.usuario.update({ where: { id: "admin" }, data: { ativo: false } });
    await expect(revisao()).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });

  it("permite revisão inicial sem análise global e não aceita inconsistência", async () => {
    await legado();
    const r = await revisao();
    expect(r.versao).toBe(0);
    expect((await concluirRevisaoDespesa(db, entrada(r), ator)).revisao.pendente).toBe(false);
    await legado("quarentena");
    await db.tituloFinanceiroLegado.update({ where: { id: "quarentena" }, data: { statusImportacao: "QUARENTENA", quarentenaMotivo: "DADO_INVALIDO" } });
    const q = await revisao("quarentena");
    expect(q.podeConcluir).toBe(false);
    await expect(concluirRevisaoDespesa(db, entrada(q), ator)).rejects.toMatchObject({ codigo: "REVISAO_INDISPONIVEL" });
  });

  it("não revela candidatos restritos nem permite forçar o vínculo pelo identificador", async () => {
    await db.pessoa.create({ data: { id: "pessoa", origem: "WIDESYS", legadoId: "pessoa", nome: "Fornecedor sintético", nomeNorm: "FORNECEDOR SINTETICO", snapshot: "{}", snapshotHash: "pessoa-v1" } });
    await legado("a", "Comissão de administração");
    await legado("b");
    await db.tituloFinanceiroLegado.updateMany({ data: { pessoaLegadoId: "pessoa" } });
    await analisarUnificacao(db, ator.id);
    const admin = await revisao("b");
    expect(admin.candidatos).toHaveLength(1);
    const fin = await revisao("b", { id: "fin" });
    expect(fin.candidatos).toEqual([]);
    expect(fin.candidatosIndisponiveis).toBe(0);
    await expect(concluirRevisaoDespesa(db, entrada(fin, { acao: "VINCULAR", destinoChave: admin.candidatos[0].chave, hashDestino: admin.candidatos[0].hash }), { id: "fin" })).rejects.toMatchObject({ codigo: "DESTINO_INVALIDO" });
    await concluirRevisaoDespesa(db, entrada(admin, { acao: "VINCULAR", destinoChave: admin.candidatos[0].chave, hashDestino: admin.candidatos[0].hash }), ator);
    await expect(revisao("b", { id: "fin" })).rejects.toMatchObject({ codigo: "NAO_ENCONTRADA" });
  });

  it("não afirma que faltam semelhantes quando os candidatos ainda precisam de revisão", async () => {
    await db.pessoa.create({ data: { id: "pessoa", origem: "WIDESYS", legadoId: "pessoa", nome: "Fornecedor sintético", nomeNorm: "FORNECEDOR SINTETICO", snapshot: "{}", snapshotHash: "pessoa-v1" } });
    await legado("a"); await legado("b");
    await db.tituloFinanceiroLegado.updateMany({ data: { pessoaLegadoId: "pessoa" } });
    await analisarUnificacao(db, ator.id);
    await db.unificacaoRegistro.update({ where: { chave: "WIDESYS:PAGAR:a" }, data: { status: "REVISAR" } });
    const r = await revisao("b");
    expect(r.candidatos).toEqual([]);
    expect(r.candidatosIndisponiveis).toBe(1);
    expect(r.incluidoNosTotais).toBe(false);
  });
});

describe("compatibilidade da assinatura financeira com sigilo", () => {
  it("aceita exatamente o hash legado com flag e conserva decisões sem ignorar mudança no valor", async () => {
    await legado();
    await analisarUnificacao(db, ator.id);
    const fonte = (await carregarFontesUnificacao(db)).find(f => f.chave === "WIDESYS:PAGAR:legado")!;
    const entries = Object.entries(fonte).filter(([k]) => !["hash", "hashesCompativeis", "restrito"].includes(k));
    entries.splice(7, 0, ["restrito", true]);
    const antigo = hashUnificacao(Object.fromEntries(entries));
    expect(hashFonteCorresponde(fonte, antigo)).toBe(true);
    await db.unificacaoRegistro.update({ where: { chave: fonte.chave }, data: { hashFonte: antigo, decisao: "MANUAL", status: "ATIVO" } });
    expect((await revisao()).estado).toBe("ATIVO");
    await db.tituloFinanceiroLegado.update({ where: { id: "legado" }, data: { valorDevido: 180000 } });
    expect((await revisao()).estado).toBe("REVISAR");
  });
});
