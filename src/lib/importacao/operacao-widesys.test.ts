import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { conteudoHashManifestoOperacao } from "./manifesto-operacao-widesys";

import {
  carregarPlanoOperacaoWidesys,
  criarRelatorioDryRunComBancoOperacaoWidesys,
  ErroImportacaoOperacaoWidesys,
  importarPlanoOperacaoWidesys,
  type BaixaLegadoPlanejada,
  type PlanoOperacaoWidesys,
  type TituloLegadoPlanejado,
} from "./operacao-widesys";

const temporarios: string[] = [];

afterEach(() => {
  const raizTemporaria = `${resolve(tmpdir())}${sep}`.toLowerCase();
  for (const diretorio of temporarios.splice(0)) {
    const resolvido = resolve(diretorio);
    if (
      resolvido.toLowerCase().startsWith(raizTemporaria) &&
      basename(resolvido).startsWith("brisa-operacao-")
    ) {
      rmSync(resolvido, { recursive: true, force: true });
    }
  }
});

function sha256(conteudo: string | Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

function fixtureOperacao(
  primeiraBaixaStatus = "Efetivada",
  opcoes: { businessDate?: string; capturedAt?: string; primeiraBaixaValor?: string } = {},
): string {
  const diretorio = mkdtempSync(join(tmpdir(), "brisa-operacao-"));
  temporarios.push(diretorio);
  const capturedAt = opcoes.capturedAt ?? "2026-09-16T12:00:00.000Z";
  const businessDate = opcoes.businessDate ?? "2026-09-16";
  const arquivos: Array<{ scope: string; path: string; sha256: string; count: number; bytes: number }> = [];
  const gravar = (scope: string, path: string, records: unknown[]) => {
    const conteudo = JSON.stringify({
      businessDate,
      scope,
      capturedAt,
      complete: true,
      records,
      timeZone: "America/Sao_Paulo",
    });
    writeFileSync(join(diretorio, path), conteudo, "utf8");
    arquivos.push({
      scope,
      path,
      sha256: sha256(conteudo),
      count: records.length,
      bytes: Buffer.byteLength(conteudo),
    });
  };

  gravar("contratos", "contratos.json", [
    {
      legacyId: "contrato-1",
      capturedAt,
      sourceUrl:
        "https://brisaazul.app2.widesys.com.br/administrator/index.php?option=com_widesys&view=locacao&layout=edit&id=1",
      fields: {
        numero_contrato: "51.302.2",
        produto_id: "imovel-51",
        valor_locacao: "1.500,00",
        "jform[inquilinos][inquilinos0][inquilino_id]": "pessoa-302",
        "jform[proprietarios][proprietarios0][proprietario_id]": "pessoa-169",
        csrf_token: "nao-persistir",
      },
      partes: [
        { ordem: 0, papel: "INQUILINO", pessoaLegadoId: "pessoa-302" },
        { ordem: 2, papel: "PROPRIETARIO", pessoaLegadoId: "pessoa-169" },
      ],
    },
  ]);
  gravar("contas_receber", "receber.json", [
    {
      legacyId: "titulo-4950",
      capturedAt,
      fields: {
        locacao_id: "contrato-1",
        vencimento: "01-09-2026",
        valor_devido: "715,68",
        valor_pago: "650,00",
        situacao: "Pendente",
      },
      baixas: [
        {
          data_pagamento: "05-09-2026",
          valor: opcoes.primeiraBaixaValor ?? "300,00",
          numero_lancamento: "447",
          status: primeiraBaixaStatus,
        },
        {
          data_pagamento: "10-09-2026",
          valor: "350,00",
          numero_lancamento: "1189",
          status: "Efetivada",
        },
        {
          data_pagamento: "11-09-2026",
          valor: "50,00",
          numero_lancamento: "1190",
          status: "Estornada",
        },
      ],
      raw: {
        fields: [],
        tables: [
          {
            headers: ["Data Pagamento", "Valor", "Nº Lanç.", "Status"],
            rows: [
              ["05-09-2026", opcoes.primeiraBaixaValor ?? "300,00", "447", primeiraBaixaStatus],
              ["10-09-2026", "350,00", "1189", "Efetivada"],
              ["11-09-2026", "50,00", "1190", "Estornada"],
            ],
          },
        ],
      },
    },
  ]);
  gravar("contas_pagar", "pagar.json", [
    {
      legacyId: "pagar-1",
      capturedAt,
      fields: {
        vencimento: "30-09-2026",
        valor_devido: "100,00",
        valor_pago: "0,00",
        situacao: "Pendente",
      },
      baixas: [],
      raw: {
        tables: [
          {
            headers: ["Data", "Vencimento", "Valor"],
            rows: [["16-09-2026", "30-09-2026", "100,00"]],
          },
        ],
      },
    },
    {
      legacyId: "pagar-2",
      capturedAt,
      fields: {
        vencimento: "30-10-2026",
        valor_devido: "200,00",
        valor_pago: "0,00",
        situacao: "Pendente",
      },
      raw: {
        tables: [
          {
            headers: ["Data", "Vencimento", "Valor"],
            rows: [["16-09-2026", "30-10-2026", "200,00"]],
          },
        ],
      },
    },
    {
      legacyId: "pagar-pago-inconsistente",
      capturedAt,
      fields: {
        vencimento: "30-08-2026",
        valor_devido: "100,00",
        valor_pago: "0,00",
        situacao: "Pago",
      },
      baixas: [],
    },
    {
      legacyId: "pagar-aberto-sem-saldo",
      capturedAt,
      fields: {
        vencimento: "30-08-2026",
        valor_devido: "100,00",
        valor_pago: "100,00",
        situacao: "Pendente",
      },
      baixas: [],
    },
  ]);
  gravar("movimentos", "movimentos.json", [
    {
      legacyId: "447",
      capturedAt,
      fields: {
        data_movimento: "05-09-2026",
        valor: "300,00",
        natureza: "Entrada",
        documento: "REC-1",
      },
    },
    {
      legacyId: "1189",
      capturedAt,
      fields: {
        data_movimento: "10-09-2026",
        valor: "350,00",
        natureza: "Entrada",
        documento: "REC-2",
      },
    },
    {
      legacyId: "1190",
      capturedAt,
      fields: {
        data_movimento: "11-09-2026",
        valor: "50,00",
        natureza: "Entrada",
        documento: "REC-3",
      },
    },
  ]);
  const modulePorEscopo: Record<string, string> = {
    contratos: "contratos",
    contas_receber: "contas-receber",
    contas_pagar: "contas-pagar",
    movimentos: "movimentacoes",
  };
  const artifacts = arquivos.map((arquivo) => ({
    bytes: arquivo.bytes,
    kind: "detail-json",
    module: modulePorEscopo[arquivo.scope],
    path: arquivo.path,
    sha256: arquivo.sha256,
    sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php",
    window: "fixture",
  }));
  const modules = Object.fromEntries(
    Object.entries(modulePorEscopo).map(([scope, module]) => {
      const recordsSaved = arquivos
        .filter((arquivo) => arquivo.scope === scope)
        .reduce((total, arquivo) => total + arquivo.count, 0);
      const windowKey = module === "contratos" ? "todos" : "2026-09";
      return [
        module,
        {
          completed: true,
          detailErrors: 0,
          duplicateIds: 0,
          globalCountVerified: true,
          globalReportedTotal: recordsSaved,
          listView: `fixture-${module}`,
          recordsDiscovered: recordsSaved,
          recordsSaved,
          recordsSkipped: 0,
          windows: {
            [windowKey]: {
              completed: true,
              duplicateIds: 0,
              pagesFetched: 1,
              recordsDiscovered: recordsSaved,
              reportedTotal: recordsSaved,
            },
          },
        },
      ];
    }),
  );
  const errors: unknown[] = [];
  const selectedModules = ["contratos", "contas-receber", "contas-pagar", "movimentacoes"];
  const manifest = {
    artifacts,
    baseOrigin: "https://brisaazul.app2.widesys.com.br",
    businessDate,
    schemaVersion: 2,
    version: 2,
    captureId: "captura-fixture-1",
    sourceOrigin: "https://brisaazul.app2.widesys.com.br",
    timeZone: "America/Sao_Paulo",
    startedAt: capturedAt,
    capturedAt,
    complete: true,
    completedAt: capturedAt,
    contentHash: "",
    errors,
    files: arquivos,
    modules,
    options: {
      captureMode: "refresh",
      delayMs: 0,
      fromMonth: "2026-09",
      limit: 200,
      maxPages: 100,
      modules: selectedModules,
      titlesTo: "2026-09-30",
      toMonth: "2026-09",
    },
  };
  manifest.contentHash = sha256(conteudoHashManifestoOperacao(manifest));
  writeFileSync(
    join(diretorio, "manifest.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  return diretorio;
}

function regravarManifesto(
  diretorio: string,
  alterar: (manifesto: Record<string, unknown>) => void,
  recalcularHash = true,
): void {
  const caminho = join(diretorio, "manifest.json");
  const manifesto = JSON.parse(readFileSync(caminho, "utf8")) as Record<string, unknown>;
  alterar(manifesto);
  if (recalcularHash) {
    manifesto.contentHash = sha256(conteudoHashManifestoOperacao(manifesto));
  }
  writeFileSync(caminho, JSON.stringify(manifesto), "utf8");
}

function alterarShard(
  diretorio: string,
  arquivo: string,
  alterar: (raiz: Record<string, unknown>) => void,
): void {
  const caminho = join(diretorio, arquivo);
  const raiz = JSON.parse(readFileSync(caminho, "utf8")) as Record<string, unknown>;
  alterar(raiz);
  const conteudo = JSON.stringify(raiz);
  writeFileSync(caminho, conteudo, "utf8");
  regravarManifesto(diretorio, (manifesto) => {
    const atualizar = (entrada: unknown) => {
      const item = entrada as Record<string, unknown>;
      if (item.path !== arquivo) return;
      item.sha256 = sha256(conteudo);
      if ("bytes" in item) item.bytes = Buffer.byteLength(conteudo);
      if ("count" in item) item.count = Array.isArray(raiz.records) ? raiz.records.length : 0;
    };
    (manifesto.files as unknown[]).forEach(atualizar);
    (manifesto.artifacts as unknown[]).forEach(atualizar);
  });
}

const semAusentes = {
  findMany: async () => [],
};

describe("staging da operação Widesys", () => {
  it("considera baixas positivas completas quando capturou o transporte de detalhes", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      titulo.details = [
        {
          contentHash: "detalhe-baixas",
          raw: { fields: [], tables: [], text: "", title: "" },
          sourceUrl:
            "https://brisaazul.app2.widesys.com.br/administrator/index.php?option=com_widesys&view=ajax&format=raw&task=ajax.getDetalhesRecebimento&conta_receber_id=1&numero_parcela=1",
          transport: "ajax.getDetalhesRecebimento",
        },
      ];
      titulo.baixaEvidence = {
        expectedTransport: "ajax.getDetalhesRecebimento",
        transportObserved: true,
      };
    });

    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const titulo = plano.registros.find(
      (item): item is TituloLegadoPlanejado => item.escopo === "TITULO_RECEBER",
    );

    expect(titulo?.capturaBaixasCompleta).toBe(true);
    expect(plano.escoposBaixasCompletos).toContain("BAIXA_RECEBER");
    expect(titulo?.snapshot).toContain('"transporteObservado":true');
  });

  it("não aceita declaração de transporte sem o detalhe correspondente", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      titulo.baixas = [];
      titulo.baixaEvidence = {
        expectedTransport: "ajax.getDetalhesRecebimento",
        transportObserved: true,
      };
    });
    const titulo = carregarPlanoOperacaoWidesys(diretorio).registros.find(
      (item): item is TituloLegadoPlanejado => item.escopo === "TITULO_RECEBER",
    );

    expect(titulo).toMatchObject({
      capturaBaixasCompleta: false,
      statusImportacao: "QUARENTENA",
    });
    expect(titulo?.quarentenaMotivo).toContain("TITULO_EVIDENCIA_BAIXAS_DIVERGENTE");
    expect(titulo?.quarentenaMotivo).toContain("TITULO_BAIXAS_NAO_ESTRUTURADAS");
  });

  it("usa valor pago zero como prova negativa sem confiar em baixas vazias", () => {
    const plano = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const estruturado = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_RECEBER" && item.legadoId === "titulo-4950",
    );
    const zerado = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-1",
    );
    const positivoSemDetalhe = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-aberto-sem-saldo",
    );

    expect(estruturado).toMatchObject({
      capturaBaixasCompleta: true,
      capturaBaixasProva: "ESTRUTURADA_COHERENTE",
    });
    expect(zerado?.capturaBaixasCompleta).toBe(true);
    expect(positivoSemDetalhe?.capturaBaixasCompleta).toBe(false);
    expect(plano.escoposBaixasCompletos).not.toContain("BAIXA_PAGAR");
  });

  it("não trata campo de valor pago ausente como prova de baixa zero", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "pagar.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>).find(
        (item) => item.legacyId === "pagar-2",
      )!;
      delete (titulo.fields as Record<string, unknown>).valor_pago;
      titulo.baixas = [];
    });

    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const titulo = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-2",
    );

    expect(titulo).toMatchObject({
      capturaBaixasCompleta: false,
      capturaBaixasProva: "INCOMPLETA",
    });
    expect(plano.escoposBaixasCompletos).not.toContain("BAIXA_PAGAR");
  });

  it("registra partes estruturadas sem assinar enumeração completa", () => {
    const semEvidencia = carregarPlanoOperacaoWidesys(fixtureOperacao());
    expect(semEvidencia.escoposPartesCompletos).not.toContain("CONTRATO_PARTE");

    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "contratos.json", (raiz) => {
      const contrato = (raiz.records as Array<Record<string, unknown>>)[0];
      contrato.details = [
        {
          contentHash: "detalhe-contrato",
          raw: { fields: [], tables: [], text: "", title: "" },
          sourceUrl:
            "https://brisaazul.app2.widesys.com.br/administrator/index.php?option=com_widesys&view=locacao&layout=edit&id=1",
          transport: "locacao.edit",
        },
      ];
    });
    const comEvidencia = carregarPlanoOperacaoWidesys(diretorio);
    const contrato = comEvidencia.registros.find((item) => item.escopo === "CONTRATO");

    expect(contrato).toMatchObject({
      capturaPartesEstruturada: true,
      capturaPartesProva: "DETALHE_ESTRUTURADO_SEM_CONTAGEM",
    });
    expect(comEvidencia.escoposPartesCompletos).not.toContain("CONTRATO_PARTE");
  });

  it("classifica vencimento pela data civil de São Paulo, não pelo dia UTC", () => {
    const plano = carregarPlanoOperacaoWidesys(
      fixtureOperacao("Efetivada", {
        businessDate: "2026-09-30",
        capturedAt: "2026-10-01T00:01:00.000Z",
      }),
    );
    const tituloDoDia = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-1",
    );

    expect(plano.dataNegocio).toBe("2026-09-30");
    expect(tituloDoDia).toMatchObject({
      inadimplente: false,
      situacaoNormalizada: "PENDENTE",
    });
  });

  it("coloca em quarentena situações financeiras contraditórias", () => {
    const plano = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const pagoComSaldo = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-pago-inconsistente",
    );
    const abertoSemSaldo = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-aberto-sem-saldo",
    );

    expect(pagoComSaldo).toMatchObject({ statusImportacao: "QUARENTENA" });
    expect(pagoComSaldo?.quarentenaMotivo).toContain("TITULO_PAGO_COM_SALDO");
    expect(pagoComSaldo?.quarentenaMotivo).toContain("TITULO_PAGO_SEM_BAIXA");
    expect(abertoSemSaldo).toMatchObject({
      situacaoNormalizada: "PAGO",
      statusImportacao: "QUARENTENA",
    });
    expect(abertoSemSaldo?.quarentenaMotivo).toContain("TITULO_BAIXAS_NAO_ESTRUTURADAS");
  });

  it("não confunde rótulo negativo com pago e quita título pela base original", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "pagar.json", (raiz) => {
      const [naoPago, quitado] = raiz.records as Array<Record<string, unknown>>;
      (naoPago.fields as Record<string, unknown>).situacao = "Não pago";
      const campos = quitado.fields as Record<string, unknown>;
      delete campos.valor_devido;
      campos.valor_original = "100,00";
      campos.valor_pago = "100,00";
      campos.situacao = "Pendente";
      quitado.baixas = [
        { id: "baixa-991", data_pagamento: "15-09-2026", status: "Efetivada", valor: "100,00" },
      ];
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const naoPago = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-1",
    );
    const quitado = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-2",
    );

    expect(naoPago?.situacaoNormalizada).toBe("PENDENTE");
    expect(quitado).toMatchObject({
      situacaoNormalizada: "PAGO",
      statusImportacao: "STAGING",
      valorAberto: 0,
      valorOriginal: 10_000,
      valorPago: 10_000,
    });
  });

  it("classifica título integralmente pago pelos valores mesmo com ação Visualizar", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "pagar.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[3];
      Object.assign(titulo.fields as Record<string, unknown>, {
        conta_pix: "Conta operacional",
        plano_conta: "Aluguel",
        situacao: "Visualizar / Atrasou 3d",
        tipo_cobranca: "Boleto",
      });
    });
    const titulo = carregarPlanoOperacaoWidesys(diretorio).registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-aberto-sem-saldo",
    );

    expect(titulo).toMatchObject({
      contaBancariaRotulo: "Conta operacional",
      planoContaRotulo: "Aluguel",
      situacaoNormalizada: "PAGO",
      tipoCobrancaRotulo: "Boleto",
      valorAberto: 0,
      valorPago: 10_000,
    });
  });

  it("prioriza rótulo de natureza e preserva dimensões e descrição do movimento", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "movimentos.json", (raiz) => {
      const movimento = (raiz.records as Array<Record<string, unknown>>)[0];
      const campos = movimento.fields as Record<string, unknown>;
      delete campos.natureza;
      Object.assign(campos, {
        complemento: "Tarifa bancária",
        conta_id: "1180",
        conta_rotulo: "Sicoob Brisa Azul",
        planoconta_catid: "7",
        planoconta_catid_rotulo: "Tarifas bancárias",
        tipo: "0",
        tipo_rotulo: "Saída",
      });
    });
    const movimento = carregarPlanoOperacaoWidesys(diretorio).registros.find(
      (item) => item.escopo === "MOVIMENTO" && item.legadoId === "447",
    );

    expect(movimento).toMatchObject({
      contaBancariaLegadoId: "1180",
      contaBancariaRotulo: "Sicoob Brisa Azul",
      descricao: "Tarifa bancária",
      natureza: "SAIDA",
      planoContaLegadoId: "7",
      planoContaRotulo: "Tarifas bancárias",
    });
  });

  it("herda a conta da baixa somente após reconciliação inequívoca com o movimento", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "movimentos.json", (raiz) => {
      const movimento = (raiz.records as Array<Record<string, unknown>>)[0];
      Object.assign(movimento.fields as Record<string, unknown>, {
        conta_id: "1180",
        conta_rotulo: "Sicoob Brisa Azul",
      });
    });
    const baixa = carregarPlanoOperacaoWidesys(diretorio).registros.find(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );

    expect(baixa).toMatchObject({
      contaBancariaLegadoId: "1180",
      contaBancariaRotulo: "Sicoob Brisa Azul",
      statusImportacao: "STAGING",
    });
    expect(baixa?.snapshot).toContain('"contaHerdadaDoMovimento":"447"');
  });

  it("mantém vínculos contratuais distintos mesmo com papel, pessoa e ordem iguais", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "contratos.json", (raiz) => {
      const contrato = (raiz.records as Array<Record<string, unknown>>)[0];
      contrato.partes = [
        { ordem: 0, papel: "INQUILINO", pessoaLegadoId: "pessoa-302", vinculoId: "vinculo-1" },
        { ordem: 0, papel: "INQUILINO", pessoaLegadoId: "pessoa-302", vinculoId: "vinculo-2" },
      ];
    });
    const partes = carregarPlanoOperacaoWidesys(diretorio).registros.filter(
      (item) => item.escopo === "CONTRATO_PARTE",
    );

    expect(partes).toHaveLength(2);
    expect(new Set(partes.map((item) => item.legadoId)).size).toBe(2);
    expect(partes.every((item) => item.legadoId.startsWith("parte:"))).toBe(true);
    expect(partes.map((item) => item.vinculoId).sort()).toEqual(["vinculo-1", "vinculo-2"]);
  });

  it("namespaces vínculo local repetido por contrato e papel", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "contratos.json", (raiz) => {
      const [primeiro] = raiz.records as Array<Record<string, unknown>>;
      primeiro.partes = [
        { ordem: 0, papel: "PROPRIETARIO", pessoaLegadoId: "169", vinculoId: "50" },
      ];
      (raiz.records as Array<Record<string, unknown>>).push({
        capturedAt: primeiro.capturedAt,
        fields: {
          numero_contrato: "51.303.2",
          produto_id: "imovel-52",
          valor_locacao: "2.000,00",
        },
        legacyId: "contrato-2",
        partes: [
          { ordem: 0, papel: "PROPRIETARIO", pessoaLegadoId: "170", vinculoId: "50" },
        ],
        sourceUrl:
          "https://brisaazul.app2.widesys.com.br/administrator/index.php?option=com_widesys&view=locacao&layout=edit&id=2",
      });
    });
    regravarManifesto(diretorio, (manifesto) => {
      const modulo = (manifesto.modules as Record<string, Record<string, unknown>>).contratos;
      modulo.recordsDiscovered = 2;
      modulo.recordsSaved = 2;
      modulo.globalReportedTotal = 2;
      const janela = (modulo.windows as Record<string, Record<string, unknown>>).todos;
      janela.recordsDiscovered = 2;
      janela.reportedTotal = 2;
    });

    const primeira = carregarPlanoOperacaoWidesys(diretorio).registros.filter(
      (item) => item.escopo === "CONTRATO_PARTE" && item.vinculoId === "50",
    );
    const segunda = carregarPlanoOperacaoWidesys(diretorio).registros.filter(
      (item) => item.escopo === "CONTRATO_PARTE" && item.vinculoId === "50",
    );

    expect(primeira).toHaveLength(2);
    expect(new Set(primeira.map((item) => item.legadoId)).size).toBe(2);
    expect(segunda.map((item) => item.legadoId)).toEqual(
      primeira.map((item) => item.legadoId),
    );
  });

  it("mantém pendentes rótulos que mencionam liquidação sem confirmar pagamento", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "pagar.json", (raiz) => {
      const [pendente, aguardando, naoPago] = raiz.records as Array<Record<string, unknown>>;
      (pendente.fields as Record<string, unknown>).situacao = "Pendente de liquidação";
      (aguardando.fields as Record<string, unknown>).situacao = "Aguardando liquidação";
      (naoPago.fields as Record<string, unknown>).situacao = "Não foi pago";
    });
    const titulos = carregarPlanoOperacaoWidesys(diretorio).registros.filter(
      (item): item is TituloLegadoPlanejado => item.escopo === "TITULO_PAGAR",
    );

    expect(titulos.find((item) => item.legadoId === "pagar-1")?.situacaoNormalizada).toBe("PENDENTE");
    expect(titulos.find((item) => item.legadoId === "pagar-2")?.situacaoNormalizada).toBe("PENDENTE");
    expect(titulos.find((item) => item.legadoId === "pagar-pago-inconsistente")?.situacaoNormalizada).toBe(
      "VENCIDO",
    );
  });

  it("lê a coluna sit sem confundir a ação Quitar com quitação", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "pagar.json", (raiz) => {
      const [quitar, parcial] = raiz.records as Array<Record<string, unknown>>;
      const camposQuitar = quitar.fields as Record<string, unknown>;
      const camposParcial = parcial.fields as Record<string, unknown>;
      delete camposQuitar.situacao;
      delete camposParcial.situacao;
      camposQuitar.sit = "Quitar";
      camposParcial.sit = "Pagamento parcial";
    });
    const titulos = carregarPlanoOperacaoWidesys(diretorio).registros.filter(
      (item): item is TituloLegadoPlanejado => item.escopo === "TITULO_PAGAR",
    );

    expect(titulos.find((item) => item.legadoId === "pagar-1")?.situacaoNormalizada).toBe("PENDENTE");
    expect(titulos.find((item) => item.legadoId === "pagar-2")?.situacaoNormalizada).toBe("PARCIAL");
  });

  it("quarentena valores monetários malformados e negativos em títulos", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "pagar.json", (raiz) => {
      const [malformado, negativo] = raiz.records as Array<Record<string, unknown>>;
      (malformado.fields as Record<string, unknown>).valor_devido = "1,2,3";
      (negativo.fields as Record<string, unknown>).valor_devido = "-200,00";
    });
    const titulos = carregarPlanoOperacaoWidesys(diretorio).registros.filter(
      (item): item is TituloLegadoPlanejado => item.escopo === "TITULO_PAGAR",
    );
    const malformado = titulos.find((item) => item.legadoId === "pagar-1");
    const negativo = titulos.find((item) => item.legadoId === "pagar-2");

    expect(malformado?.quarentenaMotivo).toContain("TITULO_DEVIDO_INVALIDO");
    expect(negativo?.quarentenaMotivo).toContain("TITULO_DEVIDO_NEGATIVO");
  });

  it("normaliza data e valor na identidade de baixa sem ID externo", () => {
    const primeiroDiretorio = fixtureOperacao();
    const segundoDiretorio = fixtureOperacao();
    alterarShard(primeiroDiretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      titulo.baixas = [{ data_pagamento: "05-09-2026", forma: "PIX", status: "Efetivada", valor: "100,00" }];
      (titulo.fields as Record<string, unknown>).valor_pago = "100,00";
    });
    alterarShard(segundoDiretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      titulo.baixas = [{ data_pagamento: "2026-09-05", forma: "pix", status: "Efetivada", valor: "100.00" }];
      (titulo.fields as Record<string, unknown>).valor_pago = "100,00";
    });
    const primeira = carregarPlanoOperacaoWidesys(primeiroDiretorio).registros.find(
      (item) => item.escopo === "BAIXA_RECEBER",
    );
    const segunda = carregarPlanoOperacaoWidesys(segundoDiretorio).registros.find(
      (item) => item.escopo === "BAIXA_RECEBER",
    );

    expect(segunda?.legadoId).toBe(primeira?.legadoId);
  });

  it("normaliza múltiplas partes e baixas sem misturar com a operação atual", () => {
    const plano = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const contrato = plano.registros.find((item) => item.escopo === "CONTRATO");
    const partes = plano.registros.filter((item) => item.escopo === "CONTRATO_PARTE");
    const titulo = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_RECEBER" && item.legadoId === "titulo-4950",
    );
    const baixas = plano.registros.filter(
      (item): item is BaixaLegadoPlanejada => item.escopo === "BAIXA_RECEBER",
    );
    const baixasPagar = plano.registros.filter(
      (item): item is BaixaLegadoPlanejada => item.escopo === "BAIXA_PAGAR",
    );

    expect(contrato?.statusImportacao).toBe("STAGING");
    expect(partes).toHaveLength(2);
    expect(new Set(partes.map((item) => item.legadoId)).size).toBe(2);
    expect(partes.map((item) => item.ordem).sort((a, b) => a - b)).toEqual([0, 2]);
    expect(titulo).toMatchObject({
      valorDevido: 71_568,
      valorPago: 65_000,
      valorAberto: 6_568,
      pagamentoParcial: true,
      situacaoNormalizada: "PARCIAL",
      inadimplente: true,
      statusImportacao: "STAGING",
    });
    expect(baixas).toHaveLength(3);
    expect(baixasPagar).toHaveLength(0);
    expect(baixas.find((item) => item.movimentoLegadoId === "447")).toMatchObject({
      valor: 30_000,
      estornada: false,
    });
    expect(plano.reconciliacao.BAIXA_RECEBER.somaBaixas).toBe(65_000);
    expect(plano.reconciliacao.TITULO_RECEBER.somaValorAberto).toBe(6_568);
    expect(contrato?.snapshot).not.toContain("nao-persistir");
  });

  it("usa somente o ID semântico da pessoa e preserva o ID do vínculo aninhado", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "contratos.json", (raiz) => {
      const contrato = (raiz.records as Array<Record<string, unknown>>)[0];
      contrato.partes = [
        { ordem: 0, papel: "PROPRIETARIO", pessoaLegadoId: "50" },
        { ordem: 0, papel: "PROPRIETARIO", pessoaLegadoId: "169" },
      ];
      contrato.raw = {
        fields: [
          {
            name: "jform[locacaoproprietarios][locacaoproprietarios0][id]",
            type: "hidden",
            value: "50",
          },
          {
            name: "jform[locacaoproprietarios][locacaoproprietarios0][proprietario_id]",
            type: "select",
            value: "169",
          },
          {
            name: "jform[locacaoproprietarios][locacaoproprietarios0][percentual]",
            type: "text",
            value: "75,5",
          },
          {
            checked: true,
            name: "jform[locacaoproprietarios][locacaoproprietarios0][responsavel_repasse]",
            type: "checkbox",
            value: "1",
          },
        ],
        tables: [],
      };
    });

    const partes = carregarPlanoOperacaoWidesys(diretorio).registros.filter(
      (item) => item.escopo === "CONTRATO_PARTE",
    );

    expect(partes).toHaveLength(1);
    expect(partes[0]).toMatchObject({
      flags: { responsavel_repasse: "1" },
      papel: "PROPRIETARIO",
      percentual: "75,5",
      pessoaLegadoId: "169",
      vinculoId: "50",
    });
    expect(partes[0].legadoId).toMatch(/^parte:[a-f\d]{32}$/);
    expect(partes[0].snapshot).toContain('"flag_responsavel_repasse":"1"');
  });

  it("preserva o vínculo genérico dentro da identidade namespaced da parte", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "contratos.json", (raiz) => {
      const contrato = (raiz.records as Array<Record<string, unknown>>)[0];
      contrato.partes = [
        { id: "vinculo-88", ordem: 0, papel: "PROPRIETARIO", pessoa_id: "169" },
      ];
    });
    const partes = carregarPlanoOperacaoWidesys(diretorio).registros.filter(
      (item) => item.escopo === "CONTRATO_PARTE",
    );

    expect(partes).toHaveLength(1);
    expect(partes[0]).toMatchObject({ vinculoId: "vinculo-88" });
    expect(partes[0].legadoId).toMatch(/^parte:[a-f\d]{32}$/);
  });

  it("mapeia os aliases reais do formulário de locação", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "contratos.json", (raiz) => {
      const contrato = (raiz.records as Array<Record<string, unknown>>)[0];
      Object.assign(contrato.fields as Record<string, unknown>, {
        data_contrato_final: "31-12-2026",
        data_contrato_inicial: "01-01-2025",
        data_vigorar: "02-01-2025",
        situacao_contrato_catid: "7",
        situacao_contrato_catid_rotulo: "Ativo",
        taxa_adm_mensal_real: "123,45",
        vencto_pri_aluguel: "10-02-2025",
      });
    });
    const contrato = carregarPlanoOperacaoWidesys(diretorio).registros.find(
      (item) => item.escopo === "CONTRATO",
    );

    expect(contrato).toMatchObject({
      fim: "2026-12-31",
      inicio: "2025-01-02",
      primeiroVencimento: "2025-02-10",
      situacaoOrigem: "Ativo",
      valorAdministracao: 12_345,
    });

    alterarShard(diretorio, "contratos.json", (raiz) => {
      const registro = (raiz.records as Array<Record<string, unknown>>)[0];
      delete (registro.fields as Record<string, unknown>).data_vigorar;
    });
    const comVigencia = carregarPlanoOperacaoWidesys(diretorio).registros.find(
      (item) => item.escopo === "CONTRATO",
    );
    expect(comVigencia).toMatchObject({ inicio: "2025-01-01" });
  });

  it("não duplica Multa/Juros como mora e valida o total de controle em AR e AP", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      Object.assign(titulo.fields as Record<string, unknown>, {
        multa: "10,00",
        "Total Multa/Juros": "10,00",
      });
    });
    alterarShard(diretorio, "pagar.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      Object.assign(titulo.fields as Record<string, unknown>, {
        multa: "10,00",
        valor_mora: "2,00",
        "Total Multa/Juros": "13,00",
      });
    });

    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const receber = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_RECEBER" && item.legadoId === "titulo-4950",
    );
    const pagar = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-1",
    );

    expect(receber).toMatchObject({ juros: null, multa: 1_000 });
    expect(receber?.quarentenaMotivo ?? "").not.toContain("TITULO_MULTA_JUROS_DIVERGENTE");
    expect(pagar).toMatchObject({ juros: 200, multa: 1_000, statusImportacao: "QUARENTENA" });
    expect(pagar?.quarentenaMotivo).toContain("TITULO_MULTA_JUROS_DIVERGENTE");
  });

  it("mapeia Parc. e planoconta_catid usados nas grades reais", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "pagar.json", (raiz) => {
      ((raiz.records as Array<Record<string, unknown>>)[0].fields as Record<string, unknown>).parc = "7/12";
    });
    alterarShard(diretorio, "movimentos.json", (raiz) => {
      ((raiz.records as Array<Record<string, unknown>>)[0].fields as Record<string, unknown>).planoconta_catid = "88";
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);

    expect(
      plano.registros.find((item) => item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-1"),
    ).toMatchObject({ parcela: "7/12" });
    expect(
      plano.registros.find((item) => item.escopo === "MOVIMENTO" && item.legadoId === "447"),
    ).toMatchObject({ planoContaLegadoId: "88" });
  });

  it("mapeia IDs tipados dos links allowlisted sem inferir a contraparte pelo nome", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      delete (titulo.fields as Record<string, unknown>).locacao_id;
      titulo.list = {
        references: [
          { entidade: "CONTRATO", legadoId: "63", papelOrigem: "LOCACAO" },
          { entidade: "PESSOA", legadoId: "302", papelOrigem: "INQUILINO" },
          { entidade: "USUARIO", legadoId: "999", papelOrigem: "ADMIN" },
        ],
      };
    });
    alterarShard(diretorio, "pagar.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      titulo.list = {
        references: [
          { entidade: "CONTRATO", legadoId: "65", papelOrigem: "LOCACAO" },
          { entidade: "PESSOA", legadoId: "169", papelOrigem: "PROPRIETARIO" },
        ],
      };
    });

    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const receber = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_RECEBER" && item.legadoId === "titulo-4950",
    );
    const pagar = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_PAGAR" && item.legadoId === "pagar-1",
    );

    expect(receber).toMatchObject({
      contratoLegadoId: "63",
      contrapartePapelOrigem: "INQUILINO",
      pessoaLegadoId: "302",
    });
    expect(pagar).toMatchObject({
      contratoLegadoId: "65",
      contrapartePapelOrigem: "PROPRIETARIO",
      pessoaLegadoId: "169",
    });
    expect(receber?.snapshot).toContain('"referencia_lista_1_papel_origem":"INQUILINO"');
    expect(receber?.snapshot).not.toContain("ADMIN");
  });

  it("mantém duas baixas idênticas sem ID como ocorrências distintas", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      titulo.baixas = [
        { data_pagamento: "05-09-2026", forma: "Pix", valor: "100,00" },
        { data_pagamento: "05-09-2026", forma: "Pix", valor: "100,00" },
      ];
      (titulo.fields as Record<string, unknown>).valor_pago = "200,00";
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const baixas = plano.registros.filter(
      (item): item is BaixaLegadoPlanejada => item.escopo === "BAIXA_RECEBER",
    );

    expect(baixas).toHaveLength(2);
    expect(new Set(baixas.map((item) => item.legadoId)).size).toBe(2);
    expect(baixas.map((item) => item.valor)).toEqual([10_000, 10_000]);
  });

  it("quarentena baixa não positiva e não a usa para calcular o saldo", () => {
    const plano = carregarPlanoOperacaoWidesys(
      fixtureOperacao("Efetivada", { primeiraBaixaValor: "-50,00" }),
    );
    const negativa = plano.registros.find(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );
    const titulo = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_RECEBER" && item.legadoId === "titulo-4950",
    );

    expect(negativa).toMatchObject({ statusImportacao: "QUARENTENA", valor: -5_000 });
    expect(negativa?.quarentenaMotivo).toContain("BAIXA_VALOR_NAO_POSITIVO");
    expect(titulo).toMatchObject({ statusImportacao: "QUARENTENA", valorPago: 35_000, valorAberto: 36_568 });
    const movimento = plano.registros.find(
      (item) => item.escopo === "MOVIMENTO" && item.legadoId === "447",
    );
    expect(movimento?.quarentenaMotivo).toContain("MOVIMENTO_BAIXA_QUARENTENA");
  });

  it("quarentena overpayment e propaga a inconsistência a baixas e movimento vinculados", () => {
    const diretorio = fixtureOperacao("Efetivada", { primeiraBaixaValor: "500,00" });
    alterarShard(diretorio, "movimentos.json", (raiz) => {
      const movimento = (raiz.records as Array<Record<string, unknown>>)[0];
      Object.assign(movimento.fields as Record<string, unknown>, {
        conta_receber_id: "titulo-4950",
        valor: "500,00",
      });
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const titulo = plano.registros.find(
      (item): item is TituloLegadoPlanejado =>
        item.escopo === "TITULO_RECEBER" && item.legadoId === "titulo-4950",
    );
    const baixas = plano.registros.filter((item) => item.escopo === "BAIXA_RECEBER" && !item.estornada);
    const movimento = plano.registros.find(
      (item) => item.escopo === "MOVIMENTO" && item.legadoId === "447",
    );

    expect(titulo?.quarentenaMotivo).toContain("TITULO_BAIXAS_SUPERAM_DEVIDO");
    expect(baixas.every((item) => item.statusImportacao === "QUARENTENA")).toBe(true);
    expect(baixas.every((item) => item.quarentenaMotivo?.includes("BAIXA_TITULO_QUARENTENA"))).toBe(true);
    expect(movimento?.quarentenaMotivo).toContain("MOVIMENTO_TITULO_QUARENTENA");
  });

  it("propaga a quarentena do contrato a todas as partes", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "contratos.json", (raiz) => {
      const contrato = (raiz.records as Array<Record<string, unknown>>)[0];
      delete (contrato.fields as Record<string, unknown>).numero_contrato;
      delete (contrato.fields as Record<string, unknown>).produto_id;
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const partes = plano.registros.filter((item) => item.escopo === "CONTRATO_PARTE");

    expect(partes).toHaveLength(2);
    expect(partes.every((item) => item.statusImportacao === "QUARENTENA")).toBe(true);
    expect(partes.every((item) => item.quarentenaMotivo?.includes("PARTE_CONTRATO_QUARENTENA"))).toBe(true);
  });

  it("quarentena movimento quando escopo e IDs de título entram em conflito", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "movimentos.json", (raiz) => {
      const movimento = (raiz.records as Array<Record<string, unknown>>)[0];
      Object.assign(movimento.fields as Record<string, unknown>, {
        conta_receber_id: "titulo-4950",
        conta_tipo: "Pagar",
        titulo_id: "outro-titulo",
      });
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const movimento = plano.registros.find(
      (item) => item.escopo === "MOVIMENTO" && item.legadoId === "447",
    );

    expect(movimento).toMatchObject({ statusImportacao: "QUARENTENA" });
    expect(movimento?.quarentenaMotivo).toContain("MOVIMENTO_TITULO_CONFLITANTE");
  });

  it("cruza cada baixa com o movimento capturado e detecta vínculo a outro título", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "movimentos.json", (raiz) => {
      const movimento = (raiz.records as Array<Record<string, unknown>>)[0];
      Object.assign(movimento.fields as Record<string, unknown>, {
        conta_pagar_id: "pagar-1",
      });
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const baixa = plano.registros.find(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );
    const movimento = plano.registros.find(
      (item) => item.escopo === "MOVIMENTO" && item.legadoId === "447",
    );

    expect(baixa?.quarentenaMotivo).toContain("BAIXA_MOVIMENTO_TITULO_CONFLITANTE");
    expect(movimento?.quarentenaMotivo).toContain("MOVIMENTO_BAIXA_TITULO_CONFLITANTE");
  });

  it("reconcilia baixa e movimento por valor, data, natureza e conta", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      Object.assign((titulo.baixas as Array<Record<string, unknown>>)[0], {
        conta_bancaria_id: "10",
        data_pagamento: "06-09-2026",
        valor: "301,00",
      });
    });
    alterarShard(diretorio, "movimentos.json", (raiz) => {
      const movimento = (raiz.records as Array<Record<string, unknown>>)[0];
      Object.assign(movimento.fields as Record<string, unknown>, {
        conta_bancaria_id: "11",
        data_movimento: "05-09-2026",
        natureza: "Saída",
        valor: "300,00",
      });
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const baixa = plano.registros.find(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );
    const movimento = plano.registros.find(
      (item) => item.escopo === "MOVIMENTO" && item.legadoId === "447",
    );

    expect(baixa?.quarentenaMotivo).toEqual(expect.stringContaining("BAIXA_MOVIMENTO_VALOR_DIVERGENTE"));
    expect(baixa?.quarentenaMotivo).toEqual(expect.stringContaining("BAIXA_MOVIMENTO_DATA_DIVERGENTE"));
    expect(baixa?.quarentenaMotivo).toEqual(expect.stringContaining("BAIXA_MOVIMENTO_NATUREZA_DIVERGENTE"));
    expect(baixa?.quarentenaMotivo).toEqual(expect.stringContaining("BAIXA_MOVIMENTO_CONTA_DIVERGENTE"));
    expect(movimento?.statusImportacao).toBe("QUARENTENA");
  });

  it("explicita data ausente quando o movimento vinculado possui data", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      delete (titulo.baixas as Array<Record<string, unknown>>)[0].data_pagamento;
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const baixa = plano.registros.find(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );
    const movimento = plano.registros.find(
      (item) => item.escopo === "MOVIMENTO" && item.legadoId === "447",
    );

    expect(baixa?.quarentenaMotivo).toContain("BAIXA_MOVIMENTO_DATA_AUSENTE");
    expect(movimento?.quarentenaMotivo).toContain("MOVIMENTO_BAIXA_DATA_AUSENTE");
  });

  it("aceita arredondamento máximo de um centavo entre baixa e movimento", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      const titulo = (raiz.records as Array<Record<string, unknown>>)[0];
      (titulo.baixas as Array<Record<string, unknown>>)[0].valor = "300,01";
    });
    const baixa = carregarPlanoOperacaoWidesys(diretorio).registros.find(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );

    expect(baixa?.quarentenaMotivo).not.toContain("BAIXA_MOVIMENTO_VALOR_DIVERGENTE");
  });

  it("reconcilia lançamento agregado reutilizado por baixas de títulos diferentes", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      const [primeiro] = raiz.records as Array<Record<string, unknown>>;
      (primeiro.fields as Record<string, unknown>).valor_pago = "550,00";
      (primeiro.baixas as Array<Record<string, unknown>>)[0].valor = "200,00";
      (raiz.records as Array<Record<string, unknown>>).push({
        legacyId: "titulo-agregado-2",
        capturedAt: primeiro.capturedAt,
        fields: {
          vencimento: "01-09-2026",
          valor_devido: "100,00",
          valor_pago: "100,00",
          situacao: "Pago",
        },
        baixas: [
          {
            data_pagamento: "05-09-2026",
            numero_lancamento: "447",
            status: "Efetivada",
            valor: "100,00",
          },
        ],
      });
    });
    alterarShard(diretorio, "movimentos.json", (raiz) => {
      Object.assign(
        ((raiz.records as Array<Record<string, unknown>>)[0].fields as Record<string, unknown>),
        { conta_receber_id: "titulo-4950" },
      );
    });
    regravarManifesto(diretorio, (manifesto) => {
      const modulo = (manifesto.modules as Record<string, Record<string, unknown>>)["contas-receber"];
      modulo.recordsDiscovered = 2;
      modulo.recordsSaved = 2;
      modulo.globalReportedTotal = 2;
      const janela = (modulo.windows as Record<string, Record<string, unknown>>)["2026-09"];
      janela.recordsDiscovered = 2;
      janela.reportedTotal = 2;
    });
    const plano = carregarPlanoOperacaoWidesys(diretorio);
    const baixas = plano.registros.filter(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );
    const movimento = plano.registros.find(
      (item) => item.escopo === "MOVIMENTO" && item.legadoId === "447",
    );

    expect(baixas).toHaveLength(2);
    expect(baixas.every((baixa) => !baixa.quarentenaMotivo?.includes("BAIXA_MOVIMENTO_VALOR_DIVERGENTE"))).toBe(true);
    expect(baixas.every((baixa) => !baixa.quarentenaMotivo?.includes("BAIXA_MOVIMENTO_TITULO_CONFLITANTE"))).toBe(true);
    expect(movimento).toMatchObject({ statusImportacao: "STAGING" });
    expect(movimento?.snapshot).toContain('"crossTitle":true');
    expect(movimento?.snapshot).toContain('"somaBaixas":30000');
  });

  it("separa somas da fonte, aceitas e em quarentena", () => {
    const plano = carregarPlanoOperacaoWidesys(
      fixtureOperacao("Efetivada", { primeiraBaixaValor: "-50,00" }),
    );
    for (const linha of Object.values(plano.reconciliacao)) {
      expect(linha.somaFonte).toBe(linha.somaAceita + linha.somaQuarentena);
    }
    expect(plano.reconciliacao.MOVIMENTO).toMatchObject({
      somaAceita: 40_000,
      somaFonte: 70_000,
      somaQuarentena: 30_000,
    });
  });

  it("quarentena baixa cujo movimento deveria estar dentro da janela assinada", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "movimentos.json", (raiz) => {
      (raiz.records as Array<Record<string, unknown>>)[0].legacyId = "movimento-ausente-447";
    });
    const baixa = carregarPlanoOperacaoWidesys(diretorio).registros.find(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );

    expect(baixa?.quarentenaMotivo).toContain("BAIXA_MOVIMENTO_NAO_CAPTURADO");
  });

  it("rejeita manifesto v2 incompleto, sem hash ou com seleção divergente", () => {
    const incompleto = fixtureOperacao();
    regravarManifesto(incompleto, (manifesto) => {
      manifesto.complete = false;
    });
    expect(() => carregarPlanoOperacaoWidesys(incompleto)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_CAPTURA_INCOMPLETA" }),
    );

    const semHash = fixtureOperacao();
    regravarManifesto(
      semHash,
      (manifesto) => {
        delete manifesto.contentHash;
      },
      false,
    );
    expect(() => carregarPlanoOperacaoWidesys(semHash)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_HASH_INVALIDO" }),
    );

    const moduloAusente = fixtureOperacao();
    regravarManifesto(moduloAusente, (manifesto) => {
      delete (manifesto.modules as Record<string, unknown>).movimentacoes;
    });
    expect(() => carregarPlanoOperacaoWidesys(moduloAusente)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_MODULOS_DIVERGENTES" }),
    );

    const janelaAusente = fixtureOperacao();
    regravarManifesto(janelaAusente, (manifesto) => {
      const modulo = (manifesto.modules as Record<string, Record<string, unknown>>).contratos;
      modulo.windows = {};
    });
    expect(() => carregarPlanoOperacaoWidesys(janelaAusente)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_CAPTURA_INCOMPLETA" }),
    );
  });

  it("rejeita controle global que denuncia registros fora das janelas", () => {
    const diretorio = fixtureOperacao();
    regravarManifesto(diretorio, (manifesto) => {
      const modulo = (manifesto.modules as Record<string, Record<string, unknown>>)["contas-receber"];
      modulo.globalReportedTotal = Number(modulo.recordsDiscovered) + 1;
      modulo.globalCountVerified = false;
    });

    expect(() => carregarPlanoOperacaoWidesys(diretorio)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_TOTAL_GLOBAL_DIVERGENTE" }),
    );
  });

  it("rejeita manifesto v2 sem prova global de completude", () => {
    const diretorio = fixtureOperacao();
    regravarManifesto(diretorio, (manifesto) => {
      const modulo = (manifesto.modules as Record<string, Record<string, unknown>>).contratos;
      delete modulo.globalReportedTotal;
      delete modulo.globalCountVerified;
    });

    expect(() => carregarPlanoOperacaoWidesys(diretorio)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_TOTAL_GLOBAL_DIVERGENTE" }),
    );
  });

  it("rejeita registro capturado fora da janela temporal assinada", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      (raiz.records as Array<Record<string, unknown>>)[0].capturedAt = "2027-01-01T00:00:00.000Z";
    });
    expect(() => carregarPlanoOperacaoWidesys(diretorio)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_DATA_REGISTRO_FORA_DA_CAPTURA" }),
    );
  });

  it("rejeita registro sem timestamp próprio em vez de herdar o horário do lote", () => {
    const diretorio = fixtureOperacao();
    alterarShard(diretorio, "receber.json", (raiz) => {
      delete (raiz.records as Array<Record<string, unknown>>)[0].capturedAt;
    });
    expect(() => carregarPlanoOperacaoWidesys(diretorio)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_DATA_REGISTRO_INVALIDA" }),
    );
  });

  it("gera identidades e hashes determinísticos para uma reaplicação idempotente", () => {
    const diretorio = fixtureOperacao();
    const primeiro = carregarPlanoOperacaoWidesys(diretorio);
    const segundo = carregarPlanoOperacaoWidesys(diretorio);
    expect(segundo.registros.map((item) => [item.escopo, item.legadoId, item.snapshotHash])).toEqual(
      primeiro.registros.map((item) => [item.escopo, item.legadoId, item.snapshotHash]),
    );
  });

  it("ignora updatedAt volátil na identidade canônica da mesma captura", () => {
    const diretorio = fixtureOperacao();
    const primeiro = carregarPlanoOperacaoWidesys(diretorio);
    regravarManifesto(
      diretorio,
      (manifesto) => {
        manifesto.updatedAt = "2026-09-16T12:00:01.000Z";
      },
      false,
    );
    const segundo = carregarPlanoOperacaoWidesys(diretorio);

    expect(segundo.capturaId).toBe(primeiro.capturaId);
    expect(segundo.manifestoHash).toBe(primeiro.manifestoHash);
  });

  it("mantém a identidade da baixa quando somente seu status muda", () => {
    const primeira = carregarPlanoOperacaoWidesys(fixtureOperacao("Efetivada"));
    const segunda = carregarPlanoOperacaoWidesys(fixtureOperacao("Estornada"));
    const baixaPrimeira = primeira.registros.find(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );
    const baixaSegunda = segunda.registros.find(
      (item): item is BaixaLegadoPlanejada =>
        item.escopo === "BAIXA_RECEBER" && item.movimentoLegadoId === "447",
    );
    expect(baixaSegunda?.legadoId).toBe(baixaPrimeira?.legadoId);
    expect(baixaSegunda?.snapshotHash).not.toBe(baixaPrimeira?.snapshotHash);
    expect(baixaPrimeira?.estornada).toBe(false);
    expect(baixaSegunda?.estornada).toBe(true);
  });

  it("bloqueia artefato adulterado antes de abrir o banco", () => {
    const diretorio = fixtureOperacao();
    const caminho = join(diretorio, "receber.json");
    writeFileSync(caminho, readFileSync(caminho, "utf8").replace("715,68", "999,99"), "utf8");
    expect(() => carregarPlanoOperacaoWidesys(diretorio)).toThrowError(
      ErroImportacaoOperacaoWidesys,
    );
    try {
      carregarPlanoOperacaoWidesys(diretorio);
    } catch (erro) {
      expect((erro as ErroImportacaoOperacaoWidesys).codigo).toBe(
        "WIDESYS_OPERACAO_ARQUIVO_HASH_DIVERGENTE",
      );
    }
  });

  it("rejeita userinfo e rotas de origem não canônicas", () => {
    const comUserinfo = fixtureOperacao();
    alterarShard(comUserinfo, "contratos.json", (raiz) => {
      (raiz.records as Array<Record<string, unknown>>)[0].sourceUrl =
        "https://usuario:senha@brisaazul.app2.widesys.com.br/administrator/index.php?option=com_widesys&view=locacao&layout=edit&id=1";
    });
    expect(() => carregarPlanoOperacaoWidesys(comUserinfo)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_URL_INVALIDA" }),
    );

    const rotaNaoCanonica = fixtureOperacao();
    alterarShard(rotaNaoCanonica, "contratos.json", (raiz) => {
      (raiz.records as Array<Record<string, unknown>>)[0].sourceUrl =
        "https://brisaazul.app2.widesys.com.br/administrator/outro.php?option=com_widesys&view=locacao&layout=edit&id=1";
    });
    expect(() => carregarPlanoOperacaoWidesys(rotaNaoCanonica)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_URL_INVALIDA" }),
    );
  });

  it("exige também os artefatos de evidência que não são shards de escopo", () => {
    const diretorio = fixtureOperacao();
    const evidencia = "<html><body><table><tr><td>evidência</td></tr></table></body></html>";
    writeFileSync(join(diretorio, "evidencia-lista.html"), evidencia, "utf8");
    regravarManifesto(diretorio, (manifesto) => {
      (manifesto.artifacts as Array<Record<string, unknown>>).push({
        bytes: Buffer.byteLength(evidencia),
        kind: "list-html",
        module: "contratos",
        path: "evidencia-lista.html",
        sha256: sha256(evidencia),
        sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php",
        window: "todos",
      });
    });
    rmSync(join(diretorio, "evidencia-lista.html"));

    expect(() => carregarPlanoOperacaoWidesys(diretorio)).toThrowError(
      expect.objectContaining({ codigo: "WIDESYS_OPERACAO_ARQUIVO_AUSENTE" }),
    );
  });

  it("registra captura anterior no lote sem regredir o staging mais novo", async () => {
    const carregado = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const base = carregado.registros.find(
      (item): item is TituloLegadoPlanejado => item.escopo === "TITULO_RECEBER",
    )!;
    const antigo: TituloLegadoPlanejado = {
      ...base,
      capturadoEm: new Date("2026-09-15T12:00:00.000Z"),
      snapshot: `${base.snapshot}-antigo`,
      snapshotHash: "a".repeat(64),
    };
    const plano: PlanoOperacaoWidesys = {
      ...carregado,
      capturaId: "captura-antiga",
      capturadoEm: antigo.capturadoEm,
      manifestoHash: "b".repeat(64),
      registros: [antigo],
    };
    const canonico = {
      capturadoEm: new Date("2026-09-16T12:00:00.000Z"),
      quarentenaMotivo: null,
      snapshotHash: "c".repeat(64),
      statusImportacao: "STAGING",
    };
    let lote: Record<string, unknown> | null = null;
    let gravacoesCanonicas = 0;
    let acaoItem: unknown;
    const tx = {
      baixaFinanceiraLegado: semAusentes,
      contratoLegado: semAusentes,
      contratoParteLegado: semAusentes,
      importacaoLegadoItem: {
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          acaoItem = create.acao;
          return { id: "item-antigo" };
        },
      },
      movimentoFinanceiroLegado: semAusentes,
      tituloFinanceiroLegado: {
        ...semAusentes,
        findUnique: async () => canonico,
        upsert: async () => {
          gravacoesCanonicas += 1;
          return { id: "titulo-1" };
        },
      },
    };
    const prisma = {
      importacaoLegadoLote: {
        findUnique: async () => lote,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { id: "lote-antigo", status: "PROCESSANDO", ...data };
          return lote;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { ...(lote ?? { id: "lote-antigo" }), ...data };
          return lote;
        },
      },
      $transaction: async (executar: (cliente: typeof tx) => Promise<unknown>) => executar(tx),
    } as unknown as PrismaClient;

    const relatorio = await importarPlanoOperacaoWidesys(prisma, plano, { tamanhoLote: 1 });

    expect(gravacoesCanonicas).toBe(0);
    expect(acaoItem).toBe("ANTERIOR_IGNORADO");
    expect(relatorio.porEscopo.TITULO_RECEBER.anterioresIgnorados).toBe(1);
    expect(canonico.snapshotHash).toBe("c".repeat(64));
  });

  it("não recria filho antigo ausente quando o pai canônico já é mais novo", async () => {
    const carregado = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const parte = carregado.registros.find((item) => item.escopo === "CONTRATO_PARTE")!;
    const plano: PlanoOperacaoWidesys = {
      ...carregado,
      capturaId: "captura-filho-antigo",
      manifestoHash: "d".repeat(64),
      registros: [parte],
    };
    let lote: Record<string, unknown> | null = null;
    let acaoItem: unknown;
    let gravacoesFilho = 0;
    const tx = {
      baixaFinanceiraLegado: semAusentes,
      contratoLegado: {
        ...semAusentes,
        findUnique: async () => ({
          capturadoEm: new Date("2026-09-17T12:00:00.000Z"),
          statusImportacao: "STAGING",
        }),
      },
      contratoParteLegado: {
        ...semAusentes,
        findUnique: async () => null,
        upsert: async () => {
          gravacoesFilho += 1;
          return { id: "parte-1" };
        },
      },
      importacaoLegadoItem: {
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          acaoItem = create.acao;
          return { id: "item-filho-antigo" };
        },
      },
      movimentoFinanceiroLegado: semAusentes,
      tituloFinanceiroLegado: semAusentes,
    };
    const prisma = {
      importacaoLegadoLote: {
        findUnique: async () => lote,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { id: "lote-filho-antigo", status: "PROCESSANDO", ...data };
          return lote;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { ...(lote ?? { id: "lote-filho-antigo" }), ...data };
          return lote;
        },
      },
      $transaction: async (executar: (cliente: typeof tx) => Promise<unknown>) => executar(tx),
    } as unknown as PrismaClient;

    const relatorio = await importarPlanoOperacaoWidesys(prisma, plano, { tamanhoLote: 1 });

    expect(acaoItem).toBe("ANTERIOR_IGNORADO");
    expect(gravacoesFilho).toBe(0);
    expect(relatorio.porEscopo.CONTRATO_PARTE.anterioresIgnorados).toBe(1);
  });

  it("persiste filho no retry quando o pai foi gravado pelo mesmo lote", async () => {
    const carregado = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const parte = carregado.registros.find((item) => item.escopo === "CONTRATO_PARTE")!;
    const plano: PlanoOperacaoWidesys = {
      ...carregado,
      capturaId: "captura-retry-filho",
      manifestoHash: "7".repeat(64),
      registros: [parte],
    };
    let gravacoesFilho = 0;
    const lote = {
      id: "lote-retry",
      status: "FALHOU",
      manifestoHash: plano.manifestoHash,
    };
    const contratoMesmoLote = {
      id: "contrato-canonico",
      capturadoEm: new Date("2026-09-16T11:30:00.000Z"),
      statusImportacao: "STAGING",
      ultimoItem: {
        lote: { id: lote.id, capturadoEm: plano.capturadoEm },
      },
    };
    const tx = {
      baixaFinanceiraLegado: semAusentes,
      contratoLegado: {
        ...semAusentes,
        findUnique: async () => contratoMesmoLote,
      },
      contratoParteLegado: {
        ...semAusentes,
        findUnique: async () => null,
        upsert: async () => {
          gravacoesFilho += 1;
          return { id: "parte-retry" };
        },
      },
      importacaoLegadoItem: {
        upsert: async () => ({ id: "item-retry" }),
      },
      movimentoFinanceiroLegado: semAusentes,
      tituloFinanceiroLegado: semAusentes,
    };
    const prisma = {
      importacaoLegadoLote: {
        findUnique: async () => lote,
        update: async ({ data }: { data: Record<string, unknown> }) => ({ ...lote, ...data }),
      },
      $transaction: async (executar: (cliente: typeof tx) => Promise<unknown>) => executar(tx),
    } as unknown as PrismaClient;

    const relatorio = await importarPlanoOperacaoWidesys(prisma, plano, { tamanhoLote: 1 });

    expect(gravacoesFilho).toBe(1);
    expect(relatorio.porEscopo.CONTRATO_PARTE.criados).toBe(1);
    expect(relatorio.porEscopo.CONTRATO_PARTE.anterioresIgnorados).toBe(0);
  });

  it("marca como ausente o canônico que sumiu sem apagar seu histórico", async () => {
    const carregado = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const titulo = carregado.registros.find(
      (item): item is TituloLegadoPlanejado => item.escopo === "TITULO_RECEBER",
    )!;
    const plano: PlanoOperacaoWidesys = { ...carregado, registros: [titulo] };
    let lote: Record<string, unknown> | null = null;
    const acoes: string[] = [];
    let atualizacaoAusente: Record<string, unknown> | null = null;
    const tx = {
      baixaFinanceiraLegado: semAusentes,
      contratoLegado: semAusentes,
      contratoParteLegado: semAusentes,
      importacaoLegadoItem: {
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          acoes.push(String(create.acao));
          return { id: create.acao === "MARCAR_AUSENTE" ? "item-ausente" : "item-atual" };
        },
      },
      movimentoFinanceiroLegado: semAusentes,
      tituloFinanceiroLegado: {
        findMany: async ({ where }: { where: { escopo: string } }) =>
          where.escopo === "TITULO_RECEBER"
            ? [
                {
                  capturadoEm: new Date("2026-09-15T12:00:00.000Z"),
                  legadoId: "titulo-que-sumiu",
                  snapshotHash: "e".repeat(64),
                  vencimento: "2026-09-10",
                  ultimoItem: { lote: { capturadoEm: new Date("2026-09-15T12:00:00.000Z") } },
                },
              ]
            : [],
        findUnique: async () => null,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          atualizacaoAusente = data;
          return { id: "titulo-ausente" };
        },
        upsert: async () => ({ id: "titulo-atual" }),
      },
    };
    const prisma = {
      importacaoLegadoLote: {
        findUnique: async () => lote,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { id: "lote-tombstone", status: "PROCESSANDO", ...data };
          return lote;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { ...(lote ?? { id: "lote-tombstone" }), ...data };
          return lote;
        },
      },
      $transaction: async (executar: (cliente: typeof tx) => Promise<unknown>) => executar(tx),
    } as unknown as PrismaClient;

    const relatorio = await importarPlanoOperacaoWidesys(prisma, plano, { tamanhoLote: 1 });

    expect(acoes).toContain("MARCAR_AUSENTE");
    expect(atualizacaoAusente).toMatchObject({
      ultimoItemId: "item-ausente",
      statusImportacao: "AUSENTE_NA_FONTE",
    });
    expect(relatorio.porEscopo.TITULO_RECEBER.ausentesMarcados).toBe(1);
  });

  it("não repete tombstone para canônico que já está ausente", async () => {
    const carregado = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const titulo = carregado.registros.find(
      (item): item is TituloLegadoPlanejado => item.escopo === "TITULO_RECEBER",
    )!;
    const plano: PlanoOperacaoWidesys = { ...carregado, registros: [titulo] };
    let gravacoes = 0;
    const prisma = {
      baixaFinanceiraLegado: semAusentes,
      contratoLegado: semAusentes,
      contratoParteLegado: semAusentes,
      movimentoFinanceiroLegado: semAusentes,
      tituloFinanceiroLegado: {
        findMany: async ({ where }: { where: { escopo: string } }) =>
          where.escopo === "TITULO_RECEBER"
            ? [
                {
                  capturadoEm: new Date("2026-09-15T12:00:00.000Z"),
                  legadoId: "titulo-ja-ausente",
                  snapshotHash: "d".repeat(64),
                  statusImportacao: "AUSENTE_NA_FONTE",
                  vencimento: "2026-09-10",
                  ultimoItem: { lote: { capturadoEm: new Date("2026-09-16T12:00:00.000Z") } },
                },
              ]
            : [],
      },
      importacaoLegadoItem: {
        upsert: async () => {
          gravacoes += 1;
          return { id: "não-deveria-gravar" };
        },
      },
    } as unknown as PrismaClient;

    const relatorio = await criarRelatorioDryRunComBancoOperacaoWidesys(prisma, plano);

    expect(gravacoes).toBe(0);
    expect(relatorio.porEscopo.TITULO_RECEBER.ausentesMarcados).toBe(0);
  });

  it("dry-run consulta o staging e prevê tombstones sem escrever", async () => {
    const plano = carregarPlanoOperacaoWidesys(fixtureOperacao());
    let consultasBaixa = 0;
    const prisma = {
      baixaFinanceiraLegado: {
        findMany: async ({ where }: { where: { escopo: string } }) => {
          consultasBaixa += 1;
          return where.escopo === "BAIXA_RECEBER"
            ? [
                {
                  capturadoEm: new Date("2026-09-15T12:00:00.000Z"),
                  legadoId: "baixa-que-sumiu",
                  snapshotHash: "f".repeat(64),
                  tituloEscopo: "TITULO_RECEBER",
                  tituloLegadoId: "titulo-da-baixa",
                  ultimoItem: {
                    lote: { capturadoEm: new Date("2026-09-15T12:00:00.000Z") },
                  },
                },
              ]
            : [];
        },
      },
      contratoLegado: semAusentes,
      contratoParteLegado: semAusentes,
      movimentoFinanceiroLegado: semAusentes,
      tituloFinanceiroLegado: {
        findMany: async ({ where }: { where: { escopo?: string } }) =>
          where.escopo === "TITULO_RECEBER"
            ? [
                {
                  capturadoEm: new Date("2026-09-15T12:00:00.000Z"),
                  legadoId: "titulo-da-baixa",
                  quarentenaMotivo: null,
                  snapshotHash: "a".repeat(64),
                  statusImportacao: "STAGING",
                  vencimento: "2026-09-10",
                },
              ]
            : [],
      },
    } as unknown as PrismaClient;

    const relatorio = await criarRelatorioDryRunComBancoOperacaoWidesys(
      prisma,
      plano,
    );

    expect(relatorio.modo).toBe("DRY_RUN");
    expect(relatorio.escoposBaixasCompletos).toContain("BAIXA_RECEBER");
    expect(relatorio.porEscopo.BAIXA_RECEBER.ausentesMarcados).toBe(1);
    // Uma consulta classifica os existentes; a segunda prevê tombstones.
    expect(consultasBaixa).toBe(2);
  });

  it("não cria tombstones de baixas quando algum título não prova completude", async () => {
    const carregado = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const plano: PlanoOperacaoWidesys = {
      ...carregado,
      capturaId: "captura-baixas-incompletas",
      escoposBaixasCompletos: [],
      manifestoHash: "9".repeat(64),
      registros: [],
    };
    let lote: Record<string, unknown> | null = null;
    const naoPodeConsultar = async () => {
      throw new Error("baixas incompletas não podem ser consultadas para tombstone");
    };
    const tx = {
      baixaFinanceiraLegado: { findMany: naoPodeConsultar },
      contratoLegado: semAusentes,
      contratoParteLegado: semAusentes,
      importacaoLegadoItem: { upsert: async () => ({ id: "não-usado" }) },
      movimentoFinanceiroLegado: semAusentes,
      tituloFinanceiroLegado: semAusentes,
    };
    const prisma = {
      importacaoLegadoLote: {
        findUnique: async () => lote,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { id: "lote-baixas-incompletas", status: "PROCESSANDO", ...data };
          return lote;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { ...(lote ?? { id: "lote-baixas-incompletas" }), ...data };
          return lote;
        },
      },
      $transaction: async (executar: (cliente: typeof tx) => Promise<unknown>) =>
        executar(tx),
    } as unknown as PrismaClient;

    const relatorio = await importarPlanoOperacaoWidesys(prisma, plano);

    expect(relatorio.porEscopo.BAIXA_RECEBER.ausentesMarcados).toBe(0);
    expect(relatorio.porEscopo.BAIXA_PAGAR.ausentesMarcados).toBe(0);
  });

  it("não marca como ausente registro fora da janela assinada da recaptura", async () => {
    const carregado = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const plano: PlanoOperacaoWidesys = {
      ...carregado,
      registros: [],
      escoposBaixasCompletos: [],
      coberturaTemporal: {
        TITULO_RECEBER: { inicio: "2026-09-01", fim: "2026-09-30" },
        TITULO_PAGAR: { inicio: "2026-09-01", fim: "2026-09-30" },
        MOVIMENTO: { inicio: "2026-09-01", fim: "2026-09-30" },
      },
    };
    const prisma = {
      baixaFinanceiraLegado: semAusentes,
      contratoLegado: semAusentes,
      contratoParteLegado: semAusentes,
      tituloFinanceiroLegado: {
        findMany: async ({ where }: { where: { escopo?: string } }) =>
          where.escopo === "TITULO_RECEBER"
            ? [
                {
                  capturadoEm: new Date("2026-08-10T12:00:00.000Z"),
                  legadoId: "titulo-agosto",
                  snapshotHash: "1".repeat(64),
                  vencimento: "2026-08-10",
                },
              ]
            : [],
      },
      movimentoFinanceiroLegado: {
        findMany: async ({ where }: { where: { escopo?: string } }) =>
          where.escopo === "MOVIMENTO"
            ? [
                {
                  capturadoEm: new Date("2026-08-10T12:00:00.000Z"),
                  dataMovimento: "2026-08-10",
                  legadoId: "movimento-agosto",
                  snapshotHash: "2".repeat(64),
                },
              ]
            : [],
      },
    } as unknown as PrismaClient;

    const relatorio = await criarRelatorioDryRunComBancoOperacaoWidesys(prisma, plano);

    expect(relatorio.porEscopo.TITULO_RECEBER.ausentesMarcados).toBe(0);
    expect(relatorio.porEscopo.MOVIMENTO.ausentesMarcados).toBe(0);
  });

  it("captura parcial só cria tombstones nos escopos assinados", async () => {
    const diretorio = fixtureOperacao();
    regravarManifesto(diretorio, (manifesto) => {
      (manifesto.options as Record<string, unknown>).modules = ["contratos"];
      manifesto.modules = {
        contratos: (manifesto.modules as Record<string, unknown>).contratos,
      };
      manifesto.files = (manifesto.files as Array<Record<string, unknown>>).filter(
        (arquivo) => arquivo.scope === "contratos",
      );
      manifesto.artifacts = (manifesto.artifacts as Array<Record<string, unknown>>).filter(
        (artefato) => artefato.module === "contratos",
      );
    });
    const carregado = carregarPlanoOperacaoWidesys(diretorio);
    expect(carregado.escoposCobertos).toEqual(["CONTRATO", "CONTRATO_PARTE"]);
    const plano: PlanoOperacaoWidesys = { ...carregado, registros: [] };
    let lote: Record<string, unknown> | null = null;
    const naoPodeConsultar = async () => {
      throw new Error("escopo não coberto foi consultado");
    };
    const tx = {
      baixaFinanceiraLegado: { findMany: naoPodeConsultar },
      contratoLegado: { findMany: async () => [] },
      contratoParteLegado: { findMany: async () => [] },
      importacaoLegadoItem: { upsert: async () => ({ id: "não-usado" }) },
      movimentoFinanceiroLegado: { findMany: naoPodeConsultar },
      tituloFinanceiroLegado: { findMany: naoPodeConsultar },
    };
    const prisma = {
      importacaoLegadoLote: {
        findUnique: async () => lote,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { id: "lote-parcial", status: "PROCESSANDO", ...data };
          return lote;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          lote = { ...(lote ?? { id: "lote-parcial" }), ...data };
          return lote;
        },
      },
      $transaction: async (executar: (cliente: typeof tx) => Promise<unknown>) => executar(tx),
    } as unknown as PrismaClient;

    const relatorio = await importarPlanoOperacaoWidesys(prisma, plano);

    expect(relatorio.modo).toBe("APLICADO");
    expect(Object.values(relatorio.porEscopo).every((item) => item.ausentesMarcados === 0)).toBe(true);
  });

  it("encerra a segunda aplicação do mesmo lote sem duplicar itens", async () => {
    const carregado = carregarPlanoOperacaoWidesys(fixtureOperacao());
    const titulo = carregado.registros.find(
      (item): item is TituloLegadoPlanejado => item.escopo === "TITULO_RECEBER",
    )!;
    const plano: PlanoOperacaoWidesys = { ...carregado, registros: [titulo] };
    let lote: Record<string, unknown> | null = null;
    let hashTitulo: string | null = null;
    let transacoes = 0;
    const loteDelegate = {
      findUnique: async () => lote,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        lote = { id: "lote-1", status: "PROCESSANDO", ...data };
        return lote;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        lote = { ...(lote ?? { id: "lote-1" }), ...data };
        return lote;
      },
    };
    const tx = {
      baixaFinanceiraLegado: semAusentes,
      contratoLegado: semAusentes,
      contratoParteLegado: semAusentes,
      importacaoLegadoItem: {
        upsert: async () => ({ id: "item-1" }),
      },
      movimentoFinanceiroLegado: semAusentes,
      tituloFinanceiroLegado: {
        ...semAusentes,
        findUnique: async () => (hashTitulo ? { snapshotHash: hashTitulo } : null),
        upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          hashTitulo = String((hashTitulo ? update : create).snapshotHash);
          return { id: "titulo-1" };
        },
      },
    };
    const prisma = {
      importacaoLegadoLote: loteDelegate,
      $transaction: async (executar: (cliente: typeof tx) => Promise<unknown>) => {
        transacoes += 1;
        return executar(tx);
      },
    } as unknown as PrismaClient;

    const primeira = await importarPlanoOperacaoWidesys(prisma, plano, { tamanhoLote: 1 });
    const segunda = await importarPlanoOperacaoWidesys(prisma, plano, { tamanhoLote: 1 });

    expect(primeira.modo).toBe("APLICADO");
    expect(segunda.modo).toBe("JA_APLICADO");
    expect(transacoes).toBe(2);
  });
});
