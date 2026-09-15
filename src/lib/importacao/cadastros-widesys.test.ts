import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  carregarPlanoCadastrosWidesys,
  construirPlanoCadastrosWidesys,
  ErroImportacaoCadastrosWidesys,
  importarPlanoCadastrosWidesys,
  type ArtefatosCadastrosWidesys,
  type PlanoCadastrosWidesys,
} from "./cadastros-widesys";

const temporarios: string[] = [];

afterEach(() => {
  const raizTemporaria = `${resolve(tmpdir())}${sep}`.toLowerCase();
  for (const diretorio of temporarios.splice(0)) {
    const resolvido = resolve(diretorio);
    if (
      resolvido.toLowerCase().startsWith(raizTemporaria) &&
      basename(resolvido).startsWith("brisa-widesys-")
    ) {
      rmSync(resolvido, { recursive: true, force: true });
    }
  }
});

function sha256(conteudo: string | Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

function artefatosSinteticos(): ArtefatosCadastrosWidesys {
  return {
    capturadoEm: "2026-09-15T12:00:00.000Z",
    clientesLista: {
      data: [
        {
          id: "p-1",
          attributes: {
            nome: "Cadastro Homônimo",
            tipo_cadastro: "Inquilino, Fiador",
            cpf_cnpj: "123.456.789-01",
            chave_pix: "pix-nao-persistir-no-snapshot",
          },
        },
        {
          id: "p-2",
          attributes: {
            nome: "Cadastro Homônimo",
            tipo_cadastro: "Precadastro",
          },
        },
      ],
    },
    clientesDetalhes: { respostas: [] },
    produtosListas: {
      naoPublicados: {
        data: [
          {
            id: "imovel-1",
            attributes: {
              nome: "Unidade 1",
              referencia: "REF-1",
              nome_status: "Disponível",
              finalidade: "Residencial",
              nome_estado: "Goiás",
              valor_locacao: "1.234,56",
              published: 0,
              dados_bancarios: "banco-nao-persistir-no-snapshot",
              proprietarios: [
                {
                  id: "vinculo-1",
                  pessoa_id: "p-1",
                  proprietario_id: "p-1",
                  porcentagem: "100.00",
                  conta_id: "conta-1",
                  idefault: 1,
                  ordering: 0,
                },
              ],
            },
          },
        ],
      },
      publicados: { data: [] },
    },
    produtosDetalhes: { respostas: [] },
    uiRegistros: [
      {
        fetchedAt: "2026-09-15T12:00:00.000Z",
        id: "p-1",
        module: "outros",
        sourceUrl: "https://brisaazul.app2.widesys.com.br/fornecedor/1",
        raw: {
          title: "Fornecedor",
          text: "",
          fields: [
            { name: "jform[nome_fantasia]", type: "text", value: "Nome fantasia" },
            {
              name: "jform[emails][emails0][email]",
              type: "email",
              value: "contato@example.invalid",
            },
            {
              name: "jform[telefones][telefones0][telefone]",
              type: "text",
              value: "(62) 99999-0000",
            },
            { name: "jform[password]", type: "password", value: "segredo-fixture" },
            { name: "jform[pix][chave]", type: "text", value: "pix-ui-nao-persistir" },
          ],
          tables: [],
        },
      },
    ],
  };
}

function escreverJson(caminho: string, valor: unknown): string {
  const conteudo = JSON.stringify(valor);
  writeFileSync(caminho, conteudo, "utf8");
  return conteudo;
}

function criarFixtureComManifestos(): { diretorio: string; detalheUi: string } {
  const diretorio = mkdtempSync(join(tmpdir(), "brisa-widesys-"));
  temporarios.push(diretorio);
  const capturadoEm = "2026-09-15T12:00:00.000Z";
  const arquivosApi = new Map<string, string>();
  arquivosApi.set(
    "clientes-lista.json",
    escreverJson(join(diretorio, "clientes-lista.json"), {
      data: [{ id: "1", attributes: { nome: "Pessoa fixture", tipo_cadastro: "Fornecedor" } }],
      meta: { "total-items": 1 },
    }),
  );
  arquivosApi.set(
    "clientes-detalhes.json",
    escreverJson(join(diretorio, "clientes-detalhes.json"), {
      capturadoEm,
      total: 1,
      respostas: [
        { data: { id: "1", attributes: { nome: "Pessoa fixture", tipo_cadastro: "Fornecedor" } } },
      ],
    }),
  );
  arquivosApi.set(
    "produtos-listas.json",
    escreverJson(join(diretorio, "produtos-listas.json"), {
      capturadoEm,
      naoPublicados: { data: [], meta: { "total-items": 0 } },
      publicados: { data: [], meta: { "total-items": 0 } },
    }),
  );
  arquivosApi.set(
    "produtos-detalhes.json",
    escreverJson(join(diretorio, "produtos-detalhes.json"), {
      capturadoEm,
      total: 0,
      respostas: [],
    }),
  );
  escreverJson(join(diretorio, "manifesto.json"), {
    formato: 1,
    origem: "https://brisaazul.app2.widesys.com.br",
    capturadoEm,
    autenticacaoPersistida: false,
    contagens: {
      clientes: 1,
      clientesDetalhes: 1,
      produtosNaoPublicados: 0,
      produtosPublicados: 0,
      produtosUnicos: 0,
      produtosDetalhes: 0,
    },
    arquivos: [...arquivosApi].map(([arquivo, conteudo]) => ({
      arquivo,
      bytes: Buffer.byteLength(conteudo),
      sha256: sha256(conteudo),
    })),
  });

  const pastaRegistros = join(diretorio, "outros", "records");
  mkdirSync(pastaRegistros, { recursive: true });
  const detalheUi = join(pastaRegistros, "1-fixture.json");
  const conteudoUi = escreverJson(detalheUi, {
    fetchedAt: "2026-09-15T12:00:00.000Z",
    id: "1",
    module: "outros",
    sourceUrl: "https://brisaazul.app2.widesys.com.br/fornecedor/1",
    raw: {
      title: "Fornecedor",
      text: "",
      fields: [{ name: "jform[nome_fantasia]", type: "text", value: "Fantasia" }],
      tables: [],
    },
  });
  const modulos = [
    "precadastros",
    "produtos",
    "empreendimentos",
    "proprietarios",
    "inquilinos",
    "compradors",
    "fiadors",
    "corretors",
    "outros",
  ];
  escreverJson(join(diretorio, "manifest.json"), {
    version: 1,
    baseOrigin: "https://brisaazul.app2.widesys.com.br",
    errors: [],
    modules: Object.fromEntries(
      modulos.map((module) => [
        module,
        {
          completed: true,
          recordsDiscovered: module === "outros" ? 1 : 0,
          recordsSaved: module === "outros" ? 1 : 0,
          recordsSkipped: 0,
          detailErrors: 0,
        },
      ]),
    ),
    artifacts: [
      {
        kind: "detail-json",
        module: "outros",
        path: "outros/records/1-fixture.json",
        bytes: Buffer.byteLength(conteudoUi),
        sha256: sha256(conteudoUi),
        sourceUrl: "https://brisaazul.app2.widesys.com.br/fornecedor/1",
      },
    ],
  });
  return { diretorio, detalheUi };
}

function atualizarHashNoManifesto(diretorio: string, arquivo: string, conteudo: string): void {
  const caminho = join(diretorio, "manifesto.json");
  const manifesto = JSON.parse(readFileSync(caminho, "utf8")) as {
    arquivos: Array<{ arquivo: string; bytes: number; sha256: string }>;
  };
  const entrada = manifesto.arquivos.find((item) => item.arquivo === arquivo);
  if (!entrada) throw new Error(`Arquivo ausente da fixture: ${arquivo}`);
  entrada.bytes = Buffer.byteLength(conteudo);
  entrada.sha256 = sha256(conteudo);
  escreverJson(caminho, manifesto);
}

describe("planejamento de cadastros Widesys", () => {
  it("preserva identidades legadas, classifica papéis e converte valores sem float", () => {
    const primeiro = construirPlanoCadastrosWidesys(artefatosSinteticos());
    const segundaCaptura = artefatosSinteticos();
    segundaCaptura.uiRegistros![0].fetchedAt = "2026-09-16T18:30:00.000Z";
    const segundo = construirPlanoCadastrosWidesys(segundaCaptura);

    expect(primeiro.pessoas).toHaveLength(2);
    expect(new Set(primeiro.pessoas.map((pessoa) => pessoa.legadoId)).size).toBe(2);
    const pessoa = primeiro.pessoas.find((item) => item.legadoId === "p-1")!;
    expect(pessoa.nomeFantasia).toBe("Nome fantasia");
    expect(pessoa.papeis.map((papel) => papel.papel)).toEqual([
      "FIADOR",
      "FORNECEDOR",
      "INQUILINO",
      "PROPRIETARIO",
    ]);
    expect(pessoa.emails.map((email) => email.emailNorm)).toContain(
      "contato@example.invalid",
    );
    expect(pessoa.telefones.map((telefone) => telefone.telefoneNorm)).toContain(
      "62999990000",
    );
    expect(pessoa.snapshot).not.toContain("segredo-fixture");
    expect(pessoa.snapshot).not.toContain("pix-nao-persistir-no-snapshot");
    expect(pessoa.snapshot).not.toContain("pix-ui-nao-persistir");
    expect(JSON.parse(pessoa.snapshot)).toMatchObject({ versao: 1, entidade: "PESSOA" });

    expect(primeiro.imoveis[0]).toMatchObject({
      valorLocacao: 123_456,
      uf: "GO",
      disponivel: true,
      publicado: false,
    });
    expect(primeiro.imoveis[0].proprietarios[0]).toMatchObject({
      legadoId: "vinculo-1",
      pessoaLegadoId: "p-1",
      porcentagem: "100.00",
      principal: true,
    });
    expect(primeiro.imoveis[0].snapshot).not.toContain("banco-nao-persistir-no-snapshot");
    expect(segundo.pessoas.map((item) => item.snapshotHash)).toEqual(
      primeiro.pessoas.map((item) => item.snapshotHash),
    );
    expect(segundo.imoveis.map((item) => item.snapshotHash)).toEqual(
      primeiro.imoveis.map((item) => item.snapshotHash),
    );
  });

  it("valida manifesto UI, seus hashes e sinaliza explicitamente captura ausente", () => {
    const { diretorio, detalheUi } = criarFixtureComManifestos();
    const plano = carregarPlanoCadastrosWidesys(diretorio);
    expect(plano.pessoas[0]).toMatchObject({ nomeFantasia: "Fantasia" });
    expect(plano.pessoas[0].papeis.map((papel) => papel.papel)).toContain("FORNECEDOR");
    expect(plano.avisos).not.toContainEqual({ codigo: "ui_nao_capturada", quantidade: 1 });

    const adulterado = readFileSync(detalheUi, "utf8").replace("Fantasia", "Alterada");
    writeFileSync(detalheUi, adulterado, "utf8");
    expect(() => carregarPlanoCadastrosWidesys(diretorio)).toThrowError(
      ErroImportacaoCadastrosWidesys,
    );
    try {
      carregarPlanoCadastrosWidesys(diretorio);
    } catch (erro) {
      expect((erro as ErroImportacaoCadastrosWidesys).codigo).toBe(
        "WIDESYS_UI_HASH_DIVERGENTE",
      );
    }

    unlinkSync(join(diretorio, "manifest.json"));
    const somenteApi = carregarPlanoCadastrosWidesys(diretorio);
    expect(somenteApi.avisos).toContainEqual({ codigo: "ui_nao_capturada", quantidade: 1 });
  });

  it.each([
    ["formato", 2, "WIDESYS_MANIFESTO_FORMATO_INVALIDO"],
    ["origem", "http://brisaazul.app2.widesys.com.br", "WIDESYS_MANIFESTO_ORIGEM_INVALIDA"],
    ["capturadoEm", "15/09/2026", "WIDESYS_MANIFESTO_DATA_INVALIDA"],
    ["autenticacaoPersistida", true, "WIDESYS_MANIFESTO_AUTENTICACAO_INVALIDA"],
  ])("rejeita cabeçalho de manifesto adulterado em %s", (campo, valor, codigo) => {
    const { diretorio } = criarFixtureComManifestos();
    const caminho = join(diretorio, "manifesto.json");
    const manifesto = JSON.parse(readFileSync(caminho, "utf8")) as Record<string, unknown>;
    manifesto[campo] = valor;
    escreverJson(caminho, manifesto);

    try {
      carregarPlanoCadastrosWidesys(diretorio);
      throw new Error("A fixture adulterada deveria ser rejeitada.");
    } catch (erro) {
      expect((erro as ErroImportacaoCadastrosWidesys).codigo).toBe(codigo);
    }
  });

  it("rejeita snapshot adulterado mesmo quando o tamanho permanece igual", () => {
    const { diretorio } = criarFixtureComManifestos();
    const caminho = join(diretorio, "clientes-lista.json");
    const original = readFileSync(caminho, "utf8");
    writeFileSync(caminho, original.replace("fixture", "alterad"), "utf8");

    try {
      carregarPlanoCadastrosWidesys(diretorio);
      throw new Error("O snapshot adulterado deveria ser rejeitado.");
    } catch (erro) {
      expect((erro as ErroImportacaoCadastrosWidesys).codigo).toBe(
        "WIDESYS_SNAPSHOT_HASH_DIVERGENTE",
      );
    }
  });

  it("rejeita lote semanticamente incompleto ainda que os hashes sejam coerentes", () => {
    const { diretorio } = criarFixtureComManifestos();
    const caminho = join(diretorio, "clientes-detalhes.json");
    const detalhes = JSON.parse(readFileSync(caminho, "utf8")) as {
      respostas: Array<{ data: { id: string } }>;
    };
    detalhes.respostas[0].data.id = "2";
    const conteudo = escreverJson(caminho, detalhes);
    atualizarHashNoManifesto(diretorio, "clientes-detalhes.json", conteudo);

    try {
      carregarPlanoCadastrosWidesys(diretorio);
      throw new Error("O lote incompleto deveria ser rejeitado.");
    } catch (erro) {
      expect((erro as ErroImportacaoCadastrosWidesys).codigo).toBe(
        "WIDESYS_SNAPSHOT_IDS_DIVERGENTES",
      );
    }
  });

  it.skipIf(!existsSync(join(process.cwd(), "data", "legacy-widesys", "manifesto.json")))(
    "reconstrói o snapshot real completo de 226 pessoas e 68 imóveis",
    () => {
      const plano = carregarPlanoCadastrosWidesys();
      expect(plano.pessoas).toHaveLength(226);
      expect(plano.imoveis).toHaveLength(68);
      expect(plano.imoveis.flatMap((imovel) => imovel.proprietarios)).toHaveLength(68);
      expect(plano.imoveis.every((imovel) => imovel.uf === "GO")).toBe(true);
      expect(
        plano.pessoas.filter((pessoa) =>
          pessoa.papeis.some((papel) => papel.papel === "FORNECEDOR"),
        ),
      ).toHaveLength(151);
      expect(
        plano.pessoas.some((pessoa) =>
          pessoa.papeis.some((papel) => papel.papel === "OUTRO"),
        ),
      ).toBe(false);
      expect(
        plano.imoveis.every(
          (imovel) => imovel.valorLocacao === null || Number.isSafeInteger(imovel.valorLocacao),
        ),
      ).toBe(true);
    },
  );
});

describe("aplicação idempotente", () => {
  it("classifica a segunda execução como inalterada e nunca remove ausentes", async () => {
    const base = construirPlanoCadastrosWidesys(artefatosSinteticos());
    const pessoaBase = base.pessoas.find((pessoa) => pessoa.legadoId === "p-2")!;
    const plano: PlanoCadastrosWidesys = {
      ...base,
      pessoas: [
        {
          ...pessoaBase,
          emails: [],
          telefones: [],
          papeis: pessoaBase.papeis.filter((papel) => papel.papel === "PRECADASTRO"),
        },
      ],
      imoveis: [],
    };
    const pessoas: Array<{ id: string; legadoId: string; snapshotHash: string }> = [];
    const papeis: Array<{
      id: string;
      legadoId: string;
      papel: string;
      snapshotHash: string;
    }> = [];
    const modelos = {
      pessoa: {
        findMany: async () => pessoas,
        create: async ({ data }: { data: { legadoId: string; snapshotHash: string } }) => {
          const criada = { id: `pessoa-${pessoas.length + 1}`, ...data };
          pessoas.push(criada);
          return criada;
        },
        update: async () => {
          throw new Error("Atualização inesperada no cenário idempotente.");
        },
      },
      pessoaPapel: {
        findMany: async () => papeis,
        create: async ({ data }: {
          data: { legadoId: string; papel: string; snapshotHash: string };
        }) => {
          const criado = { id: `papel-${papeis.length + 1}`, ...data };
          papeis.push(criado);
          return criado;
        },
        update: async () => {
          throw new Error("Atualização inesperada no cenário idempotente.");
        },
      },
      pessoaEmail: { findMany: async () => [] },
      pessoaTelefone: { findMany: async () => [] },
      imovelLegado: { findMany: async () => [] },
      imovelProprietarioLegado: { findMany: async () => [] },
      locatario: { findMany: async () => [] },
    };
    const prismaFalso = {
      ...modelos,
      $transaction: async (executar: (tx: typeof modelos) => Promise<unknown>) =>
        executar(modelos),
    } as unknown as PrismaClient;

    const primeira = await importarPlanoCadastrosWidesys(prismaFalso, plano);
    const segunda = await importarPlanoCadastrosWidesys(prismaFalso, plano);
    const vazia = await importarPlanoCadastrosWidesys(prismaFalso, {
      ...plano,
      pessoas: [],
    });

    expect(primeira.alteracoes?.pessoas).toEqual({ criados: 1, atualizados: 0, inalterados: 0 });
    expect(primeira.alteracoes?.papeis).toEqual({ criados: 1, atualizados: 0, inalterados: 0 });
    expect(segunda.alteracoes?.pessoas).toEqual({ criados: 0, atualizados: 0, inalterados: 1 });
    expect(segunda.alteracoes?.papeis).toEqual({ criados: 0, atualizados: 0, inalterados: 1 });
    expect(vazia.previstos.pessoas).toBe(0);
    expect(vazia.avisos).toEqual(
      expect.arrayContaining([
        { codigo: "pessoa_ausente_na_origem", quantidade: 1 },
        { codigo: "papel_ausente_na_origem", quantidade: 1 },
      ]),
    );
    expect(pessoas).toHaveLength(1);
    expect(papeis).toHaveLength(1);
  });

  it("atualiza a data de captura e resolve proprietário sem alterar os contadores semânticos", async () => {
    const base = construirPlanoCadastrosWidesys(artefatosSinteticos());
    const pessoa = base.pessoas.find((item) => item.legadoId === "p-1")!;
    const papel = pessoa.papeis.find((item) => item.papel === "PROPRIETARIO")!;
    const imovel = base.imoveis[0];
    const proprietario = imovel.proprietarios[0];
    let pessoaAtualizada: Record<string, unknown> | null = null;
    let imovelAtualizado: Record<string, unknown> | null = null;
    let vinculoAtualizado: Record<string, unknown> | null = null;
    const modelos = {
      pessoa: {
        findMany: async () => [
          {
            id: "pessoa-interna",
            legadoId: pessoa.legadoId,
            snapshotHash: pessoa.snapshotHash,
            capturadoEm: new Date("2026-09-14T12:00:00.000Z"),
          },
        ],
        update: async ({ data }: { data: Record<string, unknown> }) => {
          pessoaAtualizada = data;
          return data;
        },
      },
      pessoaPapel: {
        findMany: async () => [
          {
            id: "papel-interno",
            legadoId: pessoa.legadoId,
            papel: papel.papel,
            snapshotHash: papel.snapshotHash,
          },
        ],
      },
      pessoaEmail: { findMany: async () => [] },
      pessoaTelefone: { findMany: async () => [] },
      imovelLegado: {
        findMany: async () => [
          {
            id: "imovel-interno",
            legadoId: imovel.legadoId,
            snapshotHash: imovel.snapshotHash,
            capturadoEm: new Date("2026-09-14T12:00:00.000Z"),
          },
        ],
        update: async ({ data }: { data: Record<string, unknown> }) => {
          imovelAtualizado = data;
          return data;
        },
      },
      imovelProprietarioLegado: {
        findMany: async () => [
          {
            legadoId: proprietario.legadoId,
            snapshotHash: proprietario.snapshotHash,
            pessoaId: null,
          },
        ],
        update: async ({ data }: { data: Record<string, unknown> }) => {
          vinculoAtualizado = data;
          return data;
        },
      },
      locatario: { findMany: async () => [] },
    };
    const prismaFalso = {
      ...modelos,
      $transaction: async (executar: (tx: typeof modelos) => Promise<unknown>) =>
        executar(modelos),
    } as unknown as PrismaClient;
    const plano: PlanoCadastrosWidesys = {
      ...base,
      pessoas: [{ ...pessoa, papeis: [papel], emails: [], telefones: [] }],
      imoveis: [imovel],
    };

    const relatorio = await importarPlanoCadastrosWidesys(prismaFalso, plano);

    expect(relatorio.alteracoes?.proprietarios).toEqual({
      criados: 0,
      atualizados: 1,
      inalterados: 0,
    });
    expect(relatorio.alteracoes?.pessoas).toEqual({ criados: 0, atualizados: 0, inalterados: 1 });
    expect(relatorio.alteracoes?.imoveis).toEqual({ criados: 0, atualizados: 0, inalterados: 1 });
    expect(pessoaAtualizada).toEqual({ capturadoEm: pessoa.capturadoEm });
    expect(imovelAtualizado).toEqual({ capturadoEm: imovel.capturadoEm });
    expect(vinculoAtualizado).toMatchObject({ pessoaId: "pessoa-interna" });
  });
});
