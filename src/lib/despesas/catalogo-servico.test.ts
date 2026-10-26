import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listarCategoriasDespesas, salvarCategoriaDespesa } from "./catalogo-servico";
import { criarSchemaSinteticoDespesas } from "./testes-banco";
import { obterEditorDespesa, salvarDespesa } from "./servico";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao, fonteLancamentoCaixa } from "../unificacao/fontes";
import { filtroCaixaDespesasRestritas } from "./sigilo-caixa";
import type { SalvarDespesaEntrada } from "./tipos";

let diretorio: string;
let contador = 0;
let requisicao = 0;
let db: PrismaClient;
const banco = (arquivo: string) => new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}` });
const admin = { id: "admin" };
const fin = { id: "fin" };
beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-categorias-"));
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
    { id: "fin", nome: "Financeiro sintético", usuario: "fin", senhaHash: "nao-autenticavel", perfil: "FINANCEIRO", acessoGlobal: true, permissoesExtras: '["despesas.ver","despesas.editar","caixa.editar"]' },
    { id: "socio", nome: "Sócio sintético", usuario: "socio", senhaHash: "nao-autenticavel", perfil: "SOCIO", acessoGlobal: true, permissoesExtras: '["despesas.ver","despesas.editar"]' },
  ] });
});
afterEach(async () => { await db?.$disconnect(); });
afterAll(() => {
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-categorias-")) throw new Error("Fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});
const criarCategoria = (rotulo = "Material de escritório") => salvarCategoriaDespesa(db, { rotulo, ativa: true, restrita: false }, admin);
function entrada(categoriaCodigo: string, extra: Partial<SalvarDespesaEntrada> = {}): SalvarDespesaEntrada {
  return { requestId: `categoria-despesa-qa-${++requisicao}`, fornecedorNome: "Fornecedor sintético", categoriaCodigo,
    descricao: "Itens de expediente", tipoDocumento: "SEM_DOCUMENTO", destinoCusto: "ADMINISTRADORA", numero: "", emissao: "",
    competencia: "2026-10", total: 15000, statusRateio: "CONFERIDO", rateios: [], pagamento: { modo: "MANTER" }, ...extra };
}
const fonteDespesa = async (id: string) => (await derivarFontesUnificacao(await carregarDadosFontesUnificacao(db, "PAGAR"))).find(fonte => fonte.chave === `BRISA:PAGAR:${id}`)!;

describe("catálogo de categorias de despesas", () => {
  it("oferece os padrões sem seed nem escrita e oculta comissões do financeiro", async () => {
    const completo = await listarCategoriasDespesas(db, admin);
    const financeiro = await listarCategoriasDespesas(db, fin);
    expect(completo.gerenciavel).toBe(true);
    expect(financeiro.gerenciavel).toBe(false);
    expect(completo.categorias.find(c => c.codigo === "IMPOSTOS")).toMatchObject({ versao: 0, ativa: true, padrao: true });
    expect(completo.categorias.some(c => c.codigo === "ADMINISTRACAO_COMISSAO")).toBe(true);
    expect(financeiro.categorias.some(c => c.restrita)).toBe(false);
    expect(await db.categoriaDespesa.count()).toBe(0);
  });

  it("cadastra categoria personalizada e usa uma obrigação e um pagamento com a classificação correta", async () => {
    const categoria = await criarCategoria();
    expect(categoria).toMatchObject({ rotulo: "Material de escritório", ativa: true, versao: 1, padrao: false });
    const r = await salvarDespesa(db, entrada(categoria.codigo, { pagamento: { modo: "REGISTRAR", data: "2026-10-10", centroCusto: "BRISA", categoria: "não confiar", via: "PIX" } }), fin);
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(await db.lancamentoCaixa.count()).toBe(1);
    expect(await db.despesaDocumento.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ categoriaCodigo: categoria.codigo, categoriaRotulo: categoria.rotulo });
    expect(await db.lancamentoCaixa.findUniqueOrThrow({ where: { id: r.lancamentoCaixaId! } })).toMatchObject({ categoria: categoria.rotulo, valor: 15000 });
    expect((await fonteDespesa(r.id)).campos.categoria.valor).toBe(categoria.rotulo);
  });

  it.each(["fin", "socio", "inexistente"])("não permite gestão por %s", async id => {
    await expect(salvarCategoriaDespesa(db, { rotulo: "Nova categoria", ativa: true, restrita: false }, { id })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    expect(await db.categoriaDespesa.count()).toBe(0);
  });

  it("revoga leitura e escrita de usuário inativo ou com escopo limitado", async () => {
    await db.usuario.update({ where: { id: "fin" }, data: { ativo: false } });
    await expect(listarCategoriasDespesas(db, fin)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: "fin" }, data: { ativo: true, acessoGlobal: false } });
    await expect(listarCategoriasDespesas(db, fin)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });

  it("impede duplicatas inclusive acentuação, espaços, pontuação e categorias inativas", async () => {
    await expect(criarCategoria("  DESPESAS   DIVERSAS ")).rejects.toMatchObject({ codigo: "CATEGORIA_DUPLICADA" });
    const categoria = await criarCategoria("Apoio técnico");
    await salvarCategoriaDespesa(db, { ...categoria, ativa: false }, admin);
    await expect(criarCategoria("APOIO-TECNICO")).rejects.toMatchObject({ codigo: "CATEGORIA_DUPLICADA" });
    expect(await db.categoriaDespesa.count()).toBe(1);
  });

  it("inativa sem apagar histórico; permite preservar a categoria antiga, mas proíbe novas escolhas", async () => {
    const categoria = await criarCategoria();
    const r = await salvarDespesa(db, entrada(categoria.codigo), fin);
    const inativa = await salvarCategoriaDespesa(db, { ...categoria, ativa: false }, admin);
    expect((await listarCategoriasDespesas(db, fin)).categorias.some(c => c.codigo === categoria.codigo)).toBe(false);
    expect((await listarCategoriasDespesas(db, admin, { incluirInativas: true })).categorias.find(c => c.codigo === categoria.codigo)?.ativa).toBe(false);
    await expect(salvarDespesa(db, entrada(categoria.codigo), fin)).rejects.toMatchObject({ codigo: "CATEGORIA_INATIVA" });
    const editor = await obterEditorDespesa(db, { id: r.id }, fin);
    expect(editor.categorias.find(c => c.codigo === categoria.codigo)?.ativa).toBe(false);
    await salvarDespesa(db, entrada(categoria.codigo, { ...editor.documento, descricao: "Descrição corrigida" }), fin);
    expect(await db.despesaDocumento.count()).toBe(1);
    await salvarCategoriaDespesa(db, { ...inativa, ativa: true }, admin);
    expect((await listarCategoriasDespesas(db, fin)).categorias.some(c => c.codigo === categoria.codigo)).toBe(true);
  });

  it("renomeia a categoria sem alterar o hash da obrigação, a classificação histórica ou o pagamento", async () => {
    const categoria = await criarCategoria();
    const r = await salvarDespesa(db, entrada(categoria.codigo, { pagamento: { modo: "REGISTRAR", data: "2026-10-10", centroCusto: "BRISA", categoria: "", via: "PIX" } }), fin);
    const fonteAntes = await fonteDespesa(r.id);
    const caixaAntes = fonteLancamentoCaixa(await db.lancamentoCaixa.findUniqueOrThrow({ where: { id: r.lancamentoCaixaId! } }));
    await salvarCategoriaDespesa(db, { ...categoria, rotulo: "Suprimentos administrativos" }, admin);
    expect(await fonteDespesa(r.id)).toEqual(fonteAntes);
    expect(fonteLancamentoCaixa(await db.lancamentoCaixa.findUniqueOrThrow({ where: { id: r.lancamentoCaixaId! } }))).toEqual(caixaAntes);
    const editor = await obterEditorDespesa(db, { id: r.id }, fin);
    expect(editor.categorias.find(c => c.codigo === categoria.codigo)?.rotulo).toBe("Suprimentos administrativos");
    await salvarDespesa(db, entrada(categoria.codigo, editor.documento), fin);
    expect(await fonteDespesa(r.id)).toEqual(fonteAntes);
  });

  it("mantém o rótulo padrão antigo para despesas anteriores ao catálogo ao editar outro campo", async () => {
    const r = await salvarDespesa(db, entrada("IMPOSTOS"), fin);
    await db.despesaDocumento.update({ where: { id: r.id }, data: { categoriaRotulo: null } });
    const antes = await fonteDespesa(r.id);
    await salvarCategoriaDespesa(db, { codigo: "IMPOSTOS", rotulo: "Tributos administrativos", ativa: true, restrita: false, versao: 0 }, admin);
    expect(await fonteDespesa(r.id)).toEqual(antes);
    const editor = await obterEditorDespesa(db, { id: r.id }, fin);
    await salvarDespesa(db, entrada("IMPOSTOS", editor.documento), fin);
    expect(await fonteDespesa(r.id)).toEqual(antes);
  });

  it("impede alteração concorrente, códigos forjados e remoção de restrição", async () => {
    const categoria = await criarCategoria();
    await salvarCategoriaDespesa(db, { ...categoria, rotulo: "Material interno" }, admin);
    await expect(salvarCategoriaDespesa(db, { ...categoria, ativa: false }, admin)).rejects.toMatchObject({ codigo: "VERSAO_DESATUALIZADA" });
    await expect(salvarCategoriaDespesa(db, { ...categoria, codigo: "NAO_EXISTE" }, admin)).rejects.toMatchObject({ codigo: "CATEGORIA_INVALIDA" });
    const reservada = await salvarCategoriaDespesa(db, { codigo: "ADMINISTRACAO_COMISSAO", rotulo: "Reservada", ativa: true, restrita: false, versao: 0 }, admin);
    expect(reservada.restrita).toBe(true);
  });

  it("ao transformar categoria em comissão protege despesas anteriores e saídas vinculadas sem alterar dinheiro", async () => {
    const categoria = await criarCategoria();
    const r = await salvarDespesa(db, entrada(categoria.codigo, { pagamento: { modo: "REGISTRAR", data: "2026-10-10", centroCusto: "BRISA", categoria: "", via: "PIX" } }), fin);
    const alterada = await salvarCategoriaDespesa(db, { ...categoria, rotulo: "Comissão interna", restrita: false }, admin);
    expect(alterada.restrita).toBe(true);
    expect(await db.despesaDocumento.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ restrita: true, total: 15000, versao: 2 });
    expect((await fonteDespesa(r.id)).restrito).toBe(true);
    expect(await db.lancamentoCaixa.count({ where: filtroCaixaDespesasRestritas("FINANCEIRO") })).toBe(0);
    expect(await db.lancamentoCaixa.count()).toBe(1);
    await expect(obterEditorDespesa(db, { id: r.id }, fin)).rejects.toMatchObject({ codigo: "COMISSAO_RESTRITA" });
    expect((await listarCategoriasDespesas(db, fin)).categorias.some(c => c.codigo === categoria.codigo)).toBe(false);
    expect((await salvarCategoriaDespesa(db, { ...alterada, rotulo: "Categoria interna", restrita: false }, admin)).restrita).toBe(true);
  });
});
