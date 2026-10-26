import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarSchemaSinteticoDespesas } from "../despesas/testes-banco";
import { alterarSituacaoFornecedor, buscaFornecedores, listarFornecedores, resolverFornecedorDespesa, salvarFornecedor, vincularPessoaFornecedor } from "./servico";
import type { SalvarFornecedorEntrada } from "./tipos";

let dir: string; let db: PrismaClient; let n = 0; let req = 0;
const cliente = (p: string) => new PrismaClient({ datasourceUrl: `file:${p.replaceAll("\\", "/")}` });
const admin = { id: "admin" };
const entrada = (extra: Partial<SalvarFornecedorEntrada> = {}): SalvarFornecedorEntrada => ({ requestId: `fornecedor-teste-requisicao-${++req}`, nome: "Oficina Sintética", cpfCnpj: "12.345.678/0001-99", email: "teste@example.test", telefone: "(62) 99999-9999", ...extra });
beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "brisa-fornecedores-")); const modelo = cliente(join(dir, "modelo.db")); await criarSchemaSinteticoDespesas(modelo); await modelo.$disconnect(); }, 30000);
beforeEach(async () => {
  const arquivo = join(dir, `teste-${++n}.db`); copyFileSync(join(dir, "modelo.db"), arquivo); db = cliente(arquivo);
  await db.usuario.createMany({ data: [
    { id: "admin", nome: "Admin sintético", usuario: "admin", senhaHash: "naoautenticavel", perfil: "ADMINISTRADOR" },
    { id: "fin", nome: "Financeiro sintético", usuario: "fin", senhaHash: "naoautenticavel", perfil: "FINANCEIRO", acessoGlobal: true, permissoesExtras: '["cadastros.sensiveis","cadastros.editar"]' },
  ] });
});
afterEach(async () => db?.$disconnect());
afterAll(() => { const alvo = resolve(dir); if (!alvo.startsWith(resolve(tmpdir()) + sep) || !basename(alvo).startsWith("brisa-fornecedores-")) throw new Error("Fora do escopo de teste"); rmSync(alvo, { recursive: true, force: true }); });
async function pessoaLegada(extra: { id?: string; papel?: string; ativo?: boolean } = {}) {
  const id = extra.id ?? "legado";
  await db.pessoa.create({ data: { id, origem: "WIDESYS", legadoId: id, nome: "Pessoa importada", nomeNorm: "PESSOA IMPORTADA", cpfCnpj: "12.345.678/0001-99", snapshot: '{"origem":"preservar"}', snapshotHash: "original", ativo: extra.ativo ?? true, papeis: { create: { origem: "WIDESYS", legadoId: id, papel: extra.papel ?? "FORNECEDOR", snapshot: "{}", snapshotHash: "papel-original" } } } });
  return id;
}
describe("cadastro de fornecedores", () => {
  it("cria uma pessoa com papel fornecedor, contatos e identidade idempotente, sem despesas", async () => {
    const input = entrada(); const p = await salvarFornecedor(db, input, admin); const replay = await salvarFornecedor(db, input, admin);
    expect(replay.id).toBe(p.id); expect(p).toMatchObject({ nome: input.nome, cpfCnpj: "12345678000199", origem: "BRISA", ativo: true, email: "teste@example.test", editavel: true });
    expect(await db.pessoa.count()).toBe(1); expect(await db.pessoaPapel.count({ where: { papel: "FORNECEDOR" } })).toBe(1);
    expect(await db.despesaDocumento.count()).toBe(0); expect(await db.lancamentoCaixa.count()).toBe(0);
  });
  it("não duplica CPF/CNPJ do legado mesmo com máscara, e adiciona papel somente por confirmação", async () => {
    const id = await pessoaLegada({ papel: "PROPRIETARIO" });
    await expect(salvarFornecedor(db, entrada(), admin)).rejects.toMatchObject({ codigo: "DOCUMENTO_EXISTENTE", existentes: [{ id }] });
    expect(await buscaFornecedores(db, {}, admin)).toHaveLength(0);
    await vincularPessoaFornecedor(db, id, admin); await vincularPessoaFornecedor(db, id, admin);
    expect(await db.pessoa.count()).toBe(1); expect(await db.pessoaPapel.count()).toBe(2);
    expect(await db.pessoa.findUnique({ where: { id } })).toMatchObject({ snapshot: '{"origem":"preservar"}', snapshotHash: "original", cpfCnpj: "12.345.678/0001-99" });
    expect(await buscaFornecedores(db, {}, admin)).toHaveLength(1);
    expect(await buscaFornecedores(db, { termo: "12345678000199" }, admin)).toHaveLength(1);
  });
  it("não junta homônimos sem documento", async () => {
    const a = await salvarFornecedor(db, entrada({ cpfCnpj: "", email: "", telefone: "" }), admin);
    const b = await salvarFornecedor(db, entrada({ cpfCnpj: "", email: "", telefone: "" }), admin);
    expect(a.id).not.toBe(b.id); expect(await db.pessoa.count()).toBe(2);
  });
  it("edita dados nativos e impede sobrescrever uma versão antiga", async () => {
    const p = await salvarFornecedor(db, entrada(), admin);
    const novo = await salvarFornecedor(db, entrada({ id: p.id, atualizadoEm: p.atualizadoEm, nome: "Fornecedor atualizado", cpfCnpj: "01234567890", email: "novo@example.test" }), admin);
    expect(novo.nome).toBe("Fornecedor atualizado"); expect(novo.email).toBe("novo@example.test");
    await expect(salvarFornecedor(db, entrada({ id: p.id, atualizadoEm: "2020-01-01T00:00:00.000Z" }), admin)).rejects.toMatchObject({ codigo: "VERSAO_DESATUALIZADA" });
    expect(await db.pessoaEmail.count()).toBe(1);
    await salvarFornecedor(db, entrada(), admin);
    expect(await db.pessoa.count()).toBe(2);
  });
  it("não muda dados de origem importada", async () => {
    const id = await pessoaLegada();
    await expect(salvarFornecedor(db, entrada({ id }), admin)).rejects.toMatchObject({ codigo: "ORIGEM_PROTEGIDA" });
    await expect(alterarSituacaoFornecedor(db, { id, ativo: false, atualizadoEm: "" }, admin)).rejects.toMatchObject({ codigo: "ORIGEM_PROTEGIDA" });
  });
  it("inativa para novas despesas e permite reativar sem excluir pessoa", async () => {
    const p = await salvarFornecedor(db, entrada(), admin);
    await db.despesaDocumento.create({ data: { fornecedorPessoaId: p.id, fornecedorNome: p.nome, numero: "42", emissao: "2026-10-26", competencia: "2026-10", total: 100, criadoPorId: "admin", atualizadoPorId: "admin" } });
    const inativo = await alterarSituacaoFornecedor(db, { id: p.id, ativo: false, atualizadoEm: p.atualizadoEm }, admin);
    expect(await buscaFornecedores(db, {}, admin)).toEqual([]);
    await expect(resolverFornecedorDespesa(db, p.id)).rejects.toMatchObject({ codigo: "FORNECEDOR_INDISPONIVEL" });
    expect(await db.despesaDocumento.count()).toBe(1); expect((await listarFornecedores(db, { situacao: "INATIVOS" }, admin)).total).toBe(1);
    await alterarSituacaoFornecedor(db, { id: p.id, ativo: true, atualizadoEm: inativo.atualizadoEm }, admin);
    expect(await resolverFornecedorDespesa(db, p.id)).toMatchObject({ ativo: true });
  });
  it("não revela dados de cadastro excluído nem permite duplicar seu documento", async () => {
    const p = await salvarFornecedor(db, entrada(), admin);
    await db.recursoGovernado.create({ data: { tipo: "PESSOA", origemId: p.id, status: "EXCLUIDO", motivo: "teste", autorId: "admin" } });
    expect((await listarFornecedores(db, { situacao: "TODOS" }, admin)).itens).toEqual([]);
    await expect(salvarFornecedor(db, entrada(), admin)).rejects.toMatchObject({ codigo: "DOCUMENTO_EXISTENTE", existentes: [] });
    await expect(vincularPessoaFornecedor(db, p.id, admin)).rejects.toMatchObject({ codigo: "INATIVO" });
    await expect(resolverFornecedorDespesa(db, p.id)).rejects.toMatchObject({ codigo: "FORNECEDOR_INDISPONIVEL" });
  });
  it("reconsulta RBAC e nega escopo restrito, PII negada e escrita sem permissão", async () => {
    const fin = { id: "fin" }; await salvarFornecedor(db, entrada(), fin);
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: '["cadastros.editar"]' } });
    await expect(salvarFornecedor(db, entrada({ cpfCnpj: "01234567890" }), fin)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    expect(await buscaFornecedores(db, {}, fin)).toHaveLength(1);
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: '["cadastros.sensiveis"]' } });
    await expect(buscaFornecedores(db, {}, fin)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: "[]", acessoGlobal: false } });
    await expect(listarFornecedores(db, {}, fin)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });
  it("mistura origens somente na lista de fornecedores e pagina em 25", async () => {
    await pessoaLegada();
    for (let i = 0; i < 26; i++) await salvarFornecedor(db, entrada({ nome: `Empresa ${String(i).padStart(2, "0")}`, cpfCnpj: "", email: "", telefone: "" }), admin);
    const lista = await listarFornecedores(db, {}, admin); expect(lista.total).toBe(27); expect(lista.itens).toHaveLength(25); expect(lista.paginas).toBe(2);
    const ultima = await listarFornecedores(db, { pagina: 2 }, admin); expect(ultima.itens).toHaveLength(2); expect(ultima.itens.some(p => p.origem === "WIDESYS")).toBe(true);
    expect(await buscaFornecedores(db, { termo: "Empresa 01" }, admin)).toHaveLength(1);
  });
});
