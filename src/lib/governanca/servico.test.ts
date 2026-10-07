import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { descartarTitulo, excluirRecurso, inativarConta, mesclarRecursos, previaGovernanca, restaurarRecurso } from "./servico";
import { filtroGovernanca, filtrarFontesGovernadas } from "./filtros";
import { carregarFontesUnificacao } from "../unificacao/fontes";
import { lerOperacaoUnificada } from "../unificacao/servico";

let dir: string; let db: PrismaClient; let contador = 0;
const ator = { id: "admin-teste", administrador: true };
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "brisa-governanca-"));
  const modelo = new PrismaClient({ datasourceUrl: `file:${join(dir, "modelo.db").replaceAll("\\", "/")}` });
  // Banco sintético gerado a partir do cliente, sem depender de engine CLI nem copiar dados reais.
  for (const m of Prisma.dmmf.datamodel.models) {
    const colunas = m.fields.filter(f => f.kind !== "object").map(f => {
      const sqlTipo = ["Int", "BigInt", "Boolean"].includes(f.type) ? "INTEGER" : f.type === "Float" ? "REAL" : f.type === "DateTime" ? "DATETIME" : "TEXT";
      const d = f.default;
      const padrao = typeof d === "boolean" ? ` DEFAULT ${d ? 1 : 0}` : typeof d === "number" ? ` DEFAULT ${d}` : typeof d === "string" ? ` DEFAULT '${d.replaceAll("'", "''")}'` : f.type === "DateTime" ? " DEFAULT CURRENT_TIMESTAMP" : "";
      return `"${f.name}" ${sqlTipo}${f.isId ? " PRIMARY KEY" : ""}${f.isRequired ? " NOT NULL" : ""}${f.isUnique ? " UNIQUE" : ""}${padrao}`;
    });
    for (const campos of m.uniqueFields) colunas.push(`UNIQUE (${campos.map(c => `"${c}"`).join(",")})`);
    await modelo.$executeRawUnsafe(`CREATE TABLE "${m.name}" (${colunas.join(",")})`);
  }
  await modelo.$disconnect();
}, 50000);
beforeEach(async () => {
  const arquivo = join(dir, `teste-${++contador}.db`); copyFileSync(join(dir, "modelo.db"), arquivo);
  db = new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}` });
  await db.usuario.create({ data: { id: ator.id, nome: "Admin teste", usuario: "admin", senhaHash: "nao-autenticavel", perfil: "ADMINISTRADOR" } });
  await db.empreendimento.createMany({ data: [{ id: "e1", nome: "Origem" }, { id: "e2", nome: "Destino" }] });
  await db.unidade.createMany({ data: [{ id: "u1", empreendimentoId: "e1", identificacao: "1" }, { id: "u2", empreendimentoId: "e1", identificacao: "2" }] });
  await db.locatario.createMany({ data: [{ id: "l1", nome: "Pessoa origem", nomeNorm: "PESSOA ORIGEM" }, { id: "l2", nome: "Pessoa destino", nomeNorm: "PESSOA DESTINO" }] });
});
afterEach(async () => { await db?.$disconnect(); });
afterAll(() => { const alvo = resolve(dir); if (alvo.startsWith(`${resolve(tmpdir())}${sep}`) && basename(alvo).startsWith("brisa-governanca-")) rmSync(alvo, { recursive: true, force: true }); });
async function contrato() { return db.contrato.create({ data: { id: "c1", unidadeId: "u1", locatarioId: "l1", valorBase: 10000 } }); }
async function recebimentos() {
  await contrato();
  return db.recebimento.createMany({ data: [
    { id: "r1", contratoId: "c1", empreendimentoId: "e1", mesLancamento: "2026-06", competencia: "2026-06", valor: 10000 },
    { id: "r2", contratoId: "c1", empreendimentoId: "e1", mesLancamento: "2026-07", competencia: "2026-07", valor: 12000 },
  ] });
}
describe("governança reversível", () => {
  it("rejeita confirmação de prévia alterada sem gravar decisão", async () => {
    const previa = await previaGovernanca(db, "LOCATARIO", "l1");
    await db.locatario.update({ where: { id: "l1" }, data: { nome: "Nome corrigido" } });
    await expect(excluirRecurso(db, "LOCATARIO", "l1", "Conferido", { ...ator, assinaturaPrevia: previa.assinatura })).rejects.toMatchObject({ codigo: "PREVIA_DESATUALIZADA" });
    expect(await db.recursoGovernado.count()).toBe(0);
    const atual = await previaGovernanca(db, "LOCATARIO", "l1");
    await excluirRecurso(db, "LOCATARIO", "l1", "Conferido novamente", { ...ator, assinaturaPrevia: atual.assinatura });
    expect(await db.recursoGovernado.count()).toBe(1);
  });
  it("inativação bancária é idempotente, restauração auditada não habilita emissão", async () => {
    await db.contaBancaria.create({ data: { id: "b1", codigoBanco: "756", nomeBanco: "Banco teste", agencia: "1", numero: "1", apelido: "Teste", boletosHabilitados: true } });
    await inativarConta(db, "b1", false, "Conta sem uso", ator);
    await inativarConta(db, "b1", false, "Repetição", ator);
    expect(await db.eventoGovernanca.count()).toBe(1);
    expect(await db.contaBancaria.findUnique({ where: { id: "b1" } })).toMatchObject({ ativa: false, boletosHabilitados: false });
    await restaurarRecurso(db, "CONTA", "b1", "Reativar cadastro", ator);
    expect(await db.contaBancaria.findUnique({ where: { id: "b1" } })).toMatchObject({ ativa: true, boletosHabilitados: false });
    expect(await db.eventoGovernanca.count()).toBe(2);
  });
  it("conta padrão não pode ser inativada; conta antiga inativa pode ser restaurada", async () => {
    await db.contaBancaria.create({ data: { id: "b1", codigoBanco: "756", nomeBanco: "Banco teste", agencia: "1", numero: "1", apelido: "Teste", padrao: true } });
    await expect(inativarConta(db, "b1", true, "Teste", ator)).rejects.toMatchObject({ codigo: "CONTA_PADRAO" });
    await db.contaBancaria.update({ where: { id: "b1" }, data: { padrao: false, ativa: false } });
    expect((await previaGovernanca(db, "CONTA", "b1")).status).toBe("INATIVO");
    await restaurarRecurso(db, "CONTA", "b1", "Reativar cadastro antigo", ator);
    expect((await db.contaBancaria.findUniqueOrThrow({ where: { id: "b1" } })).ativa).toBe(true);
    expect(await db.eventoGovernanca.count()).toBe(1);
  });
  it("conta exige ciência de títulos e preserva retorno bancário habilitado", async () => {
    await recebimentos();
    await db.contaBancaria.create({ data: { id: "b1", codigoBanco: "756", nomeBanco: "Banco teste", agencia: "1", numero: "1", apelido: "Teste", integracaoHabilitada: true } });
    await db.boleto.create({ data: { id: "bol1", contaBancariaId: "b1", recebimentoId: "r1", chaveIdempotencia: "bol1", seuNumero: "bol1", ambienteBanco: "SANDBOX", numeroClienteBanco: 1, numeroContaBanco: 1, codigoModalidadeBanco: 1, especieDocumentoBanco: "DS", status: "REGISTRADO", valor: 10000, dataVencimento: "2026-06-01", pagadorNome: "Teste", pagadorCpfCnpj: "00000000000" } });
    await expect(inativarConta(db, "b1", false, "Teste", ator)).rejects.toMatchObject({ codigo: "CONFIRMAR_ABERTOS" });
    await expect(inativarConta(db, "b1", true, "Teste", ator)).rejects.toMatchObject({ codigo: "RETORNO_ATIVO" });
    expect((await db.contaBancaria.findUniqueOrThrow({ where: { id: "b1" } })).ativa).toBe(true);
    expect(await db.eventoGovernanca.count()).toBe(0);
  });
  it("exclui logicamente, é idempotente e restaura sem perder identidade", async () => {
    await excluirRecurso(db, "LOCATARIO", "l1", "Duplicata sem uso", ator);
    await excluirRecurso(db, "LOCATARIO", "l1", "Repetição", ator);
    expect(await db.locatario.count()).toBe(2);
    expect(await db.eventoGovernanca.count()).toBe(1);
    expect(await filtroGovernanca(db, "LOCATARIO")).toEqual({ id: { notIn: ["l1"] } });
    await restaurarRecurso(db, "LOCATARIO", "l1", "Cadastro válido", ator);
    expect(await filtroGovernanca(db, "LOCATARIO")).toEqual({});
    expect(await db.eventoGovernanca.count()).toBe(2);
  });
  it("preview conta vínculos e exclusão bloqueia contratos sem tocar banco", async () => {
    await contrato();
    expect((await previaGovernanca(db, "LOCATARIO", "l1")).vinculos.contratos).toBe(1);
    await expect(excluirRecurso(db, "LOCATARIO", "l1", "Teste", ator)).rejects.toMatchObject({ codigo: "TEM_VINCULOS" });
    expect(await db.recursoGovernado.count()).toBe(0);
  });
  it("só administrador pode restaurar", async () => {
    await excluirRecurso(db, "LOCATARIO", "l1", "Teste", ator);
    await expect(restaurarRecurso(db, "LOCATARIO", "l1", "Teste", { id: "financeiro", administrador: false })).rejects.toMatchObject({ codigo: "SOMENTE_ADMIN" });
  });
  it("nega ator inativo e contabilidade mesmo forjando indicador administrador", async () => {
    await db.usuario.create({ data: { id: "contador", nome: "Teste", usuario: "contador", senhaHash: "nao-autenticavel", perfil: "CONTABILIDADE", acessoGlobal: true, permissoesExtras: '["governanca.editar"]' } });
    await expect(excluirRecurso(db, "LOCATARIO", "l1", "Teste", { id: "contador", administrador: true })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: ator.id }, data: { ativo: false } });
    await expect(excluirRecurso(db, "LOCATARIO", "l1", "Teste", ator)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });
  it("mescla vínculos nativos mantendo insumos e desfaz somente os IDs movidos", async () => {
    await recebimentos(); const antes = await db.recebimento.findMany();
    await mesclarRecursos(db, "LOCATARIO", "l1", "l2", "Identidade conferida", ator);
    expect((await db.contrato.findUniqueOrThrow({ where: { id: "c1" } })).locatarioId).toBe("l2");
    expect(await db.recebimento.findMany()).toEqual(antes);
    await restaurarRecurso(db, "LOCATARIO", "l1", "Reverter comparação", ator);
    expect((await db.contrato.findUniqueOrThrow({ where: { id: "c1" } })).locatarioId).toBe("l1");
  });
  it("bloqueia mesma identidade, destino excluído e origem já mesclada", async () => {
    await expect(mesclarRecursos(db, "LOCATARIO", "l1", "l1", "Teste", ator)).rejects.toMatchObject({ codigo: "MESMA_ORIGEM" });
    await excluirRecurso(db, "LOCATARIO", "l2", "Teste", ator);
    await expect(mesclarRecursos(db, "LOCATARIO", "l1", "l2", "Teste", ator)).rejects.toMatchObject({ codigo: "REGISTRO_INATIVO" });
    await restaurarRecurso(db, "LOCATARIO", "l2", "Teste", ator);
    await mesclarRecursos(db, "LOCATARIO", "l1", "l2", "Teste", ator);
    await expect(mesclarRecursos(db, "LOCATARIO", "l1", "l2", "Teste", ator)).rejects.toMatchObject({ codigo: "REGISTRO_INATIVO" });
  });
  it("reversão falha atomicamente se vínculo mudou depois", async () => {
    await contrato(); await mesclarRecursos(db, "LOCATARIO", "l1", "l2", "Teste", ator);
    await db.contrato.update({ where: { id: "c1" }, data: { locatarioId: null } });
    await expect(restaurarRecurso(db, "LOCATARIO", "l1", "Teste", ator)).rejects.toMatchObject({ codigo: "VINCULO_ALTERADO" });
    expect((await db.recursoGovernado.findFirstOrThrow()).status).toBe("MESCLADO");
  });
  it("não inventa mesclagem de relacionamentos legados", async () => {
    await expect(mesclarRecursos(db, "PESSOA", "a", "b", "Teste", ator)).rejects.toMatchObject({ codigo: "MAPEAMENTO_NECESSARIO" });
  });
  it("não move dados entre abrangências protegidas por regras de acesso", async () => {
    await db.regraAcesso.create({ data: { usuarioId: ator.id, tipo: "LOCATARIO", recursoId: "l1", efeito: "BLOQUEAR" } });
    await expect(mesclarRecursos(db, "LOCATARIO", "l1", "l2", "Teste", ator)).rejects.toMatchObject({ codigo: "CARTEIRAS_PROTEGIDAS" });
  });
  it("bloqueia alcance indireto de carteira ao mesclar inquilino", async () => {
    await db.regraAcesso.create({ data: { usuarioId: ator.id, tipo: "EMPREENDIMENTO", recursoId: "e2", efeito: "PERMITIR" } });
    await expect(mesclarRecursos(db, "LOCATARIO", "l1", "l2", "Teste", ator)).rejects.toMatchObject({ codigo: "CARTEIRAS_PROTEGIDAS" });
    expect(await db.eventoGovernanca.count()).toBe(0);
  });
  it("não desfaz mesclagem depois de aplicar novas abrangências", async () => {
    await mesclarRecursos(db, "LOCATARIO", "l1", "l2", "Teste", ator);
    await db.regraAcesso.create({ data: { usuarioId: ator.id, tipo: "LOCATARIO", recursoId: "l2", efeito: "PERMITIR" } });
    await expect(restaurarRecurso(db, "LOCATARIO", "l1", "Teste", ator)).rejects.toMatchObject({ codigo: "CARTEIRAS_PROTEGIDAS" });
  });
  it("não mescla empreendimentos nem restaura títulos em meses fechados", async () => {
    await recebimentos();
    await descartarTitulo(db, "BRISA:RECEBER:r1", "BRISA:RECEBER:r2", "Teste", ator);
    await db.fechamentoMensal.create({ data: { mesLancamento: "2026-06", comissaoTotal: 0, detalhe: "[]", unificacaoExcluidos: '["r1"]' } });
    await expect(restaurarRecurso(db, "TITULO", "BRISA:RECEBER:r1", "Teste", ator)).rejects.toMatchObject({ codigo: "MES_FECHADO" });
    await expect(mesclarRecursos(db, "EMPREENDIMENTO", "e1", "e2", "Teste", ator)).rejects.toMatchObject({ codigo: "MES_FECHADO" });
  });
  it("não restaura caixa após fechar seu mês", async () => {
    await db.lancamentoCaixa.create({ data: { id: "cx", mesReferencia: "2026-06", centroCusto: "GERAL", tipo: "ENTRADA", valor: 500 } });
    await excluirRecurso(db, "CAIXA", "cx", "Teste", ator);
    await db.fechamentoMensal.create({ data: { mesLancamento: "2026-06", comissaoTotal: 0, detalhe: "[]" } });
    await expect(restaurarRecurso(db, "CAIXA", "cx", "Teste", ator)).rejects.toMatchObject({ codigo: "MES_FECHADO" });
  });
  it("mescla empreendimento preservando valores por competência e desfaz", async () => {
    await recebimentos(); const antes = await db.recebimento.findMany();
    await mesclarRecursos(db, "EMPREENDIMENTO", "e1", "e2", "Identidade conferida", ator);
    expect(await db.recebimento.findMany()).toEqual(antes.map(r => ({ ...r, empreendimentoId: "e2" })));
    await restaurarRecurso(db, "EMPREENDIMENTO", "e1", "Teste", ator);
    expect(await db.recebimento.findMany()).toEqual(antes);
  });
  it("descarte de título sobrevive a alteração de fonte e pode ser desfeito", async () => {
    await recebimentos();
    await descartarTitulo(db, "BRISA:RECEBER:r1", "BRISA:RECEBER:r2", "Duplicidade confirmada", ator);
    await db.recebimento.update({ where: { id: "r1" }, data: { observacao: "Nova captura" } });
    expect((await lerOperacaoUnificada(db)).linhas.some(l => l.chave === "BRISA:RECEBER:r1")).toBe(false);
    await restaurarRecurso(db, "TITULO", "BRISA:RECEBER:r1", "Revisão após captura", ator);
    expect((await lerOperacaoUnificada(db)).linhas.some(l => l.chave === "BRISA:RECEBER:r1")).toBe(true);
  });
  it("título pago não pode ser descartado", async () => {
    await recebimentos(); await db.recebimento.update({ where: { id: "r1" }, data: { recebido: 10000, dataPagamento: "2026-06-10" } });
    await expect(descartarTitulo(db, "BRISA:RECEBER:r1", "BRISA:RECEBER:r2", "Teste", ator)).rejects.toMatchObject({ codigo: "TITULO_COM_BAIXA" });
  });
  it("tombstone não depende do hash da fonte e não esconde outros registros", async () => {
    await recebimentos(); const fontes = await carregarFontesUnificacao(db);
    const ativos = filtrarFontesGovernadas(fontes, [{ tipo: "TITULO", origemId: "BRISA:RECEBER:r1", status: "DESCARTADO" }]);
    expect(ativos).toHaveLength(fontes.length - 1);
    expect(ativos.some(f => f.chave === "BRISA:RECEBER:r2")).toBe(true);
  });
});
