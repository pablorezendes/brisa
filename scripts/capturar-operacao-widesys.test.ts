import { describe, expect, it } from "vitest";
import {
  buildListUrl,
  canonicalOperationalDetailUrl,
  assertCanonicalOperationalDetailUrl,
  assertEquivalentOperationalUrl,
  assertListUrl,
  assertLoginRoute,
  assertParcelaInfoUrl,
  buildCapturedRecord,
  businessDateIso,
  capturedRecordMatchesEvidence,
  contractParties,
  extractLegacyListRows,
  flattenedFields,
  mergeOperationalCheckpointArtifacts,
  nextOperationalPageOffset,
  operationalRecordCheckpointHash,
  operationalRecordCheckpointIsValid,
  operationalManifestIsResumable,
  operationalReferencesForRow,
  paymentRows,
  parseArgs,
  parcelaInfoUrlsForRow,
  persistableListRows,
  publicUrl,
  requireReportedTotal,
  sanitizeManifestErrorMessage,
  shardScopeRecords,
  verifyGlobalOperationalTotal,
  verifiedOperationalTotal,
} from "./capturar-operacao-widesys";
import { extractRecord } from "./widesys-parser";

describe("captura operacional Widesys", () => {
  it("exige que a contagem global independente feche com as janelas", () => {
    expect(verifyGlobalOperationalTotal(1_153, 1_153)).toBe(true);
    expect(verifyGlobalOperationalTotal(1_152, 1_153)).toBe(false);
    expect(verifyGlobalOperationalTotal(0, null)).toBe(false);
  });

  it("divide escopos grandes em partes limitadas e representa escopo vazio", () => {
    expect(shardScopeRecords([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(shardScopeRecords([], 2)).toEqual([[]]);
    expect(() => shardScopeRecords([1], 0)).toThrow(/shard/i);
  });

  it("assina checkpoints incrementais e detecta artefato adulterado antes do resume", () => {
    const unsigned = {
      artifacts: [
        {
          bytes: 18,
          kind: "detail-html",
          module: "contas-receber",
          path: "contas-receber/records/77-a1b2c3d4e5.html",
          sha256: "a".repeat(64),
          sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php?id=77",
          window: "2026-09",
        },
        {
          bytes: 42,
          kind: "detail-json",
          module: "contas-receber",
          path: "contas-receber/records/77.json",
          sha256: "b".repeat(64),
          sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php?id=77",
          window: "2026-09",
        },
      ],
      captureId: "2026-09-16T14-30-00-000Z",
      evidence: {
        legacyId: "77",
        rowContentHash: "c".repeat(64),
        sourceWindow: "2026-09",
        targets: [
          {
            sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php?id=77",
            transport: "ajax.getParcelaInfo",
          },
        ],
      },
      legacyId: "77",
      module: "contas-receber",
      version: 1,
    };
    const checkpoint = { ...unsigned, contentHash: operationalRecordCheckpointHash(unsigned) };

    expect(operationalRecordCheckpointIsValid(checkpoint)).toBe(true);
    expect(
      operationalRecordCheckpointIsValid({
        ...checkpoint,
        captureId: "2026-09-16T15-00-00-000Z",
      }),
    ).toBe(false);
    expect(
      operationalRecordCheckpointIsValid({
        ...checkpoint,
        artifacts: checkpoint.artifacts.map((artifact, index) =>
          index === 0 ? { ...artifact, bytes: artifact.bytes + 1 } : artifact,
        ),
      }),
    ).toBe(false);
  });

  it("consolida checkpoints no manifesto sem manter artefatos antigos nem apagar listagens", () => {
    type ArtifactFixture = Parameters<typeof mergeOperationalCheckpointArtifacts>[0][number];
    const fixture = (path: string, module: ArtifactFixture["module"], kind: ArtifactFixture["kind"]): ArtifactFixture => ({
      bytes: 1,
      kind,
      module,
      path,
      sha256: "d".repeat(64),
      sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php",
      window: kind.startsWith("list") ? "2026-09" : "scope",
    });
    const generated = [
      fixture("contas-receber/records/77.json", "contas-receber", "detail-json"),
      fixture("scopes/contas_receber-part-00001.json", "contas-receber", "detail-json"),
    ];
    const merged = mergeOperationalCheckpointArtifacts(
      [
        fixture("contas-receber/windows/2026-09/page-00001.json", "contas-receber", "list-json"),
        fixture("contas-receber/records/antigo.json", "contas-receber", "detail-json"),
        fixture("scopes/contas_receber-part-00009.json", "contas-receber", "detail-json"),
        fixture("contratos/records/1.json", "contratos", "detail-json"),
      ],
      "contas-receber",
      "contas_receber",
      generated,
    );

    expect(merged.map((artifact) => artifact.path)).toEqual([
      "contas-receber/windows/2026-09/page-00001.json",
      "contratos/records/1.json",
      "contas-receber/records/77.json",
      "scopes/contas_receber-part-00001.json",
    ]);
    expect(() =>
      mergeOperationalCheckpointArtifacts(merged, "contas-receber", "contas_receber", [
        fixture("contratos/records/1.json", "contas-receber", "detail-json"),
      ]),
    ).toThrow(/duplicado/i);
  });

  it("restringe URL inicial e redirects de login ao index/dashboard conhecidos", () => {
    expect(() =>
      parseArgs([
        "--dry-run",
        "--base-url=https://brisaazul.app2.widesys.com.br/administrator/qualquer.php?admin",
      ]),
    ).toThrow(/index\.php/i);
    expect(() =>
      parseArgs([
        "--dry-run",
        "--base-url=https://brisaazul.app2.widesys.com.br/administrator/index.php?option=com_widesys&view=locacao",
      ]),
    ).toThrow(/parâmetro/i);
    const base = new URL(
      "https://brisaazul.app2.widesys.com.br/administrator/index.php?admin",
    );
    expect(() =>
      assertLoginRoute(
        new URL(
          "https://brisaazul.app2.widesys.com.br/administrator/index.php?option=com_widesys&view=locacao",
        ),
        base,
        "GET",
      ),
    ).toThrow(/view/i);
    expect(() =>
      assertLoginRoute(
        new URL("https://brisaazul.app2.widesys.com.br/administrator/index.php?admin"),
        base,
        "GET",
      ),
    ).not.toThrow();
  });

  it("rejeita parâmetros duplicados em login, lista, detalhe e AJAX", () => {
    const base = new URL("https://legado.example/administrator/index.php?admin");
    const login = new URL(
      "https://legado.example/administrator/index.php?option=com_login&option=com_widesys&task=login",
    );
    expect(() => assertLoginRoute(login, base, "POST")).toThrow(/duplicado/i);

    const list = buildListUrl(
      base,
      "contas-receber",
      { end: "30-09-2026", key: "2026-09", start: "01-09-2026" },
      0,
    );
    list.searchParams.append("limit", "1");
    expect(() => assertListUrl(list, base, "contas-receber")).toThrow(/duplicado/i);

    const detail = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=locacao&layout=edit&id=63&id=999",
    );
    expect(() => assertCanonicalOperationalDetailUrl(detail, base, "contratos", "63")).toThrow(
      /duplicado/i,
    );

    const ajax = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=ajax&format=raw&task=ajax.getParcelaInfo&task=ajax.getDetalhesRecebimento&parcela_id=321",
    );
    expect(() =>
      assertParcelaInfoUrl(ajax, base, "contas-receber", "321", {
        contaReceberId: "88",
        numeroParcela: "2",
        parcelaId: "321",
      }),
    ).toThrow(/duplicado/i);
  });

  it("aceita query reordenada, mas rejeita qualquer alteração na URL operacional solicitada", () => {
    const base = new URL("https://legado.example/administrator/index.php?admin");
    const expected = buildListUrl(
      base,
      "contas-receber",
      { end: "30-09-2026", key: "2026-09", start: "01-09-2026" },
      200,
    );
    const reordered = new URL(expected.origin + expected.pathname);
    for (const [key, value] of [...expected.searchParams.entries()].reverse()) {
      reordered.searchParams.append(key, value);
    }
    expect(() => assertEquivalentOperationalUrl(reordered, expected)).not.toThrow();

    for (const [key, value] of [
      ["limitstart", "999999"],
      ["filter[planoparcelas.situacao]", "PENDENTE"],
      ["filter[planoparcelas.data_vencimento_startreport]", "30-09-2026"],
      ["filter[planoparcelas.data_vencimento_endreport]", "01-09-2026"],
    ] as const) {
      const changed = new URL(expected);
      changed.searchParams.set(key, value);
      expect(() => assertEquivalentOperationalUrl(changed, expected)).toThrow(/alterou/i);
    }
    const extra = new URL(expected);
    extra.searchParams.set("return", "segredo");
    expect(() => assertEquivalentOperationalUrl(extra, expected)).toThrow(/alterou/i);
  });

  it("não aceita listagem sem total verificável e não persiste candidatos crus", () => {
    expect(() => requireReportedTotal(null)).toThrow(/contagem total/i);
    expect(requireReportedTotal(0)).toBe(0);
    const rows = extractLegacyListRows(`
      <table><tr><td><input name="cid[]" value="7"></td>
      <td data-querystring="view=ajax&amp;token=SEGREDO&amp;parcela_id=7">Registro</td></tr></table>`);
    const persisted = JSON.stringify(persistableListRows(rows));
    expect(persisted).not.toContain("SEGREDO");
    expect(persisted).not.toContain("navigationCandidates");
    expect(persisted).not.toContain("parcelaInfoCandidates");
  });

  it("aceita zero apenas quando a própria grade operacional prova que está vazia", () => {
    const gradeVazia = `
      <form><select id="list_limit"><option value="200" selected>200</option></select>
      <table><thead><tr><th>Documento</th></tr></thead><tbody></tbody></table></form>`;
    expect(verifiedOperationalTotal(gradeVazia, [])).toBe(0);
    expect(() => verifiedOperationalTotal("<html><body>Dashboard</body></html>", [])).toThrow(
      /contagem total/i,
    );
  });

  it("permite resume apenas para uma captura realmente interrompida", () => {
    const now = new Date("2026-09-16T15:00:00.000Z");
    expect(
      operationalManifestIsResumable(
        {
          businessDate: "2026-09-16",
          capturedAt: null,
          complete: false,
          completedAt: null,
          startedAt: "2026-09-16T14:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);
    expect(
      operationalManifestIsResumable(
        {
          businessDate: "2026-09-16",
          capturedAt: "2026-09-16T12:00:00.000Z",
          complete: true,
          completedAt: "2026-09-16T12:00:00.000Z",
          startedAt: "2026-09-16T11:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      operationalManifestIsResumable(
        {
          businessDate: "2026-09-16",
          capturedAt: null,
          complete: false,
          completedAt: "2026-09-16T12:00:00.000Z",
          startedAt: "2026-09-16T11:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      operationalManifestIsResumable(
        {
          businessDate: "2026-09-15",
          capturedAt: null,
          complete: false,
          completedAt: null,
          startedAt: "2026-09-15T14:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("nao persiste URL, credenciais, tokens, cookies ou certificados em erros", () => {
    const safe = sanitizeManifestErrorMessage(
      new Error(
        "Falha GET https://usuario_demo:senha_demo@legado.example/rota?client_secret=SUPERSECRET " +
          "Authorization: Bearer TOKEN_BRUTO\nCookie: session=COOKIE_BRUTO " +
          "senha=MINHA_SENHA certificado=C:/segredos/cliente.pfx " +
          "detalhe /administrator/index.php?token=OUTRO_TOKEN " +
          "config {&quot;client_secret&quot;:&quot;JSON_SECRET&quot;}",
      ),
    );

    for (const secret of [
      "https://",
      "usuario_demo",
      "senha_demo",
      "SUPERSECRET",
      "TOKEN_BRUTO",
      "COOKIE_BRUTO",
      "MINHA_SENHA",
      "cliente.pfx",
      "/administrator/",
      "OUTRO_TOKEN",
      "JSON_SECRET",
    ]) {
      expect(safe).not.toContain(secret);
    }
    expect(safe).toContain("[URL REDACTED]");
    expect(safe).toContain("[REDACTED]");
  });

  it("remove access e refresh tokens da URL publica do manifesto", () => {
    expect(
      publicUrl(
        new URL(
          "https://usuario_demo:senha_demo@legado.example/administrator/index.php?option=com_widesys&access_token=ACCESSLEAK&refresh_token=REFRESHLEAK&id=7#privado",
        ),
      ),
    ).toBe("https://legado.example/administrator/index.php?option=com_widesys&id=7");
  });

  it("usa a data civil de São Paulo mesmo quando o processo roda em UTC", () => {
    expect(businessDateIso(new Date("2026-09-17T00:59:00.000Z"))).toBe("2026-09-16");
    expect(businessDateIso(new Date("2026-09-17T03:01:00.000Z"))).toBe("2026-09-17");
    expect(businessDateIso(new Date("2026-10-01T00:01:00.000Z"))).toBe("2026-09-30");
  });

  it("aceita a última página exatamente no limite e bloqueia somente continuação excedente", () => {
    expect(nextOperationalPageOffset(0, 51, 51, 1, 1)).toBeNull();
    expect(nextOperationalPageOffset(0, null, 51, 1, 1)).toBeNull();
    expect(() => nextOperationalPageOffset(0, 201, 200, 1, 1)).toThrow(/max-pages/i);
    expect(nextOperationalPageOffset(0, 201, 200, 1, 2)).toBe(200);
  });

  it("força todos os status financeiros usando o nome real do filtro Joomla", () => {
    const url = buildListUrl(
      new URL("https://legado.example/administrator/index.php?admin"),
      "contas-receber",
      { end: "30-09-2026", key: "2026-09", start: "01-09-2026" },
      0,
    );

    expect(url.searchParams.has("filter[planoparcelas.situacao]")).toBe(true);
    expect(url.searchParams.get("filter[planoparcelas.situacao]")).toBe("");
    expect(url.searchParams.has("situacao")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("200");
    expect(url.searchParams.get("limitstart")).toBe("0");
    expect(url.searchParams.has("list[limit]")).toBe(false);
    expect(() =>
      assertListUrl(
        url,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contas-receber",
      ),
    ).not.toThrow();
    const unsupportedJoomlaLimit = new URL(url);
    unsupportedJoomlaLimit.searchParams.set("list[limit]", "200");
    expect(() =>
      assertListUrl(
        unsupportedJoomlaLimit,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contas-receber",
      ),
    ).toThrow(/não autorizado/i);
    expect(url.searchParams.get("filter[planoparcelas.data_vencimento_startreport]")).toBe(
      "01-09-2026",
    );
    expect(url.searchParams.get("filter[planoparcelas.data_vencimento_endreport]")).toBe(
      "30-09-2026",
    );
    expect(url.searchParams.has("planoparcelas.data_vencimento_startreport")).toBe(false);
  });

  it("zera explicitamente a paginação ao trocar de janela mensal", () => {
    const base = new URL("https://legado.example/administrator/index.php?admin");
    const julho = { end: "31-07-2026", key: "2026-07", start: "01-07-2026" };
    const agosto = { end: "31-08-2026", key: "2026-08", start: "01-08-2026" };

    expect(buildListUrl(base, "movimentacoes", julho, 200).searchParams.get("limitstart")).toBe("200");
    expect(buildListUrl(base, "movimentacoes", agosto, 0).searchParams.get("limitstart")).toBe("0");

    const semReset = buildListUrl(base, "movimentacoes", agosto, 0);
    semReset.searchParams.delete("limitstart");
    expect(() => assertListUrl(semReset, base, "movimentacoes")).toThrow(/offset/i);
  });

  it("preserva o ID, colunas e todos os endpoints auxiliares da parcela", () => {
    const html = `
      <table><tbody><tr>
        <td><input name="cid[]" value="321"></td>
        <td><input type="hidden" name="parcela_id" value="321"></td>
        <td><input type="hidden" name="conta_receber_id" value="88"></td>
        <td><input type="hidden" name="numero_parcela" value="2"></td>
        <td>* pgto parcial</td><td>715,68</td><td>650,00</td>
        <td><span data-tipped="index.php?option=com_widesys"
          data-querystring="view=ajax&amp;format=raw&amp;task=ajax.getParcelaInfo&amp;parcela_id=321"></span></td>
        <td><span data-tipped="index.php?option=com_widesys"
          data-querystring="view=ajax&amp;format=raw&amp;task=ajax.getDetalhesRecebimento&amp;conta_receber_id=88&amp;numero_parcela=2"></span></td>
      </tr></tbody></table>`;

    const rows = extractLegacyListRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      legacyId: "321",
      parcelaIdentity: {
        contaReceberId: "88",
        numeroParcela: "2",
        parcelaId: "321",
      },
      parcelaInfoCandidates: [
        expect.objectContaining({ query: expect.stringContaining("ajax.getParcelaInfo") }),
        expect.objectContaining({ query: expect.stringContaining("ajax.getDetalhesRecebimento") }),
      ],
    });
    expect(rows[0].cells).toContain("* pgto parcial");
    expect(rows[0].cells).toContain("715,68");
    expect(rows[0].cells).toContain("650,00");
    expect(rows[0].contentHash).toMatch(/^[a-f\d]{64}$/);
    expect(
      parcelaInfoUrlsForRow(
        rows[0],
        new URL("https://legado.example/administrator/index.php?option=com_widesys&view=financontasrecebers"),
        new URL("https://legado.example/administrator/index.php?admin"),
        "contas-receber",
      ).map((target) => target.transport),
    ).toEqual(["ajax.getParcelaInfo", "ajax.getDetalhesRecebimento"]);
  });

  it("rejeita endpoint auxiliar cuja conta ou parcela não pertence à linha", () => {
    const html = (accountId: string, number: string, duplicateHidden = false) => `
      <table><tbody><tr>
        <td><input name="cid[]" value="321"></td>
        <td><input type="hidden" name="parcela_id" value="321"></td>
        <td><input type="hidden" name="conta_receber_id" value="88"></td>
        ${duplicateHidden ? '<td><input type="hidden" name="conta_receber_id" value="89"></td>' : ""}
        <td><input type="hidden" name="numero_parcela" value="2"></td>
        <td><span data-tipped="index.php?option=com_widesys"
          data-querystring="view=ajax&amp;format=raw&amp;task=ajax.getParcelaInfo&amp;parcela_id=321"></span></td>
        <td><span data-tipped="index.php?option=com_widesys"
          data-querystring="view=ajax&amp;format=raw&amp;task=ajax.getDetalhesRecebimento&amp;conta_receber_id=${accountId}&amp;numero_parcela=${number}"></span></td>
      </tr></tbody></table>`;
    const current = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=financontasrecebers",
    );
    const base = new URL("https://legado.example/administrator/index.php?admin");

    expect(() => parcelaInfoUrlsForRow(extractLegacyListRows(html("89", "2"))[0], current, base, "contas-receber"))
      .toThrow(/conta_receber_id/i);
    expect(() => parcelaInfoUrlsForRow(extractLegacyListRows(html("88", "3"))[0], current, base, "contas-receber"))
      .toThrow(/numero_parcela/i);
    expect(() => parcelaInfoUrlsForRow(extractLegacyListRows(html("88", "2", true))[0], current, base, "contas-receber"))
      .toThrow(/identidade canônica/i);

    const pagar = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=ajax&format=raw&task=ajax.getDetalhesPagamento&conta_pagar_id=227&numero_parcela=1",
    );
    expect(() =>
      assertParcelaInfoUrl(pagar, base, "contas-pagar", "3983", {
        contaPagarId: "227",
        numeroParcela: "1",
        parcelaId: "3983",
      }),
    ).not.toThrow();
    pagar.searchParams.set("conta_pagar_id", "228");
    expect(() =>
      assertParcelaInfoUrl(pagar, base, "contas-pagar", "3983", {
        contaPagarId: "227",
        numeroParcela: "1",
        parcelaId: "3983",
      }),
    ).toThrow(/conta_pagar_id/i);
  });

  it("preserva referências tipadas allowlisted das linhas de AR e AP", () => {
    const current = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=financontasrecebers",
    );
    const base = new URL("https://legado.example/administrator/index.php?admin");
    const [receber] = extractLegacyListRows(`
      <table><tr>
        <td><input name="cid[]" value="321"></td>
        <td><a href="index.php?option=com_widesys&amp;view=locacao&amp;task=locacao.edit&amp;id=63">Locação</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=inquilino.edit&amp;id=302&amp;jatoggler_noupd=1">Inquilino</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=outro.edit&amp;id=901">Outro</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=inquilino.edit&amp;id=303&amp;jatoggler_noupd=0">Toggler inválido</a></td>
        <td><a href="index.php?option=com_widesys&amp;view=locacao&amp;task=locacao.edit&amp;id=64&amp;jatoggler_noupd=1">Toggler em locação</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=financontasreceber.edit&amp;id=321">Título</a></td>
        <td><a href="index.php?option=com_widesys&amp;view=financontaspagars&amp;id=77">Cross-view</a></td>
        <td><a href="https://evil.example/administrator/index.php?option=com_widesys&amp;task=inquilino.edit&amp;id=666">Externo</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=usuario.edit&amp;id=5">Não permitido</a></td>
      </tr></table>
    `);
    receber.references = operationalReferencesForRow(receber, current, base, "contas-receber");

    expect(receber.references).toEqual([
      { entidade: "CONTRATO", legadoId: "63", papelOrigem: "LOCACAO" },
      { entidade: "PESSOA", legadoId: "302", papelOrigem: "INQUILINO" },
      { entidade: "PESSOA", legadoId: "901", papelOrigem: "OUTRO" },
    ]);
    const persistida = JSON.stringify(persistableListRows([receber]));
    expect(persistida).toContain('"references"');
    expect(persistida).not.toContain("evil.example");
    expect(persistida).not.toContain("navigationCandidates");

    const [pagar] = extractLegacyListRows(`
      <table><tr>
        <td><input name="cid[]" value="88"></td>
        <td><a href="index.php?option=com_widesys&amp;task=proprietario.edit&amp;id=169&amp;jatoggler_noupd=1">Proprietário</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=outro.edit&amp;id=777">Outro</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=inquilino.edit&amp;id=302&amp;return=segredo">Parâmetro extra</a></td>
      </tr></table>
    `);
    expect(operationalReferencesForRow(pagar, current, base, "contas-pagar")).toEqual([
      { entidade: "PESSOA", legadoId: "169", papelOrigem: "PROPRIETARIO" },
      { entidade: "PESSOA", legadoId: "777", papelOrigem: "OUTRO" },
    ]);
  });

  it("normaliza forma, lançamento, responsável e timestamp de cada baixa", () => {
    const details = [
      {
        contentHash: "hash",
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=ajax",
        transport: "ajax.getDetalhesRecebimento",
        raw: {
          fields: [],
          tables: [
            {
              headers: [
                "Valor",
                "Data Pagamento",
                "Tipo Recebimento",
                "N° do Cheque / Cartão",
                "Conta/Pix",
                "Nº Lanç.",
              ],
              rows: [
                [
                  "R$ 913,60",
                  "08-01-2026",
                  "Cobrança Bancária",
                  "-",
                  "Paolla [BRISA AZUL]",
                  "447 Criado por: Paolla [Baixa Manual] 05-02-2026 10:44:33",
                ],
              ],
            },
          ],
          text: "",
          title: "",
        },
      },
    ] as Parameters<typeof paymentRows>[0];

    expect(paymentRows(details)).toEqual([
      expect.objectContaining({
        conta_rotulo: "Paolla [BRISA AZUL]",
        dataPagamento: "08-01-2026",
        documento: "-",
        forma: "Cobrança Bancária",
        numeroLancamento: "447",
        responsavel: "Paolla",
        status: "Baixa Manual",
        timestamp: "05-02-2026 10:44:33",
        valor: "R$ 913,60",
      }),
    ]);
  });

  it("ignora tabelas auxiliares e linhas de cabeçalho nos detalhes da baixa", () => {
    const details = [
      {
        contentHash: "hash",
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=ajax",
        transport: "ajax.getDetalhesPagamento",
        raw: {
          fields: [],
          tables: [
            { headers: ["Data", "Valor"], rows: [["08-01-2026", "913,60"]] },
            {
              headers: ["Valor", "Data Pagamento", "Nº Lanç."],
              rows: [
                ["Valor", "Data Pagamento", "Nº Lanç."],
                ["", "", ""],
                ["913,60", "08-01-2026", "447"],
              ],
            },
          ],
          text: "",
          title: "",
        },
      },
    ] as Parameters<typeof paymentRows>[0];

    expect(paymentRows(details)).toEqual([
      expect.objectContaining({ dataPagamento: "08-01-2026", numeroLancamento: "447", valor: "913,60" }),
    ]);
  });

  it("separa pessoa e vínculo em linhas jform aninhadas sem criar partes fantasmas", () => {
    const raw = extractRecord(`
      <form>
        <input name="jform[id]" type="hidden" value="63">
        <input name="jform[locacaoinquilinos][locacaoinquilinos3][id]" type="hidden" value="701">
        <select name="jform[locacaoinquilinos][locacaoinquilinos3][inquilino_id]">
          <option value="302" selected>Inquilino</option>
        </select>
        <input name="jform[locacaoinquilinos][locacaoinquilinos3][principal]" type="hidden" value="0">
        <input name="jform[locacaoinquilinos][locacaoinquilinos3][principal]" type="checkbox" value="1" checked>

        <input name="jform[locacaoproprietarios][locacaoproprietarios0][id]" type="hidden" value="50">
        <select name="jform[locacaoproprietarios][locacaoproprietarios0][proprietario_id]">
          <option value="169" selected>Proprietário</option>
        </select>
        <input name="jform[locacaoproprietarios][locacaoproprietarios0][percentual]" value="75,5">
        <input name="jform[locacaoproprietarios][locacaoproprietarios0][ordem]" value="7">
        <input name="jform[locacaoproprietarios][locacaoproprietarios0][responsavel_repasse]" type="hidden" value="0">
        <input name="jform[locacaoproprietarios][locacaoproprietarios0][responsavel_repasse]" type="checkbox" value="1">

        <!-- Um vínculo sem campo semântico de pessoa não pode virar participante. -->
        <input name="jform[locacaofiadores][locacaofiadores0][id]" type="hidden" value="88">
      </form>
    `);
    const details = [
      {
        contentHash: "hash",
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=locacao&id=63",
        transport: "locacao.edit",
        raw,
      },
    ] as Parameters<typeof contractParties>[0];

    expect(contractParties(details)).toEqual([
      {
        flags: { principal: "1" },
        ordem: 3,
        papel: "INQUILINO",
        pessoaLegadoId: "302",
        vinculoId: "701",
      },
      {
        flags: { responsavel_repasse: "0" },
        ordem: 7,
        papel: "PROPRIETARIO",
        percentual: "75,5",
        pessoaLegadoId: "169",
        vinculoId: "50",
      },
    ]);
    expect(contractParties(details).some((part) => part.pessoaLegadoId === "50")).toBe(false);
    expect(contractParties(details).some((part) => part.pessoaLegadoId === "88")).toBe(false);
    expect(contractParties(details).some((part) => part.pessoaLegadoId === "63")).toBe(false);
  });

  it("ignora opções radio não selecionadas ao extrair participantes", () => {
    const details = [
      {
        contentHash: "hash",
        sourceUrl: "https://legado.example/administrator/index.php",
        transport: "locacao.edit",
        raw: {
          fields: [
            {
              checked: false,
              name: "jform[locacaoproprietarios][locacaoproprietarios0][proprietario_id]",
              type: "radio",
              value: "169",
            },
            {
              checked: true,
              name: "jform[locacaoproprietarios][locacaoproprietarios0][proprietario_id]",
              type: "radio",
              value: "302",
            },
          ],
          tables: [],
          text: "",
          title: "",
        },
      },
    ] as Parameters<typeof contractParties>[0];

    expect(contractParties(details)).toEqual([
      expect.objectContaining({ papel: "PROPRIETARIO", pessoaLegadoId: "302" }),
    ]);
  });

  it("descobre detalhe de contrato guardado em onclick", () => {
    const html = `
      <tr onclick="window.location.href='index.php?option=com_widesys&amp;view=locacao&amp;task=locacao.edit&amp;id=63'">
        <td><input name="cid[]" value="63"></td><td>51.302.2</td>
      </tr>`;

    expect(extractLegacyListRows(html)[0].navigationCandidates).toContain(
      "index.php?option=com_widesys&view=locacao&task=locacao.edit&id=63",
    );

    const canonical = canonicalOperationalDetailUrl(
      extractLegacyListRows(html)[0].navigationCandidates[0],
      new URL("https://legado.example/administrator/index.php?option=com_widesys&view=locacaos"),
      new URL("https://legado.example/administrator/index.php?admin"),
      "contratos",
      "63",
    );
    expect(canonical?.searchParams.get("view")).toBe("locacao");
    expect(canonical?.searchParams.get("layout")).toBe("edit");
    expect(canonical?.searchParams.get("id")).toBe("63");
    expect(canonical?.searchParams.has("task")).toBe(false);
    expect(() =>
      assertCanonicalOperationalDetailUrl(
        canonical as URL,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contratos",
        "63",
      ),
    ).not.toThrow();
    expect(() =>
      assertCanonicalOperationalDetailUrl(
        new URL("https://legado.example/administrator/index.php?option=com_widesys&task=locacao.edit&id=63"),
        new URL("https://legado.example/administrator/index.php?admin"),
        "contratos",
        "63",
      ),
    ).toThrow(/task|checkout|lock/i);
    const redirectedWithExtra = new URL(canonical as URL);
    redirectedWithExtra.searchParams.set("return", "token");
    expect(() =>
      assertCanonicalOperationalDetailUrl(
        redirectedWithExtra,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contratos",
        "63",
      ),
    ).toThrow(/parâmetro/i);
    const outroPath = new URL(canonical as URL);
    outroPath.pathname = "/administrator/endpoint-mutavel";
    expect(() =>
      assertCanonicalOperationalDetailUrl(
        outroPath,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contratos",
        "63",
      ),
    ).toThrow(/path|index administrativo/i);
  });

  it("preserva select e resolve checkbox contra o hidden fallback do Joomla", () => {
    const raw = extractRecord(`
      <input type="hidden" name="jform[conciliado]" value="0">
      <input type="checkbox" name="jform[conciliado]" value="1" checked>
      <input type="hidden" name="jform[ativo]" value="0">
      <input type="checkbox" name="jform[ativo]" value="1">
      <label for="situacao">Situação</label>
      <select id="situacao" name="jform[situacao]">
        <option value="1">Pendente</option><option value="2" selected>Pago</option>
      </select>`);
    const details = [
      {
        contentHash: "hash",
        raw,
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=ajax",
        transport: "fixture",
      },
    ] as Parameters<typeof flattenedFields>[1];
    const row = {
      cells: [],
      contentHash: "hash",
      headers: [],
      legacyId: "1",
      navigationCandidates: [],
      parcelaInfoCandidates: [],
    };

    const fields = flattenedFields(row, details);
    expect(fields["jform[situacao]"]).toBe("2");
    expect(fields["jform[situacao]_rotulo"]).toBe("Pago");
    expect(JSON.stringify(fields)).not.toContain("Situação");
    expect(fields["jform[conciliado]"]).toBe("1");
    expect(fields["jform[ativo]"]).toBe("0");
  });

  it("emite baixas vazias como fonte autoritativa quando o título não possui baixa", () => {
    const row = {
      cells: ["Pendente", "R$ 100,00"],
      contentHash: "hash",
      headers: ["Situação", "Valor devido"],
      legacyId: "77",
      navigationCandidates: [],
      parcelaInfoCandidates: [],
    };
    const details = [
      {
        contentHash: "hash-detail",
        raw: { fields: [], tables: [], text: "Pendente", title: "" },
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=ajax",
        transport: "ajax.getParcelaInfo",
      },
    ] as Parameters<typeof buildCapturedRecord>[4];

    expect(buildCapturedRecord("contas-receber", "77", row, "2026-09", details).baixas).toEqual([]);
  });

  it("só reutiliza detalhe de resume quando linha, janela e endpoints continuam iguais", () => {
    const row = {
      cells: ["Pendente", "R$ 100,00"],
      contentHash: "linha-v1",
      headers: ["Situação", "Valor devido"],
      legacyId: "77",
      navigationCandidates: [],
      parcelaInfoCandidates: [],
    };
    const details = [
      {
        contentHash: "detail-v1",
        raw: { fields: [], tables: [], text: "Pendente", title: "" },
        sourceUrl:
          "https://legado.example/administrator/index.php?option=com_widesys&view=ajax&format=raw&task=ajax.getParcelaInfo&parcela_id=77",
        transport: "ajax.getParcelaInfo",
      },
    ] as Parameters<typeof buildCapturedRecord>[4];
    const captured = buildCapturedRecord("contas-receber", "77", row, "2026-09", details);
    const evidence = {
      legacyId: "77",
      rowContentHash: "linha-v1",
      sourceWindow: "2026-09",
      targets: details.map((detail) => ({
        sourceUrl: detail.sourceUrl,
        transport: detail.transport,
      })),
    };

    expect(capturedRecordMatchesEvidence(captured, evidence)).toBe(true);
    expect(
      capturedRecordMatchesEvidence(captured, { ...evidence, rowContentHash: "linha-v2" }),
    ).toBe(false);
    expect(
      capturedRecordMatchesEvidence(captured, {
        ...evidence,
        targets: [{ ...evidence.targets[0], transport: "ajax.getDetalhesRecebimento" }],
      }),
    ).toBe(false);
  });

  it("ignora linhas sem cid numérico estável", () => {
    const html = `<tr><td><input name="cid[]" value="todos"></td><td>Cabeçalho</td></tr>`;
    expect(extractLegacyListRows(html)).toEqual([]);
  });
});
