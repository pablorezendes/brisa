import type { CandidatoUnificacao, DecisaoUnificacao, EstadoUnificacao, FonteUnificacao, LinhaUnificada } from "./tipos";
import { criarIndiceCandidatos } from "./candidatos-indice";
import { hashFonteCorresponde } from "./hashes";
import { DECISAO_VALOR_DIFERENTE, valoresDevidosDiferentes } from "./valores-diferentes";

export function listaJson<T>(valor: string): T[] {
  try { const v: unknown = JSON.parse(valor); return Array.isArray(v) ? v as T[] : []; } catch { return []; }
}

/** Nomes geram sugestões, jamais uma união. Só vínculos comprovados unem automaticamente. */
export function candidatosPara(f: FonteUnificacao, fontes: FonteUnificacao[], destinos: Map<string, string>): CandidatoUnificacao[] {
  const destino = (chave?: string | null) => chave ? destinos.get(chave) ?? chave : null;
  const candidatos: CandidatoUnificacao[] = [];
  for (const outro of fontes) {
    if (outro.chave === f.chave || outro.dominio !== f.dominio || outro.qualidade !== "OK") continue;
    const razoes: string[] = [];
    const nomeIgual = f.nomeNorm.length >= 4 && f.nomeNorm === outro.nomeNorm;
    const mesmoValor = f.valor != null && outro.valor != null && f.valor === outro.valor;
    const mesmaPessoa = Boolean(f.pessoaChave && outro.pessoaChave && destino(f.pessoaChave) === destino(outro.pessoaChave));
    const mesmoImovel = Boolean(f.imovelChave && outro.imovelChave && destino(f.imovelChave) === destino(outro.imovelChave));
    const mesmoContrato = Boolean(f.contratoChave && outro.contratoChave && destino(f.contratoChave) === destino(outro.contratoChave));
    const mesmoTitulo = Boolean(f.tituloChave && outro.tituloChave && destino(f.tituloChave) === destino(outro.tituloChave));
    const mesmoMes = Boolean(f.competencia && outro.competencia && f.competencia === outro.competencia);
    if (f.dominio === "PESSOA") {
      if (f.documento && f.documento.length >= 11 && f.documento === outro.documento) razoes.push("DOCUMENTO_IGUAL");
      if (nomeIgual) razoes.push("NOME_IGUAL");
    } else if (f.dominio === "IMOVEL") {
      if (nomeIgual) razoes.push("IDENTIFICACAO_IGUAL");
      const endereco = f.campos.endereco?.valor;
      if (endereco && endereco === outro.campos.endereco?.valor && f.campos.numero?.valor && f.campos.numero.valor === outro.campos.numero?.valor) razoes.push("ENDERECO_IGUAL");
    } else if (f.dominio === "CONTRATO") {
      if (mesmaPessoa || mesmoImovel) razoes.push(mesmaPessoa && mesmoImovel ? "PESSOA_E_IMOVEL" : mesmaPessoa ? "MESMA_PESSOA" : "MESMO_IMOVEL");
      if (f.origem !== outro.origem && mesmoValor && f.valor! > 0) razoes.push("ALUGUEL_IGUAL_CONFERIR_IMOVEL");
    } else if (f.dominio === "RECEBER" || f.dominio === "PAGAR") {
      if (valoresDevidosDiferentes(f, outro)) continue;
      if (mesmoMes && (mesmoContrato || mesmaPessoa || mesmoImovel)) razoes.push("MES_E_VINCULO");
      if (mesmoMes && mesmoValor && f.valor! > 0 && (f.origem !== outro.origem || nomeIgual)) razoes.push("MES_E_VALOR");
      if (f.origem === outro.origem && mesmoMes && mesmoValor && nomeIgual && f.data === outro.data && f.pago === outro.pago && f.descricao === outro.descricao) razoes.push("CONTEUDO_REPETIDO");
    } else if (f.dominio === "MOVIMENTO") {
      const caixasDistintos = f.caixaChave && outro.caixaChave && f.caixaChave !== outro.caixaChave;
      if (!caixasDistintos && f.data && f.data === outro.data && mesmoValor && f.natureza === outro.natureza && (f.origem !== outro.origem || nomeIgual)) razoes.push("DATA_VALOR_NATUREZA");
    } else if (f.dominio.startsWith("BAIXA_")) {
      if (mesmoTitulo && f.data && f.data === outro.data && mesmoValor) razoes.push("TITULO_DATA_VALOR");
    } else if (f.dominio === "PARAMETRO" && nomeIgual && f.descricao === outro.descricao) razoes.push("PARAMETRO_IGUAL");
    if (razoes.length) candidatos.push({ chave: outro.chave, motivos: razoes });
  }
  return candidatos.sort((a,b) => b.motivos.length - a.motivos.length || a.chave.localeCompare(b.chave));
}

/** Uma cópia já vinculada a este principal não é uma nova pendência. */
function candidatosPendentesDaRegra(f: FonteUnificacao, candidatos: CandidatoUnificacao[], fontes: Map<string, FonteUnificacao>, decisoes: Map<string, DecisaoUnificacao>) {
  return candidatos.filter(c => {
    const outra = fontes.get(c.chave), decisao = decisoes.get(c.chave);
    if (outra?.vinculoExplicito === f.chave) return false;
    return !(outra && decisao?.status === "VINCULADO" && decisao.destinoChave === f.chave
      && hashFonteCorresponde(outra, decisao.hashFonte) && hashFonteCorresponde(f, decisao.hashDestino));
  });
}

export function avaliarFonte(f: FonteUnificacao, candidatos: CandidatoUnificacao[], fontes: Map<string, FonteUnificacao>, anterior?: DecisaoUnificacao, decisoes = new Map<string, DecisaoUnificacao>(), competenciasReceberBrisa?: ReadonlySet<FonteUnificacao["competencia"]>): { status: EstadoUnificacao; destinoChave: string | null; motivos: string[] } {
  if (f.qualidade !== "OK") return { status: f.qualidade === "AUSENTE" ? "AUSENTE" : "QUARENTENA", destinoChave: anterior?.destinoChave ?? null, motivos: f.motivos };
  if (anterior?.decisao === "MANUAL" || anterior?.decisao === DECISAO_VALOR_DIFERENTE) {
    const alvo = anterior.destinoChave ? fontes.get(anterior.destinoChave) : null;
    if (!hashFonteCorresponde(f, anterior.hashFonte) || (anterior.destinoChave && (!alvo || alvo.dominio !== f.dominio || !hashFonteCorresponde(alvo, anterior.hashDestino) || alvo.qualidade !== "OK"))) {
      return { status: "REVISAR", destinoChave: anterior.destinoChave, motivos: ["FONTE_ALTERADA_APOS_DECISAO"] };
    }
    if (anterior.decisao === DECISAO_VALOR_DIFERENTE && anterior.status === "ATIVO"
      && candidatosPendentesDaRegra(f, candidatos, fontes, decisoes).length) {
      return { status: "REVISAR", destinoChave: null, motivos: ["CORRESPONDENCIA_APOS_REGRA_VALOR_DIFERENTE"] };
    }
    return { status: anterior.status as EstadoUnificacao, destinoChave: anterior.destinoChave, motivos: listaJson<string>(anterior.motivos) };
  }
  if (f.vinculoExplicito && fontes.get(f.vinculoExplicito)?.qualidade === "OK" && fontes.get(f.vinculoExplicito)?.dominio === f.dominio) return { status: "VINCULADO", destinoChave: f.vinculoExplicito, motivos: ["VINCULO_JA_COMPROVADO"] };
  // A chegada de uma fonte nova não troca o principal previamente aceito.
  // A nova candidata fica pendente, sem alternância a cada reanálise.
  if (anterior?.decisao === "AUTOMATICA" && anterior.status === "ATIVO" && hashFonteCorresponde(f, anterior.hashFonte)) return { status: "ATIVO", destinoChave: null, motivos: listaJson<string>(anterior.motivos) };
  // O primeiro registro nativo é a referência operacional; uma repetição
  // integral fica pendente sem apagar dados nem escolher valores financeiros.
  // Um principal já confirmado tem precedência sobre novos UUIDs, mesmo que
  // ordenem antes dele. Assim uma nova captura não ativa outra cópia do fato.
  const principalExistente = (chave: string) => {
    const d = decisoes.get(chave);
    const atual = fontes.get(chave);
    // Todas as fontes sao avaliadas contra a mesma fotografia anterior. Um
    // principal que mudou pode deixar de ser ATIVO nesta propria passagem;
    // sua precedencia antiga nao deve adiar a classificacao das candidatas.
    if (!d || d.status !== "ATIVO" || d.destinoChave || !atual || atual.qualidade !== "OK" || atual.dominio !== f.dominio || !hashFonteCorresponde(atual, d.hashFonte)) return false;
    const alvo = atual.vinculoExplicito ? fontes.get(atual.vinculoExplicito) : null;
    if (d.decisao !== "MANUAL" && alvo?.qualidade === "OK" && alvo.dominio === atual.dominio) return false;
    return d.decisao === "MANUAL" || anterior?.status !== "ATIVO" || !hashFonteCorresponde(f, anterior.hashFonte);
  };
  if (f.origem === "BRISA" && (anterior?.status !== "ATIVO" || !hashFonteCorresponde(f, anterior.hashFonte)) && candidatos.some(c => c.chave.startsWith("WIDESYS:") && principalExistente(c.chave))) {
    return { status: "PENDENTE", destinoChave: null, motivos: ["POSSIVEL_DUPLICIDADE"] };
  }
  const anteriores = candidatos.filter(c => c.chave.startsWith("BRISA:") && (principalExistente(c.chave) || c.chave < f.chave));
  if (f.origem === "BRISA") return anteriores.some(c => c.motivos.includes("CONTEUDO_REPETIDO") || c.motivos.includes("DATA_VALOR_NATUREZA") || c.motivos.includes("DOCUMENTO_IGUAL"))
    ? { status: "PENDENTE", destinoChave: null, motivos: ["POSSIVEL_DUPLICIDADE_INTERNA"] }
    : { status: "ATIVO", destinoChave: null, motivos: candidatos.length ? ["POSSIVEIS_CORRESPONDENCIAS"] : [] };
  const precedentes = candidatos.filter(c => c.chave.startsWith("BRISA:") || principalExistente(c.chave) || c.chave < f.chave);
  if (precedentes.length) return { status: "PENDENTE", destinoChave: null, motivos: ["POSSIVEL_DUPLICIDADE"] };
  // Contratos/recebíveis sem ponte de identidade podem se sobrepor à planilha
  // mesmo com grafia/valor distintos. A ausência de candidato não é prova.
  if (f.dominio === "CONTRATO" && fontes.size > 0) return { status: "PENDENTE", destinoChave: null, motivos: ["CONFERIR_IMOVEL_E_INQUILINO"] };
  if (f.dominio === "RECEBER" && (competenciasReceberBrisa?.has(f.competencia) ?? [...fontes.values()].some(o => o.origem === "BRISA" && o.dominio === "RECEBER" && o.competencia === f.competencia))) return { status: "PENDENTE", destinoChave: null, motivos: ["PERIODO_JA_EXISTE_NA_PLANILHA"] };
  return { status: "ATIVO", destinoChave: null, motivos: ["SEM_CORRESPONDENCIA_ENCONTRADA"] };
}

export function projetarUnificados(fontes: FonteUnificacao[], decisoes: DecisaoUnificacao[]): LinhaUnificada[] {
  const porChave = new Map(fontes.map(f => [f.chave, f]));
  const decisoesPorChave = new Map(decisoes.map(d => [d.chave,d]));
  const linhas = new Map<string,LinhaUnificada>();
  const destinosSemVinculo = new Map<string, string>();
  let indiceCandidatos: ReturnType<typeof criarIndiceCandidatos> | undefined;
  let indiceRegra: ReturnType<typeof criarIndiceCandidatos> | undefined;
  const destinosRegra = new Map<string, string>();
  const candidatosAtuaisDaRegra = (f: FonteUnificacao) => {
    if (!indiceRegra) {
      for (const fonte of fontes) if (fonte.vinculoExplicito) destinosRegra.set(fonte.chave, fonte.vinculoExplicito);
      for (const d of decisoes) if (d.status === "VINCULADO" && d.destinoChave
        && hashFonteCorresponde(porChave.get(d.chave), d.hashFonte)
        && hashFonteCorresponde(porChave.get(d.destinoChave), d.hashDestino)) destinosRegra.set(d.chave, d.destinoChave);
      indiceRegra = criarIndiceCandidatos(fontes, destinosRegra);
    }
    return candidatosPendentesDaRegra(f, candidatosPara(f, indiceRegra.para(f), destinosRegra), porChave, decisoesPorChave);
  };
  const candidatosNovos = (f: FonteUnificacao) => {
    // A fotografia já analisada não precisa reconstruir o índice.
    indiceCandidatos ??= criarIndiceCandidatos(fontes, destinosSemVinculo);
    return candidatosPara(f, indiceCandidatos.para(f), destinosSemVinculo);
  };
  for (const f of fontes) {
    const d = decisoesPorChave.get(f.chave);
    const reavaliarNativo = Boolean(d && !hashFonteCorresponde(f, d.hashFonte) && f.origem === "BRISA" && d.status === "ATIVO" && d.decisao === "AUTOMATICA");
    const fonteMudou = d && !hashFonteCorresponde(f, d.hashFonte) && !reavaliarNativo;
    const alvo = d?.destinoChave ? porChave.get(d.destinoChave) : null;
    const alvoDecisao = d?.destinoChave ? decisoesPorChave.get(d.destinoChave) : null;
    const alvoInvalido = d?.destinoChave && (!alvo || alvo.dominio !== f.dominio || !hashFonteCorresponde(alvo, d.hashDestino) || alvo.qualidade !== "OK" || alvoDecisao?.status !== "ATIVO" || !hashFonteCorresponde(alvo, alvoDecisao?.hashFonte));
    const propostas = d?.decisao === DECISAO_VALOR_DIFERENTE ? candidatosAtuaisDaRegra(f)
      : d && !reavaliarNativo ? listaJson<CandidatoUnificacao>(d.candidatos) : candidatosNovos(f);
    const regraReaberta = d?.decisao === DECISAO_VALOR_DIFERENTE && d.status === "ATIVO" && propostas.length > 0;
    // Cadastros e lançamentos novos do próprio Brisa não exigem uma migração
    // para funcionar. Ainda passam pela mesma checagem de repetição interna.
    const estadoNovo = (!d || reavaliarNativo) && f.origem === "BRISA"
      ? avaliarFonte(f, propostas, porChave, d, decisoesPorChave, indiceCandidatos?.competenciasReceberBrisa).status
      : "PENDENTE";
    const estado: EstadoUnificacao = f.qualidade !== "OK" ? (f.qualidade === "AUSENTE" ? "AUSENTE" : "QUARENTENA")
      : !d || reavaliarNativo ? estadoNovo : fonteMudou || alvoInvalido || regraReaberta ? "REVISAR" : d.status as EstadoUnificacao;
    const candidatos = propostas.flatMap(c => { const o = porChave.get(c.chave); return o && !valoresDevidosDiferentes(f, o) ? [{ ...c, titulo: o.titulo, descricao: o.descricao }] : []; });
    const avisos = listaJson<string>(d?.motivos ?? "[]");
    if (!d) avisos.push("ANALISE_NECESSARIA");
    if (fonteMudou || alvoInvalido) avisos.push("FONTE_ALTERADA_APOS_DECISAO");
    if (regraReaberta) avisos.push("CORRESPONDENCIA_APOS_REGRA_VALOR_DIFERENTE");
    const origemManual = f.origem === "BRISA" && f.proveniencia?.tipo === "CADASTRO_MANUAL";
    const conferidoManualmente = estado === "ATIVO" && d?.decisao === "MANUAL" && d.status === "ATIVO" && !d.destinoChave && hashFonteCorresponde(f, d.hashFonte);
    const conferidoPorRegra = (f.dominio === "PAGAR" || f.dominio === "RECEBER") && estado === "ATIVO"
      && d?.decisao === DECISAO_VALOR_DIFERENTE && d.status === "ATIVO" && !d.destinoChave
      && !f.cancelado && !f.informativo && hashFonteCorresponde(f, d.hashFonte);
    linhas.set(f.chave, { ...f, estado, origens: [origemManual ? "MANUAL" : f.proveniencia ? "PLANILHA" : f.origem], fontes: [f.chave], versao: d?.versao ?? 0, candidatos, avisos, contabiliza: estado === "ATIVO" && !f.cancelado && !f.informativo, conferidoManualmente, conferidoPorRegra, divergencias: [] });
  }
  for (const d of decisoes) {
    const f = linhas.get(d.chave); const alvo = d.destinoChave ? linhas.get(d.destinoChave) : null;
    if (f?.estado !== "VINCULADO" || !alvo || alvo.estado !== "ATIVO") continue;
    // A conferência pertence à decisão desta fonte. Vincular manualmente uma
    // cópia não marca o principal automático como conferido por uma pessoa.
    f.conferidoManualmente = d.decisao === "MANUAL" && d.status === "VINCULADO" && hashFonteCorresponde(f, d.hashFonte) && hashFonteCorresponde(alvo, d.hashDestino);
    alvo.fontes.push(f.chave); alvo.origens = [...new Set([...alvo.origens, ...f.origens])];
    alvo.papeis = [...new Set([...(alvo.papeis ?? []), ...(f.papeis ?? [])])];
    // Complementa somente lacunas de exibição; dinheiro e dados operacionais
    // do registro principal permanecem como estavam, sem uma nova baixa.
    const campos = { ...alvo.campos };
    for (const [chave, campo] of Object.entries(f.campos)) {
      const atual = campos[chave];
      if (!atual || atual.valor === null || atual.valor === "") campos[chave] = campo;
      else if (campo.valor !== null && campo.valor !== "" && String(campo.valor) !== String(atual.valor)) alvo.divergencias.push(campo.rotulo);
    }
    alvo.campos = campos; alvo.divergencias = [...new Set(alvo.divergencias)];
  }
  return [...linhas.values()];
}

export const MOTIVOS_UNIFICACAO: Record<string,string> = {
  CORRESPONDENCIA_APOS_REGRA_VALOR_DIFERENTE: "Surgiu outro título com valor igual ou não comprovado. Confira novamente antes de incluir este lançamento nos totais.",
  VALORES_DIFERENTES_CONFIRMADOS: "Conferido pela regra de valores diferentes: os títulos permanecem separados e cada valor entra uma única vez nos totais.",
  PAGAMENTO_DESPESA_CONFERIR: "A saída vinculada à nota foi alterada ou excluída. Confira o vínculo; o sistema não cria outro pagamento nem uma nova cobrança.",
  POSSIVEL_DUPLICIDADE: "Existe um registro semelhante. Compare antes de incorporar.", POSSIVEL_DUPLICIDADE_INTERNA: "O próprio sistema contém uma possível repetição.", POSSIVEIS_CORRESPONDENCIAS: "Há registros que podem complementar esta informação.",
  CONFERIR_IMOVEL_E_INQUILINO: "Confirme o imóvel e o inquilino para identificar o contrato existente.", PERIODO_JA_EXISTE_NA_PLANILHA: "Já existem cobranças neste período nas planilhas. Identifique o contrato antes de somar.",
  SEM_CORRESPONDENCIA_ENCONTRADA: "Nenhum vínculo confirmado; conserva sua identidade de origem.", FONTE_ALTERADA_APOS_DECISAO: "Dados alterados desde a decisão. Compare novamente.", VINCULO_JA_COMPROVADO: "Vínculo cadastral já registrado no sistema.", ANALISE_NECESSARIA: "Atualize a análise para classificar o registro.",
};
