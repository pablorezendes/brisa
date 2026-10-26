type TextoSigilo = string | null | undefined;
const normalizar = (valor: string) => valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toUpperCase();

/** Honorários profissionais não são, por si, comissão da administradora.
 * A regra é compartilhada por escrita, anexos e projeções financeiras. */
export function contemComissaoRestrita(textos: TextoSigilo | readonly TextoSigilo[]): boolean {
  return (Array.isArray(textos) ? textos : [textos]).some(valor => typeof valor === "string" && /COMISS|CORRETAG|\bTAXA\s+(?:DE\s+)?ADM|\bHONORARIOS?\s+(?:(?:DE|DA|POR)\s+)?(?:ADMINISTR|INTERMEDIAC|GESTAO\s+IMOBILI)/.test(normalizar(valor)));
}

/** Somente o administrador pode confirmar esta exceção em uma categoria já
 * protegida. A elegibilidade não é uma autorização para alterar registros. */
export function categoriaHonorariosCorrigivel(categoria: { codigo: string; rotulo: string; restrita: boolean; padrao?: boolean } | null | undefined): boolean {
  return !!categoria?.restrita && !categoria.padrao && categoria.codigo !== "ADMINISTRACAO_COMISSAO"
    && /\bHONORARIOS?\b/.test(normalizar(categoria.rotulo)) && !contemComissaoRestrita(categoria.rotulo);
}

export function descricaoHonorariosProfissionais(descricao: TextoSigilo): boolean {
  return typeof descricao === "string" && !contemComissaoRestrita(descricao)
    && /\bHONORARIOS?\s+(?:(?:DE|DA|POR|SERVICOS?)\s+)*(?:CONTAB|ADVOCATIC|ADVOCACIA|JURIDIC)/.test(normalizar(descricao));
}

/** Eventos são evidência histórica. JSON inválido não comprova uma exceção.
 * Examina valores, nunca chaves técnicas como "correcaoSigiloHonorarios". */
export function historicoSemComissao(snapshots: readonly (string | null)[]): boolean {
  const seguro = (valor: unknown): boolean => typeof valor === "string" ? !contemComissaoRestrita(valor)
    : Array.isArray(valor) ? valor.every(seguro)
      : valor && typeof valor === "object" ? Object.values(valor).every(seguro) : true;
  return snapshots.every(snapshot => {
    if (!snapshot) return true;
    try { return seguro(JSON.parse(snapshot)); } catch { return false; }
  });
}
