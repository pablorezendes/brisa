import { PrismaClient } from "@prisma/client";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarSchemaSinteticoDespesas } from "@/lib/despesas/testes-banco";
import { buscarContratoWidesysParaRecebimento, listarContratosParaRecebimento } from "./contratos-para-recebimento";

let db: PrismaClient;
let pasta: string;
const captura = { capturadoEm: new Date("2026-11-18T12:00:00Z"), snapshot: "{}", snapshotHash: "teste" };

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "brisa-contrato-recebimento-"));
  db = new PrismaClient({ datasources: { db: { url: `file:${join(pasta, "teste.db").replaceAll("\\", "/")}` } } });
  await criarSchemaSinteticoDespesas(db);
  await db.pessoa.create({ data: { id: "pessoa", legadoId: "pessoa-origem", nome: "Locatário importado", nomeNorm: "LOCATARIO IMPORTADO", ...captura } });
  await db.imovelLegado.create({ data: { id: "imovel", legadoId: "imovel-origem", nome: "Sala 204", empreendimentoNome: "Edifício teste", ...captura } });
  await db.contratoLegado.createMany({ data: [
    { id: "vigente", situacaoOrigem: "- Vigente" },
    { id: "encerrado", situacaoOrigem: "- Encerrado" },
    { id: "excluido", situacaoOrigem: "- Vigente" },
    { id: "inconsistente", situacaoOrigem: "- Vigente", statusImportacao: "QUARENTENA" },
  ].map(contrato => ({ ...contrato, legadoId: `${contrato.id}-origem`, ultimoItemId: `item-${contrato.id}`, numeroContrato: "42", imovelLegadoId: "imovel-origem", ...captura })) });
  await db.contratoParteLegado.create({ data: {
    legadoId: "parte-origem", ultimoItemId: "item-parte", contratoId: "vigente", contratoLegadoId: "vigente-origem",
    papel: "INQUILINO", pessoaLegadoId: "pessoa-origem", ...captura,
  } });
  await db.empreendimento.create({ data: { id: "empreendimento", nome: "Base antiga" } });
  await db.unidade.create({ data: { id: "unidade", empreendimentoId: "empreendimento", identificacao: "Casa antiga" } });
  await db.contrato.create({ data: { id: "nativo", unidadeId: "unidade" } });
  await db.recursoGovernado.createMany({ data: [
    { tipo: "CONTRATO_LEGADO", origemId: "excluido" }, { tipo: "CONTRATO", origemId: "nativo" },
  ].map(item => ({ ...item, status: "EXCLUIDO", motivo: "Limpeza da implantação", autorId: "teste" })) });
}, 30000);

afterAll(async () => {
  await db?.$disconnect();
  if (pasta) {
    for (const arquivo of ["teste.db", "teste.db-journal", "teste.db-wal", "teste.db-shm"]) rmSync(join(pasta, arquivo), { force: true });
    rmdirSync(pasta);
  }
});

describe("contratos disponíveis para uma nova cobrança", () => {
  it("usa o contrato Widesys vigente quando os nativos foram excluídos, sem recriar cadastros", async () => {
    expect(await listarContratosParaRecebimento(db)).toEqual([{
      valor: "WIDESYS:vigente", rotulo: "Contrato 42 · Edifício teste · Sala 204 · Locatário importado",
    }]);
    expect(await buscarContratoWidesysParaRecebimento(db, "vigente")).toMatchObject({ id: "vigente", legadoId: "vigente-origem" });
    for (const id of ["encerrado", "excluido", "inconsistente", "inexistente"]) {
      expect(await buscarContratoWidesysParaRecebimento(db, id)).toBeNull();
    }
    expect(await db.contrato.count()).toBe(1);
    expect(await db.contratoLegado.count()).toBe(4);
    expect(await db.pessoa.count()).toBe(1);
  });

  it("revalida a disponibilidade do imóvel antes de aceitar o contrato", async () => {
    const exclusao = await db.recursoGovernado.create({ data: {
      tipo: "IMOVEL_LEGADO", origemId: "imovel", status: "EXCLUIDO", motivo: "Imóvel removido", autorId: "teste",
    } });
    try {
      expect(await buscarContratoWidesysParaRecebimento(db, "vigente")).toBeNull();
      expect(await listarContratosParaRecebimento(db)).toEqual([]);
    } finally { await db.recursoGovernado.delete({ where: { id: exclusao.id } }); }
  });
});
