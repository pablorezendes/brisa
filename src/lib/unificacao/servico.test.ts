import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { carregarDadosFontesUnificacao, carregarFontesUnificacao, derivarFontesUnificacao, type DadosFontesUnificacao } from "./fontes";
import { analisarUnificacao, decidirUnificacao, lerOperacaoUnificada } from "./servico";
import type { FonteUnificacao } from "./tipos";

vi.mock("./fontes", () => ({
  carregarFontesUnificacao: vi.fn(),
  carregarDadosFontesUnificacao: vi.fn(),
  derivarFontesUnificacao: vi.fn(),
}));

let diretorio: string;
let prisma: PrismaClient;
let fontes: FonteUnificacao[];

function fonte(origem: "BRISA" | "WIDESYS", id: string): FonteUnificacao {
  return {
    chave: `${origem}:RECEBER:${id}`, dominio: "RECEBER", origem, origemId: id,
    titulo: "Registro artificial", nomeNorm: "REGISTRO ARTIFICIAL", descricao: "Teste",
    href: null, hash: `${origem}-${id}-v1`, qualidade: "OK", motivos: [], campos: {},
    competencia: "2026-06", valor: 100000, pago: 30000, aberto: 70000,
  };
}

beforeEach(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-unificacao-servico-"));
  prisma = new PrismaClient({ datasourceUrl: `file:${join(diretorio, "fixture.db").replaceAll("\\", "/")}` });
  await prisma.$executeRaw`CREATE TABLE "UnificacaoRegistro" (
    chave TEXT PRIMARY KEY, dominio TEXT NOT NULL, origem TEXT NOT NULL, origemId TEXT NOT NULL,
    status TEXT NOT NULL, destinoChave TEXT, hashFonte TEXT NOT NULL, hashDestino TEXT,
    candidatos TEXT NOT NULL DEFAULT '[]', motivos TEXT NOT NULL DEFAULT '[]',
    proveniencia TEXT NOT NULL DEFAULT '{}', decisao TEXT NOT NULL DEFAULT 'AUTOMATICA',
    versao INTEGER NOT NULL DEFAULT 1, decididoPor TEXT, decididoEm DATETIME,
    criadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (origem, dominio, origemId)
  )`;
  await prisma.$executeRaw`CREATE TABLE "UnificacaoDecisao" (
    id TEXT PRIMARY KEY, registroChave TEXT NOT NULL, acao TEXT NOT NULL,
    estadoAnterior TEXT NOT NULL, estadoNovo TEXT NOT NULL, destinoChave TEXT,
    hashFonte TEXT NOT NULL, hashDestino TEXT, justificativa TEXT NOT NULL,
    usuarioId TEXT NOT NULL, criadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  await prisma.$executeRaw`CREATE TABLE "Recebimento" (id TEXT PRIMARY KEY, contratoId TEXT, mesLancamento TEXT NOT NULL DEFAULT '2026-06', reservaEmissaoToken TEXT)`;
  await prisma.$executeRaw`CREATE TABLE "Boleto" (id TEXT PRIMARY KEY, recebimentoId TEXT NOT NULL, status TEXT NOT NULL)`;
  await prisma.$executeRaw`CREATE TABLE "FechamentoMensal" (id TEXT PRIMARY KEY, mesLancamento TEXT NOT NULL)`;
  fontes = [fonte("BRISA", "principal"), fonte("WIDESYS", "origem")];
  vi.mocked(carregarFontesUnificacao).mockImplementation(async () => fontes);
  vi.mocked(carregarDadosFontesUnificacao).mockResolvedValue({} as DadosFontesUnificacao);
  vi.mocked(derivarFontesUnificacao).mockImplementation(async () => fontes);
});

afterEach(async () => {
  await prisma.$disconnect();
  vi.clearAllMocks();
  const alvo = resolve(diretorio);
  const raiz = `${resolve(tmpdir())}${sep}`.toLowerCase();
  if (alvo.toLowerCase().startsWith(raiz) && basename(alvo).startsWith("brisa-unificacao-servico-")) {
    rmSync(alvo, { recursive: true, force: true });
  }
});

async function entrada(acao: "VINCULAR" | "DISTINTO" | "REABRIR", indice = 1) {
  const registro = await prisma.unificacaoRegistro.findUniqueOrThrow({ where: { chave: fontes[indice].chave } });
  return {
    chave: registro.chave, versao: registro.versao, acao,
    hashFonte: fontes[indice].hash, destinoChave: fontes[0].chave,
    hashDestino: fontes[0].hash, justificativa: "Conferência artificial deste teste.",
  };
}

describe("serviço transacional de unificação", () => {
  it("mês fechado impede união e reabertura do vínculo sem mudar a apuração histórica", async () => {
    await prisma.$executeRaw`INSERT INTO "Recebimento" (id) VALUES ('principal')`;
    await analisarUnificacao(prisma, "teste");
    await decidirUnificacao(prisma, await entrada("VINCULAR"), "teste");
    await prisma.$executeRaw`INSERT INTO "FechamentoMensal" (id, mesLancamento) VALUES ('fechamento', '2026-06')`;
    await expect(decidirUnificacao(prisma, await entrada("REABRIR"), "teste")).rejects.toMatchObject({ codigo: "MES_FECHADO" });
    await expect(decidirUnificacao(prisma, await entrada("VINCULAR"), "teste")).rejects.toMatchObject({ codigo: "MES_FECHADO" });
    expect((await prisma.unificacaoRegistro.findUniqueOrThrow({ where: { chave: fontes[1].chave } })).status).toBe("VINCULADO");
  });

  it("preserva o recebimento Brisa como principal para não perder sua composição", async () => {
    await analisarUnificacao(prisma, "teste");
    await decidirUnificacao(prisma, await entrada("DISTINTO"), "teste");
    await expect(decidirUnificacao(prisma, { ...await entrada("VINCULAR", 0), destinoChave: fontes[1].chave, hashDestino: fontes[1].hash }, "teste")).rejects.toMatchObject({ codigo: "PRESERVAR_COMPOSICAO_NATIVA" });
  });

  it("dry-run não escreve e repetir a análise é idempotente", async () => {
    await expect(analisarUnificacao(prisma, "teste", true)).resolves.toMatchObject({ modo: "DRY_RUN", criados: 2 });
    expect(await prisma.unificacaoRegistro.count()).toBe(0);
    expect(await prisma.unificacaoDecisao.count()).toBe(0);
    await analisarUnificacao(prisma, "teste");
    await expect(analisarUnificacao(prisma, "teste")).resolves.toMatchObject({ criados: 0, atualizados: 0, inalterados: 2 });
    expect(await prisma.unificacaoRegistro.count()).toBe(2);
    expect(await prisma.unificacaoDecisao.count()).toBe(1);
  });

  it("vínculo manual contabiliza somente o principal e sobrevive à reanálise", async () => {
    await analisarUnificacao(prisma, "teste");
    await decidirUnificacao(prisma, await entrada("VINCULAR"), "teste");
    await analisarUnificacao(prisma, "teste");
    const { linhas } = await lerOperacaoUnificada(prisma);
    const contabilizadas = linhas.filter(l => l.contabiliza);
    expect(contabilizadas).toHaveLength(1);
    expect(contabilizadas[0]).toMatchObject({ chave: fontes[0].chave, pago: 30000, aberto: 70000 });
    expect(contabilizadas[0].fontes).toEqual(fontes.map(f => f.chave));
    expect(linhas[1].estado).toBe("VINCULADO");
    expect(await prisma.unificacaoDecisao.count({ where: { acao: "VINCULAR" } })).toBe(1);
  });

  it("uma decisão baseada na mesma versão não sobrescreve a anterior", async () => {
    await analisarUnificacao(prisma, "teste");
    const proposta = await entrada("VINCULAR");
    await decidirUnificacao(prisma, proposta, "primeiro");
    await expect(decidirUnificacao(prisma, { ...proposta, acao: "DISTINTO" }, "segundo"))
      .rejects.toMatchObject({ codigo: "DECISAO_DESATUALIZADA" });
    expect(await prisma.unificacaoDecisao.count({ where: { registroChave: proposta.chave } })).toBe(1);
    expect(await prisma.unificacaoRegistro.findUnique({ where: { chave: proposta.chave } }))
      .toMatchObject({ status: "VINCULADO", decididoPor: "primeiro", versao: 2 });
  });

  it("mudança na fonte invalida a decisão e exige nova conferência mesmo após reanalisar", async () => {
    await analisarUnificacao(prisma, "teste");
    await decidirUnificacao(prisma, await entrada("VINCULAR"), "teste");
    const propostaAntiga = await entrada("DISTINTO");
    fontes[1] = { ...fontes[1], hash: "fonte-v2", pago: 50000, aberto: 50000 };
    await expect(decidirUnificacao(prisma, propostaAntiga, "teste"))
      .rejects.toMatchObject({ codigo: "FONTE_DESATUALIZADA" });
    expect((await lerOperacaoUnificada(prisma)).linhas[1].estado).toBe("REVISAR");
    await analisarUnificacao(prisma, "teste");
    await analisarUnificacao(prisma, "teste");
    const atual = (await lerOperacaoUnificada(prisma)).linhas[1];
    expect(atual).toMatchObject({ estado: "REVISAR", contabiliza: false });
  });

  it("destino alterado após abrir comparação impede a união", async () => {
    await analisarUnificacao(prisma, "teste");
    const proposta = await entrada("VINCULAR");
    fontes[0] = { ...fontes[0], hash: "principal-v2", pago: 60000, aberto: 40000 };
    await expect(decidirUnificacao(prisma, proposta, "teste"))
      .rejects.toMatchObject({ codigo: "DESTINO_DESATUALIZADO" });
    expect(await prisma.unificacaoDecisao.count({ where: { acao: "VINCULAR" } })).toBe(0);
  });

  it("reabrir o principal invalida a projeção dos vínculos dependentes", async () => {
    await analisarUnificacao(prisma, "teste");
    await decidirUnificacao(prisma, await entrada("VINCULAR"), "teste");
    await decidirUnificacao(prisma, await entrada("REABRIR", 0), "teste");
    const { linhas } = await lerOperacaoUnificada(prisma);
    expect(linhas[0].estado).toBe("PENDENTE");
    expect(linhas[1].estado).toBe("REVISAR");
    expect(linhas.every(l => !l.contabiliza)).toBe(true);
  });

  it("nova candidata não fica ativa por ordenar antes de uma decisão manual já confirmada", async () => {
    fontes = [fonte("WIDESYS", "z-confirmada")];
    await analisarUnificacao(prisma, "teste");
    await decidirUnificacao(prisma, await entrada("DISTINTO", 0), "teste");
    fontes.push(fonte("WIDESYS", "a-nova"));
    await analisarUnificacao(prisma, "teste");
    const { linhas } = await lerOperacaoUnificada(prisma);
    expect(linhas.find(l => l.origemId === "z-confirmada")?.estado).toBe("ATIVO");
    expect(linhas.find(l => l.origemId === "a-nova")?.estado).toBe("PENDENTE");
    expect(linhas.filter(l => l.contabiliza)).toHaveLength(1);
  });

  it.each([
    { naturezaOrigem: "SAIDA", informativoOrigem: false, caso: "entrada com saída" },
    { naturezaOrigem: "TRANSFERENCIA", informativoOrigem: true, caso: "entrada com transferência" },
    { naturezaOrigem: "ENTRADA", informativoOrigem: true, caso: "entrada com registro paralelo informativo" },
  ])("impede vincular $caso sem perder uma movimentação", async ({ naturezaOrigem, informativoOrigem }) => {
    fontes = fontes.map((f, indice) => ({
      ...f,
      chave: `${f.origem}:MOVIMENTO:${f.origemId}`,
      dominio: "MOVIMENTO",
      natureza: indice === 0 ? "ENTRADA" : naturezaOrigem,
      informativo: indice === 0 ? false : informativoOrigem,
      data: "2026-06-15",
    }));
    await analisarUnificacao(prisma, "teste");
    await expect(decidirUnificacao(prisma, await entrada("VINCULAR"), "teste"))
      .rejects.toMatchObject({ name: "ErroUnificacao" });
    expect(await prisma.unificacaoDecisao.count({ where: { acao: "VINCULAR" } })).toBe(0);
    expect(await prisma.unificacaoRegistro.findUnique({ where: { chave: fontes[1].chave } }))
      .not.toMatchObject({ status: "VINCULADO" });
  });

  it("vincula baixa e título preservando a evidência das duas fontes sem resomar pagamento", async () => {
    fontes.push(...fontes.map((titulo): FonteUnificacao => ({
      ...titulo,
      chave: `${titulo.origem}:BAIXA_RECEBER:baixa`, origemId: "baixa",
      dominio: "BAIXA_RECEBER", tituloChave: titulo.chave,
      valor: 30000, pago: undefined, aberto: undefined, data: "2026-06-15",
      informativo: true, hash: `${titulo.origem}-baixa-v1`,
    })));
    await analisarUnificacao(prisma, "teste");
    await decidirUnificacao(prisma, await entrada("VINCULAR"), "teste");
    await analisarUnificacao(prisma, "teste");
    await decidirUnificacao(prisma, {
      ...await entrada("VINCULAR", 3), destinoChave: fontes[2].chave,
      hashDestino: fontes[2].hash,
    }, "teste");

    const { linhas } = await lerOperacaoUnificada(prisma);
    const principal = linhas.find(l => l.chave === fontes[0].chave)!;
    const historico = linhas.filter(l => l.dominio === "BAIXA_RECEBER" && principal.fontes.includes(l.tituloChave!));
    expect(historico).toHaveLength(2);
    expect(historico.find(l => l.estado === "ATIVO")?.fontes).toEqual([fontes[2].chave, fontes[3].chave]);
    expect(historico.every(l => !l.contabiliza)).toBe(true);
    expect(linhas.filter(l => l.contabiliza).reduce((soma, l) => soma + (l.pago ?? 0), 0)).toBe(30000);
  });

  it.each(["RESERVA", "EMITINDO", "REGISTRADO"])("impede vínculo de título durante operação bancária %s", async status => {
    await prisma.$executeRaw`INSERT INTO "Recebimento" (id, reservaEmissaoToken) VALUES ('principal', ${status === "RESERVA" ? "reserva-teste" : null})`;
    if (status !== "RESERVA") {
      await prisma.$executeRaw`INSERT INTO "Boleto" (id, recebimentoId, status) VALUES ('boleto-teste', 'principal', ${status})`;
    }
    await analisarUnificacao(prisma, "teste");
    await expect(decidirUnificacao(prisma, await entrada("VINCULAR"), "teste"))
      .rejects.toMatchObject({ name: "ErroUnificacao" });
    expect(await prisma.unificacaoDecisao.count({ where: { acao: "VINCULAR" } })).toBe(0);
  });

  it.each([
    { status: "RESERVA", lado: "principal" }, { status: "EMITINDO", lado: "principal" }, { status: "REGISTRADO", lado: "principal" },
    { status: "RESERVA", lado: "origem" }, { status: "EMITINDO", lado: "origem" }, { status: "REGISTRADO", lado: "origem" },
  ])("impede vínculo do contrato Brisa como $lado durante $status", async ({ status, lado }) => {
    fontes = fontes.map(f => ({ ...f, dominio: "CONTRATO", chave: `${f.origem}:CONTRATO:${f.origemId}` }));
    await prisma.$executeRaw`INSERT INTO "Recebimento" (id, contratoId, reservaEmissaoToken) VALUES ('r-contrato', 'principal', ${status === "RESERVA" ? "reserva-teste" : null})`;
    if (status !== "RESERVA") {
      await prisma.$executeRaw`INSERT INTO "Boleto" (id, recebimentoId, status) VALUES ('boleto-teste', 'r-contrato', ${status})`;
    }
    await analisarUnificacao(prisma, "teste");
    if (lado === "origem") await decidirUnificacao(prisma, await entrada("DISTINTO"), "teste");
    const proposta = lado === "origem"
      ? { ...await entrada("VINCULAR", 0), destinoChave: fontes[1].chave, hashDestino: fontes[1].hash }
      : await entrada("VINCULAR");
    await expect(decidirUnificacao(prisma, proposta, "teste"))
      .rejects.toMatchObject({ name: "ErroUnificacao" });
    expect(await prisma.unificacaoDecisao.count({ where: { acao: "VINCULAR" } })).toBe(0);
  });

  it("mantém o Widesys principal e o novo nativo pendente em análises repetidas", async () => {
    fontes = [fonte("WIDESYS", "primeiro")];
    await analisarUnificacao(prisma, "teste");
    fontes.push(fonte("BRISA", "novo"));
    await analisarUnificacao(prisma, "teste");
    const depoisDaPrimeira = await prisma.unificacaoRegistro.findMany({
      orderBy: { chave: "asc" }, select: { chave: true, status: true, versao: true },
    });
    expect(depoisDaPrimeira).toEqual([
      { chave: "BRISA:RECEBER:novo", status: "PENDENTE", versao: 1 },
      { chave: "WIDESYS:RECEBER:primeiro", status: "ATIVO", versao: expect.any(Number) },
    ]);
    await expect(analisarUnificacao(prisma, "teste")).resolves.toMatchObject({ criados: 0, atualizados: 0, inalterados: 2 });
    const depoisDaSegunda = await prisma.unificacaoRegistro.findMany({
      orderBy: { chave: "asc" }, select: { chave: true, status: true, versao: true },
    });
    expect(depoisDaSegunda).toEqual(depoisDaPrimeira);
    expect((await lerOperacaoUnificada(prisma)).linhas.filter(l => l.contabiliza).map(l => l.chave))
      .toEqual(["WIDESYS:RECEBER:primeiro"]);
  });
});
