import { describe, expect, it } from "vitest";
import { avaliarFonte, candidatosPara, listaJson, projetarUnificados } from "./reconciliacao";
import { DOMINIOS_UNIFICACAO, type CandidatoUnificacao, type DecisaoUnificacao, type EstadoUnificacao, type FonteUnificacao, type LinhaUnificada } from "./tipos";

/** Referência anterior à indexação: varre todos os domínios em cada recálculo. */
function projetarSemIndice(fontes: FonteUnificacao[], decisoes: DecisaoUnificacao[]): LinhaUnificada[] {
  const porChave = new Map(fontes.map(f => [f.chave, f]));
  const decisoesPorChave = new Map(decisoes.map(d => [d.chave, d]));
  const linhas = new Map<string, LinhaUnificada>();
  for (const f of fontes) {
    const d = decisoesPorChave.get(f.chave);
    const reavaliarNativo = Boolean(d && d.hashFonte !== f.hash && f.origem === "BRISA" && d.status === "ATIVO" && d.decisao === "AUTOMATICA");
    const fonteMudou = d && d.hashFonte !== f.hash && !reavaliarNativo;
    const alvo = d?.destinoChave ? porChave.get(d.destinoChave) : null;
    const alvoDecisao = d?.destinoChave ? decisoesPorChave.get(d.destinoChave) : null;
    const alvoInvalido = d?.destinoChave && (!alvo || alvo.dominio !== f.dominio || alvo.hash !== d.hashDestino || alvo.qualidade !== "OK" || alvoDecisao?.status !== "ATIVO" || alvoDecisao?.hashFonte !== alvo.hash);
    const propostas = d && !reavaliarNativo ? listaJson<CandidatoUnificacao>(d.candidatos) : candidatosPara(f, fontes, new Map());
    const estadoNovo = (!d || reavaliarNativo) && f.origem === "BRISA"
      ? avaliarFonte(f, propostas, porChave, d, decisoesPorChave).status : "PENDENTE";
    const estado: EstadoUnificacao = f.qualidade !== "OK" ? (f.qualidade === "AUSENTE" ? "AUSENTE" : "QUARENTENA")
      : !d || reavaliarNativo ? estadoNovo : fonteMudou || alvoInvalido ? "REVISAR" : d.status as EstadoUnificacao;
    const candidatos = propostas.flatMap(c => { const o = porChave.get(c.chave); return o ? [{ ...c, titulo: o.titulo, descricao: o.descricao }] : []; });
    const avisos = listaJson<string>(d?.motivos ?? "[]");
    if (!d) avisos.push("ANALISE_NECESSARIA");
    if (fonteMudou || alvoInvalido) avisos.push("FONTE_ALTERADA_APOS_DECISAO");
    linhas.set(f.chave, { ...f, estado, origens: [f.proveniencia ? "PLANILHA" : f.origem], fontes: [f.chave], versao: d?.versao ?? 0, candidatos, avisos, contabiliza: estado === "ATIVO" && !f.cancelado && !f.informativo, divergencias: [] });
  }
  for (const d of decisoes) {
    const f = linhas.get(d.chave);
    const alvo = d.destinoChave ? linhas.get(d.destinoChave) : null;
    if (f?.estado !== "VINCULADO" || !alvo || alvo.estado !== "ATIVO") continue;
    alvo.fontes.push(f.chave);
    alvo.origens = [...new Set([...alvo.origens, ...f.origens])];
    alvo.papeis = [...new Set([...(alvo.papeis ?? []), ...(f.papeis ?? [])])];
    const campos = { ...alvo.campos };
    for (const [chave, campo] of Object.entries(f.campos)) {
      const atual = campos[chave];
      if (!atual || atual.valor === null || atual.valor === "") campos[chave] = campo;
      else if (campo.valor !== null && campo.valor !== "" && String(campo.valor) !== String(atual.valor)) alvo.divergencias.push(campo.rotulo);
    }
    alvo.campos = campos;
    alvo.divergencias = [...new Set(alvo.divergencias)];
  }
  return [...linhas.values()];
}

function fonte(dominio: FonteUnificacao["dominio"], id: string, origem: FonteUnificacao["origem"] = "BRISA", extras: Partial<FonteUnificacao> = {}): FonteUnificacao {
  return {
    chave: `${origem}:${dominio}:${id}`, dominio, origem, origemId: id,
    titulo: `Registro artificial ${dominio} ${id}`, descricao: "Mesmo conteúdo artificial",
    hash: `hash-${origem}-${dominio}-${id}`, href: null, nomeNorm: "MESMO NOME ARTIFICIAL",
    qualidade: "OK", motivos: [], campos: { endereco: { rotulo: "Endereço", valor: "Rua artificial" }, numero: { rotulo: "Número", valor: "1" } },
    documento: "00000000001", competencia: "2026-09", data: "2026-09-10", valor: 10000, pago: 2000, aberto: 8000,
    natureza: "ENTRADA", pessoaChave: "BRISA:PESSOA:pessoa", imovelChave: "BRISA:IMOVEL:imovel", contratoChave: "BRISA:CONTRATO:contrato", tituloChave: "BRISA:RECEBER:titulo", ...extras,
  };
}

function decisao(f: FonteUnificacao, extras: Partial<DecisaoUnificacao> = {}): DecisaoUnificacao {
  return { chave: f.chave, dominio: f.dominio, origem: f.origem, origemId: f.origemId, status: "ATIVO", destinoChave: null, hashFonte: f.hash, hashDestino: null, candidatos: "[]", motivos: "[]", proveniencia: "{}", decisao: "AUTOMATICA", versao: 3, ...extras };
}

function baseMista() {
  // Intercala os domínios e inverte a ordem alfabética para detectar reordenações acidentais.
  return ["z", "a", "m"].flatMap(id => [...DOMINIOS_UNIFICACAO].reverse().map(dominio => fonte(dominio, id, id === "m" ? "WIDESYS" : "BRISA")));
}

function conferir(fontes: FonteUnificacao[], decisoes: DecisaoUnificacao[]) {
  const antesFontes = structuredClone(fontes);
  const antesDecisoes = structuredClone(decisoes);
  const resultado = projetarUnificados(fontes, decisoes);
  expect(resultado).toEqual(projetarSemIndice(fontes, decisoes));
  expect(resultado.map(linha => linha.chave)).toEqual(fontes.map(item => item.chave));
  expect(fontes).toEqual(antesFontes);
  expect(decisoes).toEqual(antesDecisoes);
  return resultado;
}

describe("projeção com índice por domínio equivale à varredura integral", () => {
  it("preserva candidatos, ordenação, hashes e estados de fontes novas nos nove domínios", () => {
    const fontes = baseMista();
    const resultado = conferir(fontes, []);
    for (const linha of resultado) {
      const original = fontes.find(item => item.chave === linha.chave)!;
      expect(linha.hash).toBe(original.hash);
      expect(linha.candidatos.map(({ chave, motivos }) => ({ chave, motivos }))).toEqual(candidatosPara(original, fontes, new Map()));
      expect(linha.candidatos.length).toBeGreaterThan(0);
    }
  });

  it("recalcula nativos automáticos alterados sem mudar candidatos e decisões de fontes estáveis", () => {
    const originais = baseMista();
    const decisoes = originais.filter(item => item.origemId !== "z").map(item => decisao(item, { candidatos: JSON.stringify(candidatosPara(item, originais, new Map())) }));
    const fontes = originais.map(item => item.origem === "BRISA" && item.origemId === "a" ? { ...item, hash: `${item.hash}-mudou` } : item);
    const resultado = conferir(fontes, decisoes);
    expect(resultado.filter(item => item.origem === "BRISA" && item.origemId === "a" && ["RECEBER", "PAGAR", "PESSOA", "MOVIMENTO"].includes(item.dominio)).every(item => item.estado === "PENDENTE")).toBe(true);
    expect(resultado.filter(item => item.origem === "WIDESYS").every(item => item.estado === "ATIVO")).toBe(true);
  });

  it("mantém decisões manuais e complementação dos vínculos sem resolver pontes novas implicitamente", () => {
    const principal = fonte("PESSOA", "principal", "BRISA", { papeis: ["INQUILINO"], proveniencia: { arquivo: "artificial.xlsx" }, campos: { cidade: { rotulo: "Cidade", valor: "A" } } });
    const ligada = fonte("PESSOA", "ligada", "WIDESYS", { papeis: ["FIADOR"], campos: { cidade: { rotulo: "Cidade", valor: "B" }, telefone: { rotulo: "Telefone", valor: "Telefone artificial" } } });
    const receber = fonte("RECEBER", "origem", "BRISA", { pessoaChave: principal.chave, contratoChave: null, imovelChave: null, valor: 12000 });
    const legado = fonte("RECEBER", "legado", "WIDESYS", { pessoaChave: ligada.chave, contratoChave: null, imovelChave: null, valor: 13000 });
    const fontes = [legado, principal, receber, ligada, ...baseMista().filter(item => item.dominio === "PARAMETRO")];
    const resultado = conferir(fontes, [decisao(principal, { decisao: "MANUAL" }), decisao(ligada, { status: "VINCULADO", destinoChave: principal.chave, hashDestino: principal.hash, decisao: "MANUAL" })]);
    const unificada = resultado.find(item => item.chave === principal.chave)!;
    expect(unificada.fontes).toEqual([principal.chave, ligada.chave]);
    expect(unificada.divergencias).toEqual(["Cidade"]);
    expect(unificada.papeis).toEqual(["INQUILINO", "FIADOR"]);
    expect(resultado.find(item => item.chave === receber.chave)?.candidatos).toEqual([]);
  });

  it("preserva candidatos já gravados e revisão manual por alteração de hash", () => {
    const fontes = baseMista();
    const manual = fontes[0];
    const sugestao = fontes.find(item => item.dominio !== manual.dominio)!;
    const decisoes = fontes.map(item => decisao(item, { decisao: "MANUAL", candidatos: JSON.stringify([{ chave: sugestao.chave, motivos: ["SNAPSHOT_PRESERVADO"] }]) }));
    const alteradas = fontes.map(item => item.chave === manual.chave ? { ...item, hash: "hash-manual-alterado" } : item);
    const resultado = conferir(alteradas, decisoes);
    expect(resultado[0]).toMatchObject({ estado: "REVISAR", contabiliza: false });
    expect(resultado[0].candidatos[0].motivos).toEqual(["SNAPSHOT_PRESERVADO"]);
  });

  it("preserva quarentena, ausência, cancelamento e baixas informativas nos grupos indexados", () => {
    const fontes = baseMista().map((item, i) => i % 5 === 0 ? { ...item, qualidade: "QUARENTENA" as const } : i % 5 === 1 ? { ...item, qualidade: "AUSENTE" as const } : i % 5 === 2 ? { ...item, cancelado: true } : item.dominio.startsWith("BAIXA_") ? { ...item, informativo: true } : item);
    const resultado = conferir(fontes, []);
    expect(resultado.filter(item => item.qualidade !== "OK" || item.cancelado || item.informativo).every(item => !item.contabiliza)).toBe(true);
    for (const linha of resultado) expect(linha.candidatos.every(c => fontes.find(f => f.chave === c.chave)?.qualidade === "OK")).toBe(true);
  });

  it("aceita conjuntos vazios e fontes de um único domínio", () => {
    conferir([], []);
    conferir([fonte("PARAMETRO", "isolada")], []);
  });
});
