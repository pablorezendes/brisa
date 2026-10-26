import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { salvarDespesa, obterEditorDespesa } from "./servico";
import type { SalvarDespesaEntrada } from "./tipos";
import { criarSchemaSinteticoDespesas } from "./testes-banco";
import { previaGovernanca } from "../governanca/servico";

let dir: string, db: PrismaClient, sequencia = 0;
const banco = (arquivo: string) => new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}` });
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "brisa-fornecedor-despesa-"));
  const modelo = banco(join(dir, "modelo.db"));
  await criarSchemaSinteticoDespesas(modelo);
  await modelo.$disconnect();
}, 30000);
beforeEach(async () => {
  const arquivo = join(dir, `teste-${++sequencia}.db`);
  copyFileSync(join(dir, "modelo.db"), arquivo);
  db = banco(arquivo);
  await db.usuario.createMany({ data: [
    { id: "admin", nome: "Administrador sintético", usuario: "admin", senhaHash: "nao-autenticavel", perfil: "ADMINISTRADOR" },
    { id: "fin", nome: "Financeiro sintético", usuario: "fin", senhaHash: "nao-autenticavel", perfil: "FINANCEIRO", acessoGlobal: true, permissoesExtras: '["despesas.editar"]' },
  ] });
  await db.pessoa.create({ data: {
    id: "fornecedor", origem: "BRISA", legadoId: "fornecedor", nome: "Oficina sintética", nomeNorm: "OFICINA SINTETICA", cpfCnpj: "12345678000199", snapshot: "{}", snapshotHash: "sintetico",
    papeis: { create: { origem: "BRISA", legadoId: "fornecedor", papel: "FORNECEDOR", snapshot: "{}", snapshotHash: "sintetico" } },
  } });
});
afterEach(async () => { await db.$disconnect(); });
afterAll(() => {
  const alvo = resolve(dir);
  if (!alvo.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(alvo).startsWith("brisa-fornecedor-despesa-")) throw new Error("Fora do diretório sintético.");
  rmSync(alvo, { recursive: true, force: true });
});
function entrada(extra: Partial<SalvarDespesaEntrada> = {}): SalvarDespesaEntrada {
  return { requestId: `despesa-fornecedor-${++sequencia}`, fornecedorPessoaId: "fornecedor", fornecedorNome: "Nome recebido do navegador", fornecedorDocumento: null,
    categoriaCodigo: "MANUTENCAO_SERVICOS", descricao: "Manutenção sintética", destinoCusto: "ADMINISTRADORA", tipoDocumento: "SEM_DOCUMENTO", numero: "", emissao: "", competencia: "2026-10", total: 15000, rateios: [], statusRateio: "CONFERIDO", pagamento: { modo: "MANTER" }, ...extra };
}
describe("fornecedor vinculado à despesa", () => {
  it("usa a pessoa existente e seus dados confirmados sem cadastrar ou pagar novamente", async () => {
    const input = entrada();
    const r = await salvarDespesa(db, input, { id: "admin" });
    expect((await salvarDespesa(db, input, { id: "admin" })).repetido).toBe(true);
    expect(await db.despesaDocumento.findUnique({ where: { id: r.id } })).toMatchObject({ fornecedorPessoaId: "fornecedor", fornecedorNome: "Oficina sintética", fornecedorDocumento: "12345678000199" });
    expect(await db.pessoa.count()).toBe(1);
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect((await obterEditorDespesa(db, { id: r.id }, { id: "admin" })).documento.fornecedorPessoaId).toBe("fornecedor");
    expect((await previaGovernanca(db, "PESSOA", "fornecedor")).vinculos.despesas).toBe(1);
    expect((await previaGovernanca(db, "PESSOA", "fornecedor")).podeExcluir).toBe(false);
  });
  it("preserva os dados da despesa antiga após renomear ou inativar o fornecedor", async () => {
    const r = await salvarDespesa(db, entrada(), { id: "admin" });
    await db.pessoa.update({ where: { id: "fornecedor" }, data: { ativo: false, nome: "Outro nome" } });
    const editor = await obterEditorDespesa(db, { id: r.id }, { id: "admin" });
    await salvarDespesa(db, entrada({ ...editor.documento, descricao: "Descrição ajustada", fornecedorNome: "Nome forjado" }), { id: "admin" });
    expect(await db.despesaDocumento.findUnique({ where: { id: r.id } })).toMatchObject({ fornecedorNome: "Oficina sintética", fornecedorDocumento: "12345678000199", fornecedorPessoaId: "fornecedor" });
    await expect(salvarDespesa(db, entrada(), { id: "admin" })).rejects.toThrow();
  });
  it("rejeita novo vínculo com cadastro ausente, sem papel fornecedor ou excluído", async () => {
    await expect(salvarDespesa(db, entrada({ fornecedorPessoaId: "nao-existe" }), { id: "admin" })).rejects.toThrow();
    await db.pessoaPapel.deleteMany({ where: { pessoaId: "fornecedor" } });
    await expect(salvarDespesa(db, entrada(), { id: "admin" })).rejects.toThrow();
    await db.pessoaPapel.create({ data: { pessoaId: "fornecedor", origem: "BRISA", legadoId: "fornecedor", papel: "FORNECEDOR", snapshot: "{}", snapshotHash: "sintetico" } });
    await db.recursoGovernado.create({ data: { tipo: "PESSOA", origemId: "fornecedor", status: "EXCLUIDO", motivo: "Exclusão sintética", autorId: "admin" } });
    await expect(salvarDespesa(db, entrada(), { id: "admin" })).rejects.toThrow();
    expect(await db.despesaDocumento.count()).toBe(0);
  });
  it("exige permissão de dados pessoais para vincular um fornecedor por ID", async () => {
    await expect(salvarDespesa(db, entrada(), { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesExtras: '["despesas.editar","cadastros.sensiveis"]' } });
    expect(await salvarDespesa(db, entrada(), { id: "fin" })).toHaveProperty("id");
    await db.usuario.update({ where: { id: "fin" }, data: { permissoesNegadas: '["cadastros.ver"]' } });
    await expect(salvarDespesa(db, entrada(), { id: "fin" })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });
  it("deduplica a nota pelo documento do fornecedor cadastrado, mesmo omitido no formulário", async () => {
    const nota = { tipoDocumento: "NOTA_FISCAL" as const, numero: "42", emissao: "2026-10-07" };
    await salvarDespesa(db, entrada(nota), { id: "admin" });
    await expect(salvarDespesa(db, entrada(nota), { id: "admin" })).rejects.toMatchObject({ codigo: "DUPLICIDADE" });
    expect(await db.despesaDocumento.count()).toBe(1);
  });
});
