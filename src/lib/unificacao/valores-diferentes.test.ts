import { describe, expect, it } from "vitest";
import { criarIndiceCandidatos } from "./candidatos-indice";
import { avaliarFonte, candidatosPara, projetarUnificados } from "./reconciliacao";
import { avaliarRegraValoresDiferentes, DECISAO_VALOR_DIFERENTE, MOTIVO_VALORES_DIFERENTES, valoresDevidosDiferentes } from "./valores-diferentes";
import type { DecisaoUnificacao, FonteUnificacao } from "./tipos";

function fonte(id: string, valor: number | null = 46150, extras: Partial<FonteUnificacao> = {}): FonteUnificacao {
  return {
    chave: `WIDESYS:PAGAR:${id}`, dominio: "PAGAR", origem: "WIDESYS", origemId: id,
    titulo: "Fornecedor artificial", descricao: "Manutenção", href: null, hash: `hash-${id}`,
    qualidade: "OK", motivos: [], campos: {}, nomeNorm: "FORNECEDOR ARTIFICIAL",
    competencia: "2026-01", data: "2026-01-30", pessoaChave: "WIDESYS:PESSOA:1",
    valor, pago: valor, aberto: 0, ...extras,
  };
}

function decisao(f: FonteUnificacao, extras: Partial<DecisaoUnificacao> = {}): DecisaoUnificacao {
  return {
    chave: f.chave, dominio: f.dominio, origem: f.origem, origemId: f.origemId,
    status: "PENDENTE", destinoChave: null, hashFonte: f.hash, hashDestino: null,
    candidatos: "[]", motivos: '["POSSIVEL_DUPLICIDADE"]', proveniencia: "{}",
    decisao: "AUTOMATICA", versao: 1, ...extras,
  };
}

function avaliar(f: FonteUnificacao, fontes: FonteUnificacao[], anterior?: DecisaoUnificacao, destinos = new Map<string, string>()) {
  const indice = criarIndiceCandidatos(fontes, destinos);
  return avaliarRegraValoresDiferentes({ fonte: f, fontesComparaveis: indice.para(f), candidatosAtuais: candidatosPara(f, indice.para(f), destinos), anterior, destinos });
}

describe("títulos de valores diferentes", () => {
  it.each(["PAGAR", "RECEBER"] as const)("separa os títulos de %s usando somente o total devido", dominio => {
    const a = fonte("1", 46150, { dominio, pago: 0, aberto: 46150 });
    const b = fonte("2", 19500, { dominio, pago: 0, aberto: 19500 });
    expect(candidatosPara(a, [a, b], new Map())).toEqual([]);
    expect(candidatosPara(b, [a, b], new Map())).toEqual([]);
    expect(avaliar(a, [a, b], decisao(a))).toEqual({ comparados: [{ chave: b.chave, hash: b.hash, valor: 19500 }] });
    expect(avaliar(b, [a, b])).not.toBeNull();
  });

  it("continua comparando o mesmo total mesmo que pagamentos e saldos sejam diferentes", () => {
    const a = fonte("1", 46150, { pago: 19500, aberto: 26650 });
    const b = fonte("2", 46150, { pago: 46150, aberto: 0 });
    expect(valoresDevidosDiferentes(a, b)).toBe(false);
    expect(candidatosPara(a, [b], new Map())).toHaveLength(1);
    expect(avaliar(a, [a, b])).toBeNull();
  });

  it.each([null, undefined, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("não declara diferença comprovada com total inválido %s", valor => {
    const a = fonte("1"), b = fonte("2", 0, { valor });
    expect(valoresDevidosDiferentes(a, b)).toBe(false);
    expect(candidatosPara(a, [b], new Map())).toHaveLength(1);
    expect(avaliar(a, [a, b])).toBeNull();
    expect(avaliar(b, [a, b])).toBeNull();
  });

  it("aceita centavos exatos e total zero conhecido", () => {
    for (const valor of [0, 46149, 46151]) expect(valoresDevidosDiferentes(fonte("1"), fonte("2", valor))).toBe(true);
  });

  it("não aprova automaticamente quando resta um candidato de mesmo total ou desconhecido", () => {
    const a = fonte("1"), b = fonte("2", 19500);
    for (const valor of [a.valor!, null]) {
      const c = fonte("3", valor);
      expect(avaliar(a, [a, b, c])).toBeNull();
      expect(avaliarRegraValoresDiferentes({ fonte: a, fontesComparaveis: [a, b, c], candidatosAtuais: [], destinos: new Map() })).toBeNull();
    }
  });

  it("exige vínculo de identidade e competência; nome sozinho não confere", () => {
    const a = fonte("1"), b = fonte("2", 19500);
    for (const outra of [{ ...b, pessoaChave: "OUTRA:PESSOA" }, { ...b, competencia: "2026-02" }, { ...b, qualidade: "QUARENTENA" as const }, { ...b, cancelado: true }, { ...b, informativo: true }]) {
      expect(avaliar(a, [a, outra])).toBeNull();
    }
    expect(avaliar(a, [a, { ...b, pessoaChave: "BRISA:PESSOA:2" }], undefined, new Map([["BRISA:PESSOA:2", a.pessoaChave!]]))).not.toBeNull();
  });

  it("não afeta contratos, movimentos, baixas ou cadastros", () => {
    for (const dominio of ["CONTRATO", "MOVIMENTO", "BAIXA_PAGAR", "PESSOA"] as const) {
      const a = fonte("1", 46150, { dominio }), b = fonte("2", 19500, { dominio });
      expect(valoresDevidosDiferentes(a, b)).toBe(false);
      expect(avaliar(a, [a, b])).toBeNull();
    }
  });

  it("preserva decisões humanas, vínculos e problemas fora da duplicidade", () => {
    const a = fonte("1"), b = fonte("2", 19500);
    for (const alteracao of [
      { decisao: "MANUAL", status: "ATIVO" }, { decisao: "MANUAL", status: "PENDENTE" },
      { decisao: DECISAO_VALOR_DIFERENTE, status: "ATIVO" },
      { status: "REVISAR" }, { status: "QUARENTENA" }, { status: "AUSENTE" },
      { destinoChave: b.chave }, { hashFonte: "fonte-antiga" },
      { motivos: '["PAGAMENTO_DESPESA_CONFERIR"]' }, { motivos: '["FONTE_ALTERADA_APOS_DECISAO"]' }, { motivos: "corrompido" },
    ]) expect(avaliar(a, [a, b], decisao(a, alteracao))).toBeNull();
    for (const alteracao of [
      { cancelado: true }, { informativo: true }, { qualidade: "QUARENTENA" as const },
      { vinculoExplicito: b.chave }, { motivos: ["PAGAMENTO_DESPESA_CONFERIR"] },
    ]) expect(avaliar({ ...a, ...alteracao }, [{ ...a, ...alteracao }, b])).toBeNull();
  });

  it("mantém equivalência do índice com a varredura para valores distintos, iguais e desconhecidos", () => {
    const fontes = [46150, 19500, 46150, null, 0, -1, 1.5].map((valor, i) => fonte(String(i), valor));
    const indice = criarIndiceCandidatos(fontes, new Map());
    for (const f of fontes) expect(candidatosPara(f, indice.para(f), new Map())).toEqual(candidatosPara(f, fontes, new Map()));
  });
});

describe("conferência persistida pela regra", () => {
  it("inclui os dois títulos uma vez, com selo próprio e sem alterar valores ou pagamentos", () => {
    const fontes = [fonte("1"), fonte("2", 19500)];
    const antes = structuredClone(fontes);
    const decisoes = fontes.map(f => decisao(f, { status: "ATIVO", decisao: DECISAO_VALOR_DIFERENTE, motivos: JSON.stringify([MOTIVO_VALORES_DIFERENTES]) }));
    const linhas = projetarUnificados(fontes, decisoes);
    expect(linhas.every(l => l.contabiliza && l.conferidoPorRegra && !l.conferidoManualmente)).toBe(true);
    expect(linhas.reduce((total, l) => total + l.valor!, 0)).toBe(65650);
    expect(linhas.reduce((total, l) => total + l.pago!, 0)).toBe(65650);
    expect(fontes).toEqual(antes);
    const mapa = new Map(fontes.map(f => [f.chave, f]));
    for (const [i, f] of fontes.entries()) expect(avaliarFonte(f, [], mapa, decisoes[i])).toMatchObject({ status: "ATIVO", destinoChave: null, motivos: [MOTIVO_VALORES_DIFERENTES] });
  });

  it("retira sugestões históricas falsas sem inventar decisão conferida", () => {
    const a = fonte("1"), b = fonte("2", 19500);
    const anterior = decisao(a, { candidatos: JSON.stringify([{ chave: b.chave, motivos: ["MES_E_VINCULO"] }]) });
    expect(projetarUnificados([a, b], [anterior])[0]).toMatchObject({ estado: "PENDENTE", candidatos: [], contabiliza: false, conferidoPorRegra: false });
  });

  it("reabre fonte alterada sem converter a conferência em decisão manual", () => {
    const a = fonte("1"), d = decisao(a, { status: "ATIVO", decisao: DECISAO_VALOR_DIFERENTE });
    const alterada = { ...a, hash: "fonte-alterada", valor: 19500 };
    expect(avaliarFonte(alterada, [], new Map([[a.chave, alterada]]), d)).toMatchObject({ status: "REVISAR", motivos: ["FONTE_ALTERADA_APOS_DECISAO"] });
    expect(projetarUnificados([alterada], [d])[0]).toMatchObject({ estado: "REVISAR", conferidoPorRegra: false, conferidoManualmente: false, contabiliza: false });
    for (const alteracao of [{ cancelado: true }, { informativo: true }, { qualidade: "AUSENTE" as const }]) {
      expect(projetarUnificados([{ ...a, ...alteracao }], [d])[0]).toMatchObject({ conferidoPorRegra: false, contabiliza: false });
    }
  });

  it("não desfaz uma união manual de títulos com valores diferentes", () => {
    const a = fonte("1"), b = fonte("2", 19500);
    const d = decisao(a, { status: "VINCULADO", decisao: "MANUAL", destinoChave: b.chave, hashDestino: b.hash });
    const resultado = avaliarFonte(a, [], new Map([[a.chave, a], [b.chave, b]]), d);
    expect(resultado).toMatchObject({ status: "VINCULADO", destinoChave: b.chave });
  });

  it("reabre a regra quando somente o outro título muda para o mesmo valor", () => {
    const a = fonte("1"), b = fonte("2", 19500);
    const da = decisao(a, { status: "ATIVO", decisao: DECISAO_VALOR_DIFERENTE });
    const db = decisao(b, { status: "ATIVO", decisao: DECISAO_VALOR_DIFERENTE });
    const alterada = { ...b, hash: "outro-titulo-alterado", valor: a.valor };
    const fontes = [a, alterada], mapa = new Map(fontes.map(f => [f.chave, f]));
    const anteriores = new Map([[a.chave, da], [b.chave, db]]);
    expect(avaliarFonte(a, candidatosPara(a, fontes, new Map()), mapa, da, anteriores)).toMatchObject({
      status: "REVISAR", motivos: ["CORRESPONDENCIA_APOS_REGRA_VALOR_DIFERENTE"],
    });
    const linhas = projetarUnificados(fontes, [da, db]);
    expect(linhas[0]).toMatchObject({ hash: a.hash, estado: "REVISAR", conferidoPorRegra: false, contabiliza: false });
    expect(linhas[0].candidatos.map(c => c.chave)).toEqual([b.chave]);
    expect(linhas[0].avisos).toContain("CORRESPONDENCIA_APOS_REGRA_VALOR_DIFERENTE");
    expect(linhas[1]).toMatchObject({ estado: "REVISAR", conferidoPorRegra: false, contabiliza: false });
    expect(projetarUnificados(fontes, [{ ...da, decisao: "MANUAL" }, db])[0]).toMatchObject({ estado: "ATIVO", conferidoManualmente: true });
  });

  it("confere candidatos atuais através de vínculos cadastrais comprovados", () => {
    const pessoa = fonte("pessoa", null, { chave: "BRISA:PESSOA:1", dominio: "PESSOA", origem: "BRISA" });
    const copia = fonte("copia", null, { chave: "WIDESYS:PESSOA:1", dominio: "PESSOA" });
    const a = fonte("1", 46150, { pessoaChave: pessoa.chave });
    const b = fonte("2", 46150, { pessoaChave: copia.chave });
    const da = decisao(a, { status: "ATIVO", decisao: DECISAO_VALOR_DIFERENTE });
    const vinculo = decisao(copia, { status: "VINCULADO", decisao: "MANUAL", destinoChave: pessoa.chave, hashDestino: pessoa.hash });
    expect(projetarUnificados([a, b, pessoa, copia], [da, decisao(pessoa, { status: "ATIVO" }), vinculo])[0])
      .toMatchObject({ estado: "REVISAR", conferidoPorRegra: false, contabiliza: false });
  });

  it("não reabre a regra por uma cópia que já foi vinculada manualmente ao principal", () => {
    const a = fonte("1"), copia = fonte("copia", a.valor!);
    const da = decisao(a, { status: "ATIVO", decisao: DECISAO_VALOR_DIFERENTE });
    const dc = decisao(copia, { status: "VINCULADO", decisao: "MANUAL", destinoChave: a.chave, hashDestino: a.hash });
    const fontes = [a, copia], decisoes = new Map([[a.chave, da], [copia.chave, dc]]);
    expect(avaliarFonte(a, candidatosPara(a, fontes, new Map()), new Map(fontes.map(f => [f.chave, f])), da, decisoes))
      .toMatchObject({ status: "ATIVO" });
    const linhas = projetarUnificados(fontes, [da, dc]);
    expect(linhas[0]).toMatchObject({ estado: "ATIVO", conferidoPorRegra: true, contabiliza: true, candidatos: [] });
    expect(linhas[1]).toMatchObject({ estado: "VINCULADO", conferidoManualmente: true, contabiliza: false });
  });
});
