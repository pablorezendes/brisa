import type { FonteUnificacao } from "./tipos";

/**
 * Reduz a varredura às regras que podem produzir candidatos. Não decide nem
 * une registros: candidatosPara continua aplicando todas as regras originais.
 * O índice pertence a uma única fotografia, sem cache entre requisições.
 */
export function criarIndiceCandidatos(fontes: FonteUnificacao[], destinos: ReadonlyMap<string, string>) {
  const grupos = new Map<string, FonteUnificacao[]>();
  const ordem = new Map(fontes.map((fonte, indice) => [fonte, indice]));
  const competenciasReceberBrisa = new Set<FonteUnificacao["competencia"]>();
  const destino = (chave: string) => destinos.get(chave) ?? chave;

  function chaves(f: FonteUnificacao): string[] {
    const resultado: string[] = [];
    const adicionar = (regra: string, ...valores: unknown[]) => resultado.push(JSON.stringify([f.dominio, regra, ...valores]));
    const nomeValido = f.nomeNorm.length >= 4;
    if (f.dominio === "PESSOA") {
      if (f.documento && f.documento.length >= 11) adicionar("documento", f.documento);
      if (nomeValido) adicionar("nome", f.nomeNorm);
    } else if (f.dominio === "IMOVEL") {
      if (nomeValido) adicionar("nome", f.nomeNorm);
      if (f.campos.endereco?.valor && f.campos.numero?.valor) adicionar("endereco", f.campos.endereco.valor, f.campos.numero.valor);
    } else if (f.dominio === "CONTRATO") {
      if (f.pessoaChave) adicionar("pessoa", destino(f.pessoaChave));
      if (f.imovelChave) adicionar("imovel", destino(f.imovelChave));
      if (f.valor != null && f.valor > 0) adicionar("valor", f.valor);
    } else if (f.dominio === "RECEBER" || f.dominio === "PAGAR") {
      if (f.competencia) {
        if (f.pessoaChave) adicionar("mes-pessoa", f.competencia, destino(f.pessoaChave));
        if (f.imovelChave) adicionar("mes-imovel", f.competencia, destino(f.imovelChave));
        if (f.contratoChave) adicionar("mes-contrato", f.competencia, destino(f.contratoChave));
        // Zero também pode caracterizar conteúdo repetido na mesma origem.
        if (f.valor != null) adicionar("mes-valor", f.competencia, f.valor);
      }
    } else if (f.dominio === "MOVIMENTO") {
      if (f.data && f.valor != null) adicionar("data-valor-natureza", f.data, f.valor, f.natureza);
    } else if (f.dominio.startsWith("BAIXA_")) {
      if (f.tituloChave && f.data && f.valor != null) adicionar("titulo-data-valor", destino(f.tituloChave), f.data, f.valor);
    } else if (f.dominio === "PARAMETRO" && nomeValido) adicionar("nome-descricao", f.nomeNorm, f.descricao);
    return resultado;
  }

  for (const f of fontes) {
    // Mantém inclusive null/undefined: avaliarFonte historicamente compara ===.
    if (f.origem === "BRISA" && f.dominio === "RECEBER") competenciasReceberBrisa.add(f.competencia);
    if (f.qualidade !== "OK") continue;
    for (const chave of chaves(f)) {
      const grupo = grupos.get(chave);
      if (grupo) grupo.push(f);
      else grupos.set(chave, [f]);
    }
  }

  return {
    competenciasReceberBrisa,
    para(f: FonteUnificacao): FonteUnificacao[] {
      const encontrados = new Set<FonteUnificacao>();
      for (const chave of chaves(f)) for (const outro of grupos.get(chave) ?? []) encontrados.add(outro);
      // Preserva desempates estáveis até em fixtures com a mesma chave repetida.
      return [...encontrados].sort((a, b) => ordem.get(a)! - ordem.get(b)!);
    },
  };
}
