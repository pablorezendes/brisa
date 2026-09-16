import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  carregarPlanoCatalogosWidesys,
  criarRelatorioDryRunCatalogosWidesys,
  ErroImportacaoCatalogosWidesys,
  importarPlanoCatalogosWidesys,
  validarIdentidadeCapturaCatalogos,
} from "./catalogos-widesys";
import {
  WIDESYS_CATALOG_MANIFEST_SCHEMA,
  widesysCatalogManifestContentHash,
} from "./widesys-catalog-manifest";

const ORIGEM = "https://brisaazul.app2.widesys.com.br";

function sha256(valor: string | Buffer): string {
  return createHash("sha256").update(valor).digest("hex");
}

type RegistroSintetico = {
  fetchedAt?: string;
  id: string;
  modulo: "contas" | "irrf" | "plano-contas";
  raw?: Record<string, unknown>;
  sourceUrl?: string;
};

function criarCaptura(registros: RegistroSintetico[]) {
  const diretorio = mkdtempSync(join(tmpdir(), "catalogos-widesys-"));
  const artifacts = registros.map((registro, indice) => {
    const caminho = `${registro.modulo}/records/${registro.id}-${indice}.json`;
    const conteudo = `${JSON.stringify({
      fetchedAt: registro.fetchedAt ?? "2026-09-16T12:00:00.000Z",
      id: registro.id,
      module: registro.modulo,
      raw: registro.raw ?? {
        controls: [{ name: "jform[nome]", type: "text", value: `Registro ${indice + 1}` }],
        tables: [],
        title: `Catálogo ${indice + 1}`,
      },
      sourceUrl:
        registro.sourceUrl ??
        `${ORIGEM}/administrator/index.php?option=com_widesys&view=${registro.modulo}`,
    }, null, 2)}\n`;
    const absoluto = join(diretorio, caminho);
    mkdirSync(dirname(absoluto), { recursive: true });
    writeFileSync(absoluto, conteudo);
    return {
      bytes: Buffer.byteLength(conteudo),
      kind: "detail-json",
      module: registro.modulo,
      path: caminho,
      sha256: sha256(conteudo),
      sourceUrl:
        registro.sourceUrl ??
        `${ORIGEM}/administrator/index.php?option=com_widesys&view=${registro.modulo}`,
    };
  });
  const modules = Object.fromEntries(
    [...new Set(registros.map((item) => item.modulo))].map((modulo) => {
      const total = registros.filter((item) => item.modulo === modulo).length;
      return [
        modulo,
        {
          completed: true,
          countSource: modulo === "irrf" ? "singleton" : "reported",
          detailErrors: 0,
          explicitlyEmpty: false,
          label: modulo,
          pagesFetched: 1,
          recordsDiscovered: total,
          recordsSaved: total,
          recordsSkipped: 0,
          reportedTotal: total,
          sourceUrl: `${ORIGEM}/administrator/index.php?option=com_widesys&view=${modulo}`,
        },
      ];
    }),
  );
  for (const modulo of new Set(registros.map((item) => item.modulo))) {
    const registrosModulo = registros.filter((item) => item.modulo === modulo);
    const detailUrls =
      modulo === "irrf"
        ? []
        : registrosModulo.map((registro) =>
            modulo === "plano-contas"
              ? `${ORIGEM}/administrator/index.php?option=com_categories&extension=com_widesys.planocontas&view=category&layout=edit&id=${registro.id}`
              : `${ORIGEM}/administrator/index.php?option=com_widesys&view=conta&layout=edit&id=${registro.id}`,
          );
    const paginas = [
      {
        caminho: `${modulo}/pages/page-00001.html`,
        conteudo: `<html><title>${modulo}</title><body><form><table></table></form></body></html>`,
        kind: "list-html",
      },
      {
        caminho: `${modulo}/pages/page-00001.json`,
        conteudo: `${JSON.stringify({
          detailUrls,
          discoveredOnPage: registrosModulo.length,
          explicitlyEmpty: false,
          module: modulo,
          reportedTotal: registrosModulo.length,
          terminalWithoutReportedTotal: false,
        })}\n`,
        kind: "list-json",
      },
    ];
    for (const pagina of paginas) {
      const absoluto = join(diretorio, pagina.caminho);
      mkdirSync(dirname(absoluto), { recursive: true });
      writeFileSync(absoluto, pagina.conteudo);
      artifacts.push({
        bytes: Buffer.byteLength(pagina.conteudo),
        kind: pagina.kind,
        module: modulo,
        path: pagina.caminho,
        sha256: sha256(pagina.conteudo),
        sourceUrl: `${ORIGEM}/administrator/index.php?option=com_widesys&view=${modulo}`,
      });
    }
  }
  const errors: unknown[] = [];
  const selectedModules = [...new Set(registros.map((item) => item.modulo))];
  const manifesto = {
    artifacts,
    baseOrigin: ORIGEM,
    captureId: "11111111-1111-4111-8111-111111111111",
    completedAt: "2026-09-16T12:05:00.000Z",
    contentHash: "",
    errors,
    modules,
    options: {
      captureMode: "refresh",
      delayMs: 0,
      irrfYears: [2026],
      limit: 200,
      maxPages: 10,
      modules: selectedModules,
    },
    schema: WIDESYS_CATALOG_MANIFEST_SCHEMA,
    startedAt: "2026-09-16T12:00:00.000Z",
    updatedAt: "2026-09-16T12:05:00.000Z",
    version: 1,
  };
  manifesto.contentHash = widesysCatalogManifestContentHash(manifesto);
  writeFileSync(join(diretorio, "manifest.json"), `${JSON.stringify(manifesto, null, 2)}\n`);
  return { artifacts, diretorio, manifesto };
}

function reescreverArtefato(
  captura: ReturnType<typeof criarCaptura>,
  modulo: RegistroSintetico["modulo"],
  kind: "list-html" | "list-json",
  conteudo: string,
): void {
  const artefato = captura.manifesto.artifacts.find(
    (item) => item.module === modulo && item.kind === kind,
  );
  if (!artefato) throw new Error(`fixture sem ${kind} de ${modulo}`);
  writeFileSync(join(captura.diretorio, artefato.path), conteudo);
  artefato.bytes = Buffer.byteLength(conteudo);
  artefato.sha256 = sha256(conteudo);
}

function esperarErro(codigo: string, executar: () => unknown): void {
  try {
    executar();
    throw new Error("Era esperado um erro de importação.");
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroImportacaoCatalogosWidesys);
    expect((erro as ErroImportacaoCatalogosWidesys).codigo).toBe(codigo);
  }
}

describe("catálogos Widesys em staging", () => {
  it("carrega registros e singleton, valida hashes e reconcilia por módulo", () => {
    const captura = criarCaptura([
      { id: "7", modulo: "contas" },
      { id: "singleton", modulo: "irrf" },
    ]);
    const plano = carregarPlanoCatalogosWidesys(captura.diretorio);
    const relatorio = criarRelatorioDryRunCatalogosWidesys(plano);

    expect(plano.registros.map((item) => `${item.modulo}:${item.legadoId}`)).toEqual([
      "contas:7",
      "irrf:singleton",
    ]);
    expect(relatorio.total).toBe(2);
    expect(relatorio.quarentena).toBe(0);
    expect(relatorio.modulos).toEqual([
      { modulo: "contas", total: 1, staging: 1, quarentena: 0 },
      { modulo: "irrf", total: 1, staging: 1, quarentena: 0 },
    ]);
    expect(plano.registros[0]?.snapshot).not.toContain("manifest.json");
    expect(plano.capturaId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("aceita estritamente ID numerico assinado de categoria", () => {
    const captura = criarCaptura([{ id: "-7", modulo: "plano-contas" }]);
    const [registro] = carregarPlanoCatalogosWidesys(captura.diretorio).registros;
    expect(registro?.legadoId).toBe("-7");

    const invalida = criarCaptura([{ id: "categoria--7", modulo: "plano-contas" }]);
    esperarErro("WIDESYS_CATALOGOS_REGISTRO_INVALIDO", () =>
      carregarPlanoCatalogosWidesys(invalida.diretorio),
    );
  });

  it("exige paginas verificaveis por modulo e permite catalogo realmente vazio", () => {
    const semPagina = criarCaptura([{ id: "13", modulo: "contas" }]);
    semPagina.manifesto.artifacts = semPagina.manifesto.artifacts.filter(
      (artefato) => artefato.kind !== "list-json",
    );
    semPagina.manifesto.contentHash = widesysCatalogManifestContentHash(semPagina.manifesto);
    writeFileSync(join(semPagina.diretorio, "manifest.json"), JSON.stringify(semPagina.manifesto));
    esperarErro("WIDESYS_CATALOGOS_CAPTURA_INCOMPLETA", () =>
      carregarPlanoCatalogosWidesys(semPagina.diretorio),
    );

    const vazia = criarCaptura([{ id: "14", modulo: "contas" }]);
    vazia.manifesto.artifacts = vazia.manifesto.artifacts.filter(
      (artefato) => !artefato.kind.startsWith("detail-"),
    );
    Object.assign(vazia.manifesto.modules.contas!, {
      countSource: "explicit-empty",
      explicitlyEmpty: true,
      recordsDiscovered: 0,
      recordsSaved: 0,
      recordsSkipped: 0,
      reportedTotal: 0,
    });
    reescreverArtefato(
      vazia,
      "contas",
      "list-html",
      "<html><title>Contas</title><body><form><table></table><p>Nenhum resultado</p></form></body></html>",
    );
    reescreverArtefato(
      vazia,
      "contas",
      "list-json",
      `${JSON.stringify({
        detailUrls: [],
        discoveredOnPage: 0,
        explicitlyEmpty: true,
        module: "contas",
        reportedTotal: 0,
        terminalWithoutReportedTotal: false,
      })}\n`,
    );
    vazia.manifesto.contentHash = widesysCatalogManifestContentHash(vazia.manifesto);
    writeFileSync(join(vazia.diretorio, "manifest.json"), JSON.stringify(vazia.manifesto));
    const planoVazio = carregarPlanoCatalogosWidesys(vazia.diretorio);
    expect(planoVazio.registros).toHaveLength(0);
    expect(planoVazio.reconciliacao).toEqual([
      { modulo: "contas", total: 0, staging: 0, quarentena: 0 },
    ]);
  });

  it("revalida contagem inferida e nao aceita vazio apenas por metadados", () => {
    const terminal = criarCaptura([{ id: "19", modulo: "contas" }]);
    Object.assign(terminal.manifesto.modules.contas!, {
      countSource: "terminal-page",
      reportedTotal: 1,
    });
    reescreverArtefato(
      terminal,
      "contas",
      "list-json",
      `${JSON.stringify({
        detailUrls: [
          `${ORIGEM}/administrator/index.php?option=com_widesys&view=conta&layout=edit&id=19`,
        ],
        discoveredOnPage: 1,
        explicitlyEmpty: false,
        module: "contas",
        reportedTotal: null,
        terminalWithoutReportedTotal: true,
      })}\n`,
    );
    terminal.manifesto.contentHash = widesysCatalogManifestContentHash(terminal.manifesto);
    writeFileSync(join(terminal.diretorio, "manifest.json"), JSON.stringify(terminal.manifesto));
    expect(carregarPlanoCatalogosWidesys(terminal.diretorio).registros).toHaveLength(1);

    const divergente = criarCaptura([{ id: "20", modulo: "contas" }]);
    divergente.manifesto.modules.contas!.reportedTotal = 2;
    divergente.manifesto.contentHash = widesysCatalogManifestContentHash(divergente.manifesto);
    writeFileSync(join(divergente.diretorio, "manifest.json"), JSON.stringify(divergente.manifesto));
    esperarErro("WIDESYS_CATALOGOS_CAPTURA_INCOMPLETA", () =>
      carregarPlanoCatalogosWidesys(divergente.diretorio),
    );

    const vazioFabricado = criarCaptura([{ id: "21", modulo: "contas" }]);
    vazioFabricado.manifesto.artifacts = vazioFabricado.manifesto.artifacts.filter(
      (artefato) => !artefato.kind.startsWith("detail-"),
    );
    Object.assign(vazioFabricado.manifesto.modules.contas!, {
      countSource: "explicit-empty",
      explicitlyEmpty: true,
      recordsDiscovered: 0,
      recordsSaved: 0,
      recordsSkipped: 0,
      reportedTotal: 0,
    });
    reescreverArtefato(
      vazioFabricado,
      "contas",
      "list-json",
      `${JSON.stringify({
        detailUrls: [],
        discoveredOnPage: 0,
        explicitlyEmpty: true,
        module: "contas",
        reportedTotal: 0,
        terminalWithoutReportedTotal: false,
      })}\n`,
    );
    vazioFabricado.manifesto.contentHash = widesysCatalogManifestContentHash(
      vazioFabricado.manifesto,
    );
    writeFileSync(
      join(vazioFabricado.diretorio, "manifest.json"),
      JSON.stringify(vazioFabricado.manifesto),
    );
    esperarErro("WIDESYS_CATALOGOS_VAZIO_SEM_EVIDENCIA", () =>
      carregarPlanoCatalogosWidesys(vazioFabricado.diretorio),
    );
  });

  it("redige um campo sensível e o envia à quarentena sem persistir o valor", () => {
    const captura = criarCaptura([
      {
        id: "8",
        modulo: "contas",
        raw: {
          controls: [{ name: "jform[senha_certificado]", type: "password", value: "segredo-sintetico" }],
          tables: [],
          title: "Configuração bancária",
        },
      },
    ]);
    const [registro] = carregarPlanoCatalogosWidesys(captura.diretorio).registros;

    expect(registro?.status).toBe("QUARENTENA");
    expect(registro?.quarentenaMotivo).toBe("CONTEUDO_SENSIVEL_REDACTADO");
    expect(registro?.snapshot).toContain("[REDACTED]");
    expect(registro?.snapshot).not.toContain("segredo-sintetico");
  });

  it("bloqueia path traversal antes de tentar importar o artefato", () => {
    const captura = criarCaptura([{ id: "9", modulo: "contas" }]);
    captura.manifesto.artifacts[0]!.path = "contas/../../../fora.json";
    captura.manifesto.contentHash = widesysCatalogManifestContentHash(captura.manifesto);
    writeFileSync(join(captura.diretorio, "manifest.json"), JSON.stringify(captura.manifesto));

    esperarErro("WIDESYS_CATALOGOS_CAMINHO_INVALIDO", () =>
      carregarPlanoCatalogosWidesys(captura.diretorio),
    );
  });

  it("recusa artefato alterado e módulo incompleto", () => {
    const alterada = criarCaptura([{ id: "10", modulo: "contas" }]);
    const caminho = join(alterada.diretorio, alterada.artifacts[0]!.path);
    writeFileSync(caminho, `${readFileSync(caminho, "utf8")} `);
    esperarErro("WIDESYS_CATALOGOS_TAMANHO_DIVERGENTE", () =>
      carregarPlanoCatalogosWidesys(alterada.diretorio),
    );

    const incompleta = criarCaptura([{ id: "11", modulo: "contas" }]);
    incompleta.manifesto.modules.contas!.completed = false;
    incompleta.manifesto.contentHash = widesysCatalogManifestContentHash(incompleta.manifesto);
    writeFileSync(join(incompleta.diretorio, "manifest.json"), JSON.stringify(incompleta.manifesto));
    esperarErro("WIDESYS_CATALOGOS_CAPTURA_INCOMPLETA", () =>
      carregarPlanoCatalogosWidesys(incompleta.diretorio),
    );
  });

  it("recusa fetchedAt anterior ou posterior a janela do manifesto", () => {
    const anterior = criarCaptura([
      { fetchedAt: "2026-09-16T11:59:59.999Z", id: "17", modulo: "contas" },
    ]);
    esperarErro("WIDESYS_CATALOGOS_DATA_FORA_CAPTURA", () =>
      carregarPlanoCatalogosWidesys(anterior.diretorio),
    );

    const posterior = criarCaptura([
      { fetchedAt: "2026-09-16T12:05:00.001Z", id: "18", modulo: "contas" },
    ]);
    esperarErro("WIDESYS_CATALOGOS_DATA_FORA_CAPTURA", () =>
      carregarPlanoCatalogosWidesys(posterior.diretorio),
    );
  });

  it("protege opções, módulos e origem com o hash canônico compartilhado", () => {
    const alteracoes = [
      (manifesto: ReturnType<typeof criarCaptura>["manifesto"]) => {
        manifesto.options.modules = [];
      },
      (manifesto: ReturnType<typeof criarCaptura>["manifesto"]) => {
        manifesto.modules.contas!.recordsDiscovered = 999;
      },
      (manifesto: ReturnType<typeof criarCaptura>["manifesto"]) => {
        manifesto.baseOrigin = "https://outra-origem.example";
      },
    ];
    for (const alterar of alteracoes) {
      const captura = criarCaptura([{ id: "15", modulo: "contas" }]);
      alterar(captura.manifesto);
      writeFileSync(join(captura.diretorio, "manifest.json"), JSON.stringify(captura.manifesto));
      esperarErro("WIDESYS_CATALOGOS_MANIFESTO_HASH_DIVERGENTE", () =>
        carregarPlanoCatalogosWidesys(captura.diretorio),
      );
    }
  });

  it("mantém snapshotHash estável quando mudam apenas metadados de captura", () => {
    const raw = {
      controls: [{ name: "jform[nome]", type: "text", value: "Conta estável" }],
      tables: [],
      title: "Conta estável",
    };
    const primeira = carregarPlanoCatalogosWidesys(
      criarCaptura([
        {
          fetchedAt: "2026-09-16T12:01:00.000Z",
          id: "16",
          modulo: "contas",
          raw,
          sourceUrl: `${ORIGEM}/administrator/index.php?option=com_widesys&view=conta&id=7`,
        },
      ]).diretorio,
    ).registros[0];
    const segunda = carregarPlanoCatalogosWidesys(
      criarCaptura([
        {
          fetchedAt: "2026-09-16T12:04:00.000Z",
          id: "16",
          modulo: "contas",
          raw,
          sourceUrl: `${ORIGEM}/administrator/index.php?id=7&view=conta&option=com_widesys&origem=recaptura`,
        },
      ]).diretorio,
    ).registros[0];

    expect(primeira?.snapshotHash).toBe(segunda?.snapshotHash);
    expect(primeira?.capturadoEm).not.toEqual(segunda?.capturadoEm);
    expect(primeira?.sourceUrl).not.toBe(segunda?.sourceUrl);
  });

  it("faz upsert idempotente sem promover para modelos operacionais", async () => {
    const plano = carregarPlanoCatalogosWidesys(
      criarCaptura([{ id: "12", modulo: "contas" }]).diretorio,
    );
    const registros: Array<Record<string, unknown>> = [];
    const itens: Array<Record<string, unknown>> = [];
    const capturaModel = {
      findUnique: async () => null,
      upsert: async () => ({ id: "captura-interna" }),
      update: async () => ({ id: "captura-interna" }),
    };
    const modelos = {
      catalogoLegadoCaptura: capturaModel,
      catalogoLegadoItem: {
        upsert: async ({ where, create, update }: {
          where: { capturaId_modulo_legadoId: { capturaId: string; modulo: string; legadoId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const chave = where.capturaId_modulo_legadoId;
          const existente = itens.find(
            (item) => item.capturaId === chave.capturaId && item.modulo === chave.modulo && item.legadoId === chave.legadoId,
          );
          if (existente) {
            Object.assign(existente, update);
            return existente;
          }
          const novo = { id: `item-${itens.length + 1}`, ...create };
          itens.push(novo);
          return novo;
        },
      },
      catalogoLegadoRegistro: {
        findMany: async () => registros,
        upsert: async ({ where, create, update }: {
          where: { origem_modulo_legadoId: { origem: string; modulo: string; legadoId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const chave = where.origem_modulo_legadoId;
          const existente = registros.find(
            (item) => item.origem === chave.origem && item.modulo === chave.modulo && item.legadoId === chave.legadoId,
          );
          if (existente) {
            Object.assign(existente, update);
            return existente;
          }
          const novo = { id: `registro-${registros.length + 1}`, ...create };
          registros.push(novo);
          return novo;
        },
      },
    };
    const prismaFalso = {
      ...modelos,
      $transaction: async (executar: (tx: typeof modelos) => Promise<unknown>) => executar(modelos),
    } as unknown as PrismaClient;

    const primeira = await importarPlanoCatalogosWidesys(prismaFalso, plano);
    const segunda = await importarPlanoCatalogosWidesys(prismaFalso, plano);

    expect(primeira.alteracoes).toMatchObject({ criados: 1, atualizados: 0, inalterados: 0 });
    expect(segunda.alteracoes).toMatchObject({ criados: 0, atualizados: 0, inalterados: 1 });
    expect(registros).toHaveLength(1);
    expect(itens).toHaveLength(1);
  });

  it("recusa reutilizar o mesmo captureId com outro manifesto", () => {
    expect(() => validarIdentidadeCapturaCatalogos("a".repeat(64), "a".repeat(64))).not.toThrow();
    esperarErro("WIDESYS_CATALOGOS_CAPTURE_ID_COLISAO", () =>
      validarIdentidadeCapturaCatalogos("a".repeat(64), "b".repeat(64)),
    );
  });
});
