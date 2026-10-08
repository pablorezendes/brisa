import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisaoUnificacao, LinhaUnificada } from "../unificacao/tipos";

const mocks = vi.hoisted(() => ({ candidato: vi.fn(), fechamentos: vi.fn(), operacao: vi.fn(), governados: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../db", () => ({ prisma: {
  unificacaoRegistro: { findFirst: mocks.candidato },
  fechamentoMensal: { findMany: mocks.fechamentos },
  recursoGovernado: { findMany: mocks.governados },
} }));
vi.mock("../unificacao/servico", () => ({ lerOperacaoUnificada: mocks.operacao }));

import { filtroCaixaUnificado, filtroRecebimentosUnificados } from "./filtro-unificacao-nativa";

function linha(chave: string, estado: LinhaUnificada["estado"] = "ATIVO"): LinhaUnificada {
  const [origem, dominio, origemId] = chave.split(":");
  return {
    chave, origem: origem as LinhaUnificada["origem"], dominio: dominio as LinhaUnificada["dominio"], origemId,
    titulo: "Registro artificial", descricao: "Teste", nomeNorm: "REGISTRO ARTIFICIAL", href: null,
    hash: `${chave}-v1`, qualidade: "OK", motivos: [], campos: {}, estado, origens: [origem], fontes: [chave],
    versao: 1, candidatos: [], avisos: [], contabiliza: estado === "ATIVO", divergencias: [],
  };
}

function decisao(fonte: LinhaUnificada, destinoChave: string): DecisaoUnificacao {
  return {
    chave: fonte.chave, dominio: fonte.dominio, origem: fonte.origem, origemId: fonte.origemId,
    status: "VINCULADO", destinoChave, hashFonte: fonte.hash, hashDestino: `${destinoChave}-v1`,
    candidatos: "[]", motivos: "[]", proveniencia: "{}", decisao: "MANUAL", versao: 1,
  };
}

function operacao(linhas: LinhaUnificada[], decisoes: DecisaoUnificacao[]) {
  mocks.candidato.mockResolvedValue({ chave: decisoes[0]?.chave ?? "artificial" });
  mocks.operacao.mockResolvedValue({ linhas, decisoes });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.candidato.mockResolvedValue(null);
  mocks.fechamentos.mockResolvedValue([]);
  mocks.governados.mockResolvedValue([]);
  mocks.operacao.mockResolvedValue({ linhas: [], decisoes: [] });
});

describe("filtros das apurações nativas reconciliadas", () => {
  it("excluir → fechar → restaurar volta à operação sem reescrever o fechamento", async () => {
    let excluido = true;
    const fechamento = { mesLancamento: "2026-06", unificacaoExcluidos: '["restaurado", "copia-historica"]', fechadoEm: new Date("2026-07-02T12:00:00Z") };
    const historico = [
      { acao: "ATIVO", estadoAnterior: "EXCLUIDO", estadoNovo: "ATIVO", criadoEm: new Date("2026-07-03T12:00:00Z") },
      { acao: "EXCLUIDO", estadoAnterior: "ATIVO", estadoNovo: "EXCLUIDO", criadoEm: new Date("2026-07-01T12:00:00Z") },
    ];
    mocks.governados.mockImplementation(async ({ where }) => {
      if (where.tipo !== "TITULO") return [];
      if (where.status === "ATIVO") return excluido ? [] : [{ origemId: "BRISA:RECEBER:restaurado", status: "ATIVO", eventos: historico }];
      return excluido ? [{ origemId: "BRISA:RECEBER:restaurado" }] : [];
    });
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({ id: { notIn: ["restaurado"] } });
    mocks.fechamentos.mockResolvedValue([fechamento]);
    expect(JSON.stringify(await filtroRecebimentosUnificados())).toContain("restaurado");
    excluido = false;
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({ OR: [
      { mesLancamento: { notIn: ["2026-06"] } },
      { mesLancamento: "2026-06", id: { notIn: ["copia-historica"] } },
    ] });
    expect(fechamento.unificacaoExcluidos).toBe('["restaurado", "copia-historica"]');
  });
  it.each([2, 5])("preserva restauração após %s ciclos excluir/restaurar sem liberar a cópia histórica", async ciclos => {
    let excluido = true;
    const snapshot = '["restaurado", "copia-historica"]';
    const fechamento = { mesLancamento: "2026-06", unificacaoExcluidos: snapshot, fechadoEm: new Date("2026-07-02T12:00:00Z") };
    const eventos = [{ acao: "EXCLUIDO", estadoAnterior: "ATIVO", estadoNovo: "EXCLUIDO", criadoEm: new Date("2026-07-01T12:00:00Z") }];
    mocks.governados.mockImplementation(async ({ where }) => {
      if (where.tipo !== "TITULO") return [];
      if (where.status === "ATIVO") return excluido ? [] : [{ origemId: "BRISA:RECEBER:restaurado", status: "ATIVO", eventos }];
      return excluido ? [{ origemId: "BRISA:RECEBER:restaurado" }] : [];
    });
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({ id: { notIn: ["restaurado"] } });
    mocks.fechamentos.mockResolvedValue([fechamento]);
    for (let ciclo = 0; ciclo < ciclos; ciclo++) {
      if (ciclo > 0) {
        excluido = true;
        eventos.unshift({ acao: "EXCLUIDO", estadoAnterior: "ATIVO", estadoNovo: "EXCLUIDO", criadoEm: new Date(Date.UTC(2026, 6, 3 + ciclo * 2)) });
      }
      expect((await filtroRecebimentosUnificados()).OR?.[1]).toEqual({ mesLancamento: "2026-06", id: { notIn: ["restaurado", "copia-historica"] } });
      excluido = false;
      eventos.unshift({ acao: "ATIVO", estadoAnterior: "EXCLUIDO", estadoNovo: "ATIVO", criadoEm: new Date(Date.UTC(2026, 6, 4 + ciclo * 2)) });
      expect((await filtroRecebimentosUnificados()).OR?.[1]).toEqual({ mesLancamento: "2026-06", id: { notIn: ["copia-historica"] } });
      expect(fechamento.unificacaoExcluidos).toBe(snapshot);
    }
    const consultaHistorico = mocks.governados.mock.calls.find(([arg]) => arg.where.status === "ATIVO");
    expect(consultaHistorico?.[0].select.eventos.take).toBeUndefined();
  });
  it.each(["cadeia-incompleta", "outra-decisao", "ativo-ao-fechar", "data-invalida"])("mantém snapshot quando múltiplos ciclos não comprovam restauração: %s", async caso => {
    mocks.fechamentos.mockResolvedValue([{ mesLancamento: "2026-06", unificacaoExcluidos: '["copia"]', fechadoEm: new Date("2026-07-02T12:00:00Z") }]);
    const eventos = [
      { acao: "ATIVO", estadoAnterior: "EXCLUIDO", estadoNovo: "ATIVO", criadoEm: new Date("2026-07-05T12:00:00Z") },
      { acao: "EXCLUIDO", estadoAnterior: "ATIVO", estadoNovo: "EXCLUIDO", criadoEm: new Date("2026-07-04T12:00:00Z") },
      { acao: "ATIVO", estadoAnterior: "EXCLUIDO", estadoNovo: "ATIVO", criadoEm: new Date("2026-07-03T12:00:00Z") },
      { acao: "EXCLUIDO", estadoAnterior: "ATIVO", estadoNovo: "EXCLUIDO", criadoEm: new Date("2026-07-01T12:00:00Z") },
    ];
    if (caso === "cadeia-incompleta") eventos.splice(2, 1);
    if (caso === "outra-decisao") eventos[2].acao = "DESCARTADO";
    if (caso === "ativo-ao-fechar") eventos[2].criadoEm = new Date("2026-07-01T13:00:00Z");
    if (caso === "data-invalida") eventos[2].criadoEm = new Date("inválida");
    mocks.governados.mockImplementation(async ({ where }) => where.status === "ATIVO" ? [{ origemId: "BRISA:RECEBER:copia", status: "ATIVO", eventos }] : []);
    expect((await filtroRecebimentosUnificados()).OR?.[1]).toEqual({ mesLancamento: "2026-06", id: { notIn: ["copia"] } });
  });
  it.each(["sem-evento", "anterior-ao-fechamento", "exclusao-posterior", "duplicata-atual"])("não libera snapshot por restauração sem prova válida: %s", async caso => {
    mocks.fechamentos.mockResolvedValue([{ mesLancamento: "2026-06", unificacaoExcluidos: '["copia"]', fechadoEm: new Date("2026-07-02T12:00:00Z") }]);
    const eventos = caso === "sem-evento" ? [] : [
      { acao: "ATIVO", estadoAnterior: "EXCLUIDO", estadoNovo: "ATIVO", criadoEm: new Date(caso === "anterior-ao-fechamento" ? "2026-07-01T12:00:00Z" : "2026-07-04T12:00:00Z") },
      { acao: "EXCLUIDO", estadoAnterior: "ATIVO", estadoNovo: "EXCLUIDO", criadoEm: new Date(caso === "exclusao-posterior" ? "2026-07-03T12:00:00Z" : "2026-07-01T11:00:00Z") },
    ];
    mocks.governados.mockImplementation(async ({ where }) => where.status === "ATIVO" ? [{ origemId: "BRISA:RECEBER:copia", status: "ATIVO", eventos }] : []);
    if (caso === "duplicata-atual") {
      const copia = linha("BRISA:RECEBER:copia", "VINCULADO"); const principal = linha("BRISA:RECEBER:principal");
      operacao([copia, principal], [decisao(copia, principal.chave)]);
    }
    const filtro = await filtroRecebimentosUnificados();
    expect(filtro.OR?.[1]).toEqual({ mesLancamento: "2026-06", id: { notIn: ["copia"] } });
  });
  it("exclusão explícita prevalece no operacional fechado sem modificar o snapshot", async () => {
    const snapshot = { mesLancamento: "2026-06", unificacaoExcluidos: '["copia-congelada"]' };
    mocks.fechamentos.mockResolvedValue([snapshot]);
    mocks.governados.mockImplementation(async ({ where }) => where.tipo === "TITULO" ? [{ origemId: "BRISA:RECEBER:excluido" }] : []);
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({ OR: [
      { mesLancamento: { notIn: ["2026-06"] }, id: { notIn: ["excluido"] } },
      { mesLancamento: "2026-06", id: { notIn: ["copia-congelada", "excluido"] } },
    ] });
    expect(snapshot.unificacaoExcluidos).toBe('["copia-congelada"]');
  });
  it("não carrega toda a operação se não existe vínculo entre fontes Brisa", async () => {
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({});
    await expect(filtroCaixaUnificado()).resolves.toEqual({});
    expect(mocks.operacao).not.toHaveBeenCalled();
    expect(mocks.candidato).toHaveBeenCalledWith({
      where: { origem: "BRISA", status: "VINCULADO", dominio: { in: ["RECEBER", "MOVIMENTO"] }, destinoChave: { startsWith: "BRISA:" } },
      select: { chave: true },
    });
  });

  it("retira apenas a cópia validada e separa os IDs de recebimentos e caixa", async () => {
    const recebimento = linha("BRISA:RECEBER:copia-receber", "VINCULADO");
    const caixa = linha("BRISA:MOVIMENTO:copia-caixa", "VINCULADO");
    const principalReceber = linha("BRISA:RECEBER:principal-receber");
    const principalCaixa = linha("BRISA:MOVIMENTO:principal-caixa");
    operacao([recebimento, caixa, principalReceber, principalCaixa], [
      decisao(recebimento, principalReceber.chave), decisao(caixa, principalCaixa.chave),
    ]);
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({ id: { notIn: ["copia-receber"] } });
    await expect(filtroCaixaUnificado()).resolves.toEqual({ id: { notIn: ["copia-caixa"] } });
  });

  it.each(["ATIVO", "PENDENTE", "REVISAR", "QUARENTENA", "AUSENTE"] as const)("não suprime decisão persistida cuja projeção atual é %s", async estado => {
    const fonte = linha("BRISA:RECEBER:copia", estado);
    const principal = linha("BRISA:RECEBER:principal");
    operacao([fonte, principal], [decisao(fonte, principal.chave)]);
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({});
  });

  it("não retira insumos nativos por vínculo Widesys nem altera a fonte legada", async () => {
    const brisa = linha("BRISA:RECEBER:brisa", "VINCULADO");
    const widesys = linha("WIDESYS:RECEBER:widesys", "VINCULADO");
    const principalBrisa = linha("BRISA:RECEBER:principal-brisa");
    const principalWidesys = linha("WIDESYS:RECEBER:principal-widesys");
    const linhas = [brisa, widesys, principalBrisa, principalWidesys];
    const antes = structuredClone(linhas);
    operacao(linhas, [decisao(brisa, principalWidesys.chave), decisao(widesys, principalBrisa.chave)]);
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({});
    expect(linhas).toEqual(antes);
  });

  it("não exclui cópia com principal ausente, em revisão ou de outro domínio", async () => {
    const fonte = linha("BRISA:RECEBER:copia", "VINCULADO");
    for (const principal of [undefined, linha("BRISA:RECEBER:principal", "REVISAR"), linha("BRISA:MOVIMENTO:principal")]) {
      operacao(principal ? [fonte, principal] : [fonte], [decisao(fonte, principal?.chave ?? "BRISA:RECEBER:ausente")]);
      await expect(filtroRecebimentosUnificados()).resolves.toEqual({});
    }
  });

  it("congela exclusões do mês fechado mesmo quando mudança cadastral invalida o vínculo", async () => {
    const fonte = linha("BRISA:RECEBER:copia-junho", "REVISAR");
    const principal = linha("BRISA:RECEBER:principal");
    operacao([fonte, principal], [decisao(fonte, principal.chave)]);
    mocks.fechamentos.mockResolvedValue([{ mesLancamento: "2026-06", unificacaoExcluidos: '["copia-junho"]' }]);
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({ OR: [
      { mesLancamento: { notIn: ["2026-06"] } },
      { mesLancamento: "2026-06", id: { notIn: ["copia-junho"] } },
    ] });
  });

  it("usa exclusivamente o snapshot em meses fechados antigos e a projeção nos meses abertos", async () => {
    const fonte = linha("BRISA:RECEBER:copia-atual", "VINCULADO");
    const principal = linha("BRISA:RECEBER:principal");
    operacao([fonte, principal], [decisao(fonte, principal.chave)]);
    mocks.fechamentos.mockResolvedValue([
      { mesLancamento: "2026-05", unificacaoExcluidos: "[]" },
      { mesLancamento: "2026-06", unificacaoExcluidos: '["copia-congelada"]' },
    ]);
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({ OR: [
      { mesLancamento: { notIn: ["2026-05", "2026-06"] }, id: { notIn: ["copia-atual"] } },
      { mesLancamento: "2026-05" },
      { mesLancamento: "2026-06", id: { notIn: ["copia-congelada"] } },
    ] });
  });

  it("preserva o snapshot sem depender de uma decisão vinculada ainda existente", async () => {
    mocks.fechamentos.mockResolvedValue([{ mesLancamento: "2026-06", unificacaoExcluidos: '["copia", "copia", 42, null, ""]' }]);
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({ OR: [
      { mesLancamento: { notIn: ["2026-06"] } },
      { mesLancamento: "2026-06", id: { notIn: ["copia"] } },
    ] });
    expect(mocks.operacao).not.toHaveBeenCalled();
  });

  it.each(["[]", "inválido", "{}"])("não inventa exclusões para snapshot %s", async snapshot => {
    mocks.fechamentos.mockResolvedValue([{ mesLancamento: "2026-06", unificacaoExcluidos: snapshot }]);
    await expect(filtroRecebimentosUnificados()).resolves.toEqual({});
  });
});
