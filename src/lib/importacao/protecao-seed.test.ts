import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importarDataset, type Dataset } from "./importar";
import { ErroSeedBaseNaoVazia, exigirBaseVaziaParaSeed } from "./protecao-seed";

const datasetVazio: Dataset = {
  recebimentos: [],
  taxas_comissao: {},
  rent_roll: [],
  contratos: [],
  airbnb_apuracao: {},
  livro_caixa: {},
  centros_de_custo: {},
};

let diretorio: string;
let prisma: PrismaClient;

beforeEach(() => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-seed-guard-"));
  prisma = new PrismaClient({
    datasourceUrl: `file:${join(diretorio, "fixture.db").replaceAll("\\", "/")}`,
  });
});

afterEach(async () => {
  await prisma.$disconnect();
  const alvo = resolve(diretorio);
  const raizTemporaria = `${resolve(tmpdir())}${sep}`.toLowerCase();
  if (alvo.toLowerCase().startsWith(raizTemporaria) && basename(alvo).startsWith("brisa-seed-guard-")) {
    rmSync(alvo, { recursive: true, force: true });
  }
});

describe("proteção da carga inicial de planilhas", () => {
  it("permite banco operacional vazio com usuário e contas de bootstrap", async () => {
    await prisma.$executeRaw`CREATE TABLE "Usuario" (id TEXT PRIMARY KEY)`;
    await prisma.$executeRaw`INSERT INTO "Usuario" (id) VALUES ('usuario-artificial')`;
    await prisma.$executeRaw`CREATE TABLE "ContaBancaria" (id TEXT PRIMARY KEY)`;
    await prisma.$executeRaw`INSERT INTO "ContaBancaria" (id) VALUES ('conta-artificial')`;
    await prisma.$executeRaw`CREATE TABLE "Contrato" (id TEXT PRIMARY KEY)`;

    await expect(importarDataset(prisma, datasetVazio)).resolves.toMatchObject({
      contratos: 0,
      recebimentos: 0,
      lancamentosCaixa: 0,
    });
    await expect(prisma.$queryRaw`SELECT id FROM "Usuario"`).resolves.toEqual([{ id: "usuario-artificial" }]);
    await expect(prisma.$queryRaw`SELECT id FROM "ContaBancaria"`).resolves.toEqual([{ id: "conta-artificial" }]);
  });

  it.each([
    "Recebimento", "FechamentoMensal", "Pessoa", "TituloFinanceiroLegado",
    "Boleto", "PagamentoRecebimento", "UnificacaoRegistro",
  ])("bloqueia dados existentes em %s sem modificar a tabela", async (tabela) => {
    // Somente nomes da lista literal acima; banco descartável criado neste teste.
    await prisma.$executeRawUnsafe(`CREATE TABLE "${tabela}" (id TEXT PRIMARY KEY)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "${tabela}" (id) VALUES ('preservado')`);

    await expect(importarDataset(prisma, datasetVazio)).rejects.toMatchObject({
      codigo: "SEED_BASE_NAO_VAZIA",
      tabelasComDados: [tabela],
    });
    await expect(prisma.$queryRawUnsafe(`SELECT id FROM "${tabela}"`)).resolves.toEqual([{ id: "preservado" }]);
  });

  it("aceita tabela de unificação existente e vazia mesmo sem delegate Prisma", async () => {
    await prisma.$executeRaw`CREATE TABLE "UnificacaoRegistro" (id TEXT PRIMARY KEY)`;
    await expect(exigirBaseVaziaParaSeed(prisma)).resolves.toBeUndefined();
  });

  it("explica como continuar a importação sem oferecer reset", () => {
    const erro = new ErroSeedBaseNaoVazia(["Contrato"]);
    expect(erro.message).toContain("Use o fluxo de importação e unificação");
    expect(erro.message).toContain("Nenhum registro foi alterado");
  });
});
