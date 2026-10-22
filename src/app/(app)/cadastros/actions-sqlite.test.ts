import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acesso: vi.fn(), sessao: vi.fn(), revalidar: vi.fn(), redirect: vi.fn(),
  banco: undefined as unknown as PrismaClient,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/auth", () => ({ exigirSessao: mocks.sessao }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/consultas/locacao", () => ({ TIPOS_UNIDADE: ["residencial", "comercial", "temporada"] }));
vi.mock("@/lib/db", () => ({ get prisma() { return mocks.banco; } }));

import { atualizarUnidade } from "./actions";

let diretorio: string;
let db: PrismaClient;

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.acesso.mockResolvedValue({ perfil: "ADMINISTRADOR" });
  mocks.sessao.mockResolvedValue({ sub: "admin-sintetico" });
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });
  diretorio = mkdtempSync(join(tmpdir(), "brisa-mover-unidade-"));
  db = new PrismaClient({ datasourceUrl: `file:${join(diretorio, "isolado.db").replaceAll("\\", "/")}` });
  mocks.banco = db;

  // Apenas schema e dados sintéticos: nunca abre nem copia a base da aplicação.
  const tabelas = new Set([
    "Empreendimento", "Unidade", "Contrato", "Locatario", "Recebimento",
    "PagamentoRecebimento", "FechamentoMensal", "RecursoGovernado",
  ]);
  for (const modelo of Prisma.dmmf.datamodel.models.filter(m => tabelas.has(m.name))) {
    const colunas = modelo.fields.filter(f => f.kind !== "object").map(f => {
      const tipo = ["Int", "BigInt", "Boolean"].includes(f.type) ? "INTEGER"
        : f.type === "Float" ? "REAL" : f.type === "DateTime" ? "DATETIME" : "TEXT";
      const d = f.default;
      const padrao = typeof d === "boolean" ? ` DEFAULT ${d ? 1 : 0}`
        : typeof d === "number" ? ` DEFAULT ${d}`
        : typeof d === "string" ? ` DEFAULT '${d.replaceAll("'", "''")}'`
        : f.type === "DateTime" ? " DEFAULT CURRENT_TIMESTAMP" : "";
      return `"${f.name}" ${tipo}${f.isId ? " PRIMARY KEY" : ""}${f.isRequired ? " NOT NULL" : ""}${f.isUnique ? " UNIQUE" : ""}${padrao}`;
    });
    for (const campos of modelo.uniqueFields) colunas.push(`UNIQUE (${campos.map(c => `"${c}"`).join(",")})`);
    for (const relacao of modelo.fields.filter(f => f.kind === "object" && tabelas.has(f.type) && f.relationFromFields?.length)) {
      colunas.push(`FOREIGN KEY (${relacao.relationFromFields!.map(c => `"${c}"`).join(",")}) REFERENCES "${relacao.type}" (${relacao.relationToFields!.map(c => `"${c}"`).join(",")})`);
    }
    await db.$executeRawUnsafe(`CREATE TABLE "${modelo.name}" (${colunas.join(",")})`);
  }
  await db.empreendimento.createMany({ data: [
    { id: "origem", nome: "ORIGEM SINTETICA" }, { id: "destino", nome: "DESTINO SINTETICO" },
  ] });
  await db.unidade.createMany({ data: [
    { id: "mover", empreendimentoId: "origem", identificacao: "SALA 01", tipo: "comercial" },
    { id: "outro", empreendimentoId: "origem", identificacao: "SALA 02" },
  ] });
  await db.locatario.create({ data: { id: "inquilino", nome: "Inquilino sintético", nomeNorm: "INQUILINO SINTETICO" } });
  await db.contrato.createMany({ data: [
    { id: "ativo", unidadeId: "mover", locatarioId: "inquilino", status: "ativo", valorBase: 123456, iptu: 1200, condominio: 3000, diaVencimento: 10 },
    { id: "encerrado", unidadeId: "mover", locatarioId: "inquilino", status: "encerrado", valorBase: 98765, inicio: "2025-01-01", fim: "2025-12-31" },
    { id: "alheio", unidadeId: "outro", status: "ativo", valorBase: 55555 },
  ] });
  await db.recebimento.createMany({ data: [
    { id: "aberto", contratoId: "ativo", empreendimentoId: "origem", mesLancamento: "2026-06", competencia: "2026-06", valor: 123456, iptu: 1200, cond: 3000, recebido: null, taxaComissaoBps: 800 },
    { id: "pago", contratoId: "ativo", empreendimentoId: "origem", mesLancamento: "2026-05", competencia: "2026-05", valor: 123456, recebido: 123456, dataPagamento: "2026-05-10", via: "PIX", taxaComissaoBps: 900 },
    { id: "historico", contratoId: "encerrado", empreendimentoId: "origem", mesLancamento: "2025-12", competencia: "2025-12", valor: 98765, recebido: 98765, taxaComissaoBps: 1000 },
    { id: "recebimento-alheio", contratoId: "alheio", empreendimentoId: "origem", mesLancamento: "2026-06", competencia: "2026-06", valor: 55555, recebido: 50000, taxaComissaoBps: 500 },
  ] });
  await db.pagamentoRecebimento.create({ data: {
    id: "pagamento", recebimentoId: "pago", chaveIdempotencia: "pagamento-sintetico",
    valor: 123456, dataPagamento: "2026-05-10", forma: "PIX", origem: "MANUAL",
    conciliadoEm: new Date("2026-05-10T12:00:00.000Z"),
  } });
  await db.fechamentoMensal.create({ data: {
    id: "fechamento", mesLancamento: "2026-05", comissaoTotal: 11111,
    detalhe: '[{"empreendimento":"origem","valor":11111}]',
  } });
}, 20000);

afterEach(async () => {
  if (db) await db.$disconnect();
  // Remove somente o diretório temporário exato criado por este teste.
  if (diretorio) {
    const absoluto = resolve(diretorio);
    if (!absoluto.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(absoluto).startsWith("brisa-mover-unidade-")) {
      throw new Error("Diretório de teste fora do escopo temporário.");
    }
    rmSync(absoluto, { recursive: true, force: true });
  }
});

function formulario() {
  const form = new FormData();
  for (const [chave, valor] of Object.entries({ id: "mover", empreendimentoId: "destino", identificacao: "SALA 01", tipo: "comercial" })) form.set(chave, valor);
  return form;
}

async function executar() {
  await expect(atualizarUnidade(formulario())).rejects.toThrow("REDIRECT:");
  return new URL(mocks.redirect.mock.calls[0][0], "https://brisa.invalid").searchParams;
}

async function retrato() {
  return {
    unidades: await db.unidade.findMany({ orderBy: { id: "asc" } }),
    contratos: await db.contrato.findMany({ orderBy: { id: "asc" } }),
    recebimentos: await db.recebimento.findMany({ orderBy: { id: "asc" } }),
    pagamentos: await db.pagamentoRecebimento.findMany({ orderBy: { id: "asc" } }),
    fechamentos: await db.fechamentoMensal.findMany({ orderBy: { id: "asc" } }),
    governanca: await db.recursoGovernado.findMany({ orderBy: { id: "asc" } }),
  };
}

describe("atualizarUnidade — integração transacional com SQLite sintético", () => {
  it("reclassifica contratos ativos e encerrados, preserva pagamentos, snapshots e outros imóveis", async () => {
    const antes = await retrato();
    const resultado = await executar();
    const depois = await retrato();

    expect(resultado.has("erro")).toBe(false);
    expect(resultado.get("ok")).toContain("Empreendimento alterado.");
    expect(depois).toEqual({
      ...antes,
      unidades: antes.unidades.map(u => u.id === "mover" ? { ...u, empreendimentoId: "destino" } : u),
      recebimentos: antes.recebimentos.map(r => r.contratoId !== "alheio" ? { ...r, empreendimentoId: "destino" } : r),
    });
    const contratos = await db.contrato.findMany({ where: { unidadeId: "mover" }, include: { unidade: true } });
    expect(contratos).toHaveLength(2);
    expect(contratos.every(c => c.unidade.empreendimentoId === "destino")).toBe(true);
    expect(mocks.revalidar).toHaveBeenCalledWith("/", "layout");
  });

  it("preserva a base inteira quando a unicidade real do destino gera P2002", async () => {
    await db.unidade.create({ data: { id: "colisao", empreendimentoId: "destino", identificacao: "SALA 01" } });
    const antes = await retrato();
    const resultado = await executar();

    expect(resultado.get("erro")).toBe("Essa identificação já existe no empreendimento selecionado.");
    expect(await retrato()).toEqual(antes);
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });

  it("faz rollback real da unidade se a reclassificação de recebimentos falhar", async () => {
    const antes = await retrato();
    await db.$executeRawUnsafe(`CREATE TRIGGER "falha_sintetica_recebimentos"
      BEFORE UPDATE OF "empreendimentoId" ON "Recebimento"
      WHEN NEW."empreendimentoId" = 'destino'
      BEGIN SELECT RAISE(ABORT, 'FALHA_SINTETICA_RECEBIMENTOS'); END`);
    const resultado = await executar();

    expect(resultado.get("erro")).toBe("Não foi possível atualizar o imóvel.");
    expect(await retrato()).toEqual(antes);
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
});
