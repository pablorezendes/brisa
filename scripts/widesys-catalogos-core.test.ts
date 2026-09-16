import { describe, expect, it } from "vitest";
import {
  CATALOG_MODULES,
  PAGE_LIMIT,
  assertCatalogDetailUrl,
  assertSafeAdminRead,
  catalogCountMatches,
  catalogListLimitParameter,
  catalogPageExplicitlyEmpty,
  catalogPageHasEvidence,
  catalogRequiresDetailFetch,
  canonicalDetailUrl,
  discoverDetailEvidence,
  discoverDetails,
  discoverPageCursors,
  extractCatalogRecord,
  listUrl,
  parseReportedTotal,
  publicUrl,
  resolveCatalogCount,
  sanitizeCatalogHtml,
  sanitizePersistedUrl,
  saoPauloCivilYear,
  type CatalogModule,
} from "./widesys-catalogos-core";

const baseUrl = new URL("https://legado.example/administrator/index.php?admin");

function module(key: string): CatalogModule {
  const found = CATALOG_MODULES.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`fixture sem modulo ${key}`);
  return found;
}

describe("whitelist dos catalogos Widesys", () => {
  it("mantem slugs e rotas unicos", () => {
    expect(new Set(CATALOG_MODULES.map((item) => item.key)).size).toBe(CATALOG_MODULES.length);
    expect(CATALOG_MODULES.length).toBeGreaterThanOrEqual(30);
    for (const item of CATALOG_MODULES) {
      const canonical = listUrl(item, baseUrl);
      expect(canonical.origin).toBe(baseUrl.origin);
      if (!item.singleton) {
        const parameter = catalogListLimitParameter(item);
        expect(canonical.searchParams.get(parameter)).toBe(String(PAGE_LIMIT));
        expect(canonical.searchParams.has(parameter === "limit" ? "list[limit]" : "limit")).toBe(false);
      }
    }
  });

  it("preserva o parametro de inicio encontrado nos links reais", () => {
    const html = `
      <a href="index.php?option=com_widesys&amp;view=contas&amp;list[start]=200">2</a>
      <a href="index.php?option=com_widesys&amp;view=contas&amp;limitstart=400">3</a>`;
    expect(discoverPageCursors(html)).toEqual([
      { offset: 200, parameter: "list[start]" },
      { offset: 400, parameter: "limitstart" },
    ]);
    const page = listUrl(module("contas"), baseUrl, 200, "list[start]");
    expect(page.searchParams.get("limit")).toBe("200");
    expect(page.searchParams.has("list[limit]")).toBe(false);
    expect(page.searchParams.get("list[start]")).toBe("200");
    expect(page.searchParams.has("limitstart")).toBe(false);
  });

  it("usa o parametro de limite aceito por cada componente Joomla", () => {
    const contas = listUrl(module("contas"), baseUrl);
    const categorias = listUrl(module("plano-contas"), baseUrl);
    expect(contas.searchParams.get("limit")).toBe("200");
    expect(contas.searchParams.has("list[limit]")).toBe(false);
    expect(categorias.searchParams.get("list[limit]")).toBe("200");
    expect(categorias.searchParams.has("limit")).toBe(false);
  });

  it("canoniza detalhes de href e onclick sem executar JavaScript", () => {
    const contas = module("contas");
    const current = listUrl(contas, baseUrl);
    const html = `
      <table><tr onclick="window.location.href = 'index.php?option=com_widesys&amp;view=conta&amp;layout=edit&amp;id=18'">
        <td>
          <a href="index.php?option=com_widesys&amp;task=conta.edit&amp;id=17&amp;return=token-ignorado">Conta</a>
          <a href="index.php?option=com_widesys&amp;view=conta&amp;layout=edit&amp;id=17">Mesma conta</a>
        </td>
      </tr></table>`;
    const details = discoverDetails(html, current, baseUrl, contas);
    expect(details.map((url) => url.searchParams.get("id"))).toEqual(["17", "18"]);
    expect(details[0]?.searchParams.has("return")).toBe(false);
    expect(details[0]?.searchParams.has("task")).toBe(false);
    expect(details[0]?.searchParams.get("view")).toBe("conta");
    for (const detail of details) {
      expect(() =>
        assertCatalogDetailUrl(detail, baseUrl, contas, detail.searchParams.get("id") || ""),
      ).not.toThrow();
    }
  });

  it("associa a identidade ao hash da evidencia visivel da linha", () => {
    const contas = module("contas");
    const current = listUrl(contas, baseUrl);
    const row = (status: string) => `
      <table><tr><td><a href="index.php?option=com_widesys&amp;view=conta&amp;layout=edit&amp;id=17">Conta 17</a></td><td>${status}</td></tr></table>`;
    const ativa = discoverDetailEvidence(row("Ativa"), current, baseUrl, contas)[0];
    const inativa = discoverDetailEvidence(row("Inativa"), current, baseUrl, contas)[0];
    expect(ativa?.url.searchParams.get("id")).toBe("17");
    expect(ativa?.evidenceHash).not.toBe(inativa?.evidenceHash);
  });

  it("materializa categoria list-only pela linha, inclusive com ID negativo", () => {
    const planoContas = module("plano-contas");
    const current = listUrl(planoContas, baseUrl);
    const html = `<table><tbody><tr>
      <td><a href="index.php?option=com_categories&amp;extension=com_widesys.planocontas&amp;task=category.edit&amp;id=-7">Despesas administrativas</a></td>
      <td>Publicado</td>
    </tr></tbody></table>`;
    const [evidence] = discoverDetailEvidence(html, current, baseUrl, planoContas);

    expect(planoContas.listOnly).toBe(true);
    expect(catalogRequiresDetailFetch(planoContas)).toBe(false);
    expect(catalogRequiresDetailFetch(module("contas"))).toBe(true);
    expect(evidence?.id).toBe("-7");
    expect(evidence?.url.searchParams.get("id")).toBe("-7");
    expect(evidence?.label).toBe("Despesas administrativas");
    const snapshot = extractCatalogRecord(evidence?.listSnapshotHtml || "");
    expect(snapshot.title).toBe("Despesas administrativas");
    expect(snapshot.tables[0]?.[0]).toEqual(["Despesas administrativas", "Publicado"]);
    expect(() =>
      assertCatalogDetailUrl(evidence!.url, baseUrl, planoContas, "-7"),
    ).not.toThrow();
  });

  it("recusa o mesmo ID em duas linhas da listagem", () => {
    const contas = module("contas");
    const current = listUrl(contas, baseUrl);
    const link =
      'index.php?option=com_widesys&amp;view=conta&amp;layout=edit&amp;id=17';
    expect(() =>
      discoverDetailEvidence(
        `<table><tr><td><a href="${link}">A</a></td></tr><tr><td><a href="${link}">B</a></td></tr></table>`,
        current,
        baseUrl,
        contas,
      ),
    ).toThrow(/repetiu o ID 17/i);
  });

  it("bloqueia outra origem, outra extensao e tasks mutaveis", () => {
    const categories = module("plano-contas");
    const current = listUrl(categories, baseUrl);
    expect(
      canonicalDetailUrl(
        "https://evil.example/administrator/index.php?option=com_categories&task=category.edit&id=2&extension=com_widesys.planocontas",
        current,
        baseUrl,
        categories,
      ),
    ).toBeNull();
    expect(
      canonicalDetailUrl(
        "index.php?option=com_categories&task=category.edit&id=2&extension=com_widesys.pessoa",
        current,
        baseUrl,
        categories,
      ),
    ).toBeNull();
    expect(() =>
      assertSafeAdminRead(
        new URL("https://legado.example/administrator/index.php?option=com_widesys&task=conta.delete&id=1"),
        baseUrl,
      ),
    ).toThrow(/bloqueada/i);
    expect(() =>
      assertSafeAdminRead(
        new URL("https://legado.example/administrator/atalho.php?option=com_widesys&view=contas"),
        baseUrl,
      ),
    ).toThrow(/index administrativo/i);
    expect(() =>
      assertCatalogDetailUrl(
        new URL("https://legado.example/administrator/index.php?option=com_widesys&task=conta.edit&id=17"),
        baseUrl,
        module("contas"),
        "17",
      ),
    ).toThrow(/checkout|lock/i);
    expect(() =>
      assertCatalogDetailUrl(
        new URL(
          "https://legado.example/administrator/index.php?option=com_widesys&view=conta&layout=edit&id=18",
        ),
        baseUrl,
        module("contas"),
        "17",
      ),
    ).toThrow(/diverge/i);
  });
});

describe("sanitizacao dos artefatos", () => {
  it("remove tokens, scripts, eventos, senhas e certificados sem apagar configuracao comum", () => {
    const unsafe = `<!doctype html><html><head><title>Conta</title>
      <script>window.csrf = "segredo"</script></head><body>
      <form action="index.php?token=abc123">
        <input type="hidden" name="0123456789abcdef0123456789abcdef" value="1">
        <input name="agencia" value="3299">
        <input name="client_secret" value="nao-pode-vazar">
        <input name="senha_certificado" value="nao-pode-vazar-2">
        <input type="file" name="certificado" value="sicoob.pfx">
        <textarea name="arquivo">-----BEGIN CERTIFICATE-----ABC123-----END CERTIFICATE-----</textarea>
        <div data-config="{&quot;client_secret&quot;:&quot;SUPERSECRET&quot;,&quot;tema&quot;:&quot;claro&quot;}"></div>
        <div>access_token=ACCESS_TEXT refresh_token=REFRESH_TEXT</div>
        <table><tr><td>Senha certificado</td><td>SEGREDO_TABELA</td></tr></table>
        <a href="/arquivo/sicoob.pfx">baixar sicoob.pfx</a>
        <button onclick="fetch('/mutacao')">Salvar</button>
      </form></body></html>`;
    const safe = sanitizeCatalogHtml(unsafe);
    expect(safe).toContain("3299");
    expect(safe).not.toContain("nao-pode-vazar");
    expect(safe).not.toContain("segredo");
    expect(safe).not.toContain("sicoob.pfx");
    expect(safe).not.toContain("BEGIN CERTIFICATE");
    expect(safe).not.toContain("SUPERSECRET");
    expect(safe).not.toContain("data-config");
    expect(safe).not.toContain("ACCESS_TEXT");
    expect(safe).not.toContain("REFRESH_TEXT");
    expect(safe).not.toContain("SEGREDO_TABELA");
    expect(safe).not.toContain("onclick");
    expect(safe).not.toContain("0123456789abcdef0123456789abcdef");
    expect(safe).toContain("[REDACTED]");
  });

  it("extrai controles e tabelas somente do HTML ja sanitizado", () => {
    const safe = sanitizeCatalogHtml(`
      <html><head><title>Plano de contas</title></head><body>
      <input name="codigo" value="1.01">
      <select name="tipo"><option value="R" selected>Receita</option></select>
      <table><tr><th>Codigo</th><th>Nome</th></tr><tr><td>1.01</td><td>Aluguel</td></tr></table>
      </body></html>`);
    const record = extractCatalogRecord(safe);
    expect(record.title).toBe("Plano de contas");
    expect(record.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "codigo", value: "1.01" }),
        expect.objectContaining({ name: "tipo", type: "select", value: "R" }),
      ]),
    );
    expect(record.tables[0]?.[1]).toEqual(["1.01", "Aluguel"]);
  });

  it("nao leva href, onclick ou data-querystring crus para o JSON de lista", () => {
    const csrf = "abcdef0123456789abcdef0123456789";
    const safe = sanitizeCatalogHtml(`
      <table><tr onclick="location.href='index.php?option=com_widesys&${csrf}=1'">
        <td data-querystring="token=nao-vaza">
          <a href="index.php?option=com_widesys&amp;view=conta&amp;id=7&amp;token=nao-vaza">Conta</a>
        </td>
      </tr></table>`);
    expect(safe).not.toContain("nao-vaza");
    expect(safe).not.toContain(csrf);
    const persisted = JSON.stringify(extractCatalogRecord(safe));
    expect(persisted).not.toContain("nao-vaza");
    expect(persisted).not.toContain(csrf);
    expect(persisted).not.toContain("onclick");
    expect(persisted).not.toContain("data-querystring");
  });

  it("remove parametros secretos de URLs publicadas no manifesto", () => {
    const url = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=contas&token=abc&senha=123&access_token=xyz&0123456789abcdef0123456789abcdef=1#fragmento",
    );
    expect(publicUrl(url)).toBe(
      "https://legado.example/administrator/index.php?option=com_widesys&view=contas",
    );
  });

  it("remove CSRF Joomla e segredos de URLs absolutas, relativas e sem aspas", () => {
    const csrf = "abcdef0123456789abcdef0123456789";
    expect(
      sanitizePersistedUrl(
        `index.php?option=com_widesys&amp;view=conta&amp;id=18&amp;${csrf}=1&amp;refresh_token=nao-vaza`,
      ),
    ).toBe("index.php?option=com_widesys&view=conta&id=18");

    const safe = sanitizeCatalogHtml(`
      <form action="index.php?option=com_widesys&amp;${csrf}=1&amp;csrf_token=nao-vaza">
        <a href='/administrator/index.php?option=com_widesys&amp;id=18&amp;${csrf}=1'>conta</a>
        <img src=https://legado.example/imagem.png?cache=1&api_key=nao-vaza>
      </form>`);
    expect(safe).not.toContain(csrf);
    expect(safe).not.toContain("nao-vaza");
    expect(safe).toContain("option=com_widesys");
    expect(safe).toContain("id=18");
    expect(safe).toContain("cache=1");
  });
});

describe("contagens sinteticas", () => {
  it("interpreta o total exibido pela lista Joomla", () => {
    expect(parseReportedTotal("<div>51 resultados</div>")).toBe(51);
    expect(parseReportedTotal("<div>Total: 1.234</div>")).toBe(1234);
    expect(parseReportedTotal("<div>sem contagem</div>")).toBeNull();
  });

  it("exige igualdade quando o legado informa a contagem", () => {
    expect(catalogCountMatches(51, 51)).toBe(true);
    expect(catalogCountMatches(51, 50)).toBe(false);
    expect(catalogCountMatches(51, 52)).toBe(false);
    expect(catalogCountMatches(null, 52)).toBe(false);
    expect(catalogCountMatches(null, 0, false, true)).toBe(true);
    expect(catalogCountMatches(1, 0, true)).toBe(true);
  });

  it("infere total exato somente por pagina terminal menor que o limite", () => {
    expect(
      resolveCatalogCount([
        {
          discovered: 7,
          explicitlyEmpty: false,
          nextOffsets: [],
          offset: 0,
          reportedTotal: null,
        },
      ]),
    ).toEqual({ explicitlyEmpty: false, source: "terminal-page", total: 7 });
    expect(
      resolveCatalogCount([
        {
          discovered: 0,
          explicitlyEmpty: true,
          nextOffsets: [],
          offset: 0,
          reportedTotal: null,
        },
      ]),
    ).toEqual({ explicitlyEmpty: true, source: "explicit-empty", total: 0 });
    expect(() =>
      resolveCatalogCount([
        {
          discovered: PAGE_LIMIT,
          explicitlyEmpty: false,
          nextOffsets: [],
          offset: 0,
          reportedTotal: null,
        },
      ]),
    ).toThrow(/ultima pagina/i);
  });

  it("recusa lacunas, offsets repetidos e vazio sem evidencia", () => {
    expect(() =>
      resolveCatalogCount([
        { discovered: 1, explicitlyEmpty: false, nextOffsets: [], offset: 0, reportedTotal: null },
        { discovered: 1, explicitlyEmpty: false, nextOffsets: [], offset: 0, reportedTotal: null },
      ]),
    ).toThrow(/repetiu/i);
    expect(() =>
      resolveCatalogCount([
        { discovered: 0, explicitlyEmpty: false, nextOffsets: [], offset: 0, reportedTotal: null },
      ]),
    ).toThrow(/vazio sem evidencia/i);
    expect(() =>
      resolveCatalogCount([
        { discovered: 0, explicitlyEmpty: false, nextOffsets: [], offset: 200, reportedTotal: null },
      ]),
    ).toThrow(/offset zero/i);
  });

  it("nao aceita HTML vazio ou generico como catalogo concluido", () => {
    expect(catalogPageHasEvidence("<html><body>Dashboard</body></html>", 0, null)).toBe(false);
    expect(catalogPageHasEvidence("<form><table></table><p>Nenhum resultado</p></form>", 0, null)).toBe(true);
    expect(catalogPageHasEvidence("<form><table><tr><td>Conta</td></tr></table></form>", 1, null)).toBe(true);
    expect(catalogPageHasEvidence("<html><title>IRRF</title><body>sem dados</body></html>", 0, null, true)).toBe(false);
    expect(
      catalogPageHasEvidence(
        "<html><title>IRRF</title><body><form><input name='aliquota' value='15'></form></body></html>",
        0,
        null,
        true,
      ),
    ).toBe(true);
  });

  it("reconhece a mensagem vazia oficial do com_categories", () => {
    expect(
      catalogPageExplicitlyEmpty(
        "<main><h1>Locação: Categorias</h1><p>Atualmente, não há categorias para essa extensão.</p></main>",
      ),
    ).toBe(true);
  });

  it("trata calendário como singleton e usa a tarefa real de país", () => {
    expect(module("calendarios").singleton).toBe(true);
    expect(module("paises").detailTasks).toContain("paise.edit");
  });

  it("usa o ano civil de Sao Paulo na virada UTC", () => {
    expect(saoPauloCivilYear(new Date("2026-01-01T01:30:00.000Z"))).toBe(2025);
    expect(saoPauloCivilYear(new Date("2026-01-01T03:30:00.000Z"))).toBe(2026);
  });
});
