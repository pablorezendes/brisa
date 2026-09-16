type Objeto = Record<string, unknown>;

function objeto(valor: unknown): Objeto | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Objeto)
    : null;
}

function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);
  const registro = objeto(valor);
  if (!registro) return valor;
  return Object.fromEntries(
    Object.entries(registro)
      .filter(([, item]) => item !== undefined)
      .sort(([esquerda], [direita]) => esquerda.localeCompare(direita))
      .map(([chave, item]) => [chave, canonico(item)]),
  );
}

function ordenarPorCaminho(valor: unknown): unknown[] {
  return (Array.isArray(valor) ? valor : [])
    .map(canonico)
    .sort((esquerda, direita) => {
      const caminhoEsquerdo = String(objeto(esquerda)?.path ?? "");
      const caminhoDireito = String(objeto(direita)?.path ?? "");
      return caminhoEsquerdo.localeCompare(caminhoDireito);
    });
}

/**
 * Serialização única usada pelo capturador e pelo importador. A versão 2 cobre
 * todo metadado capaz de alterar escopo, período ou interpretação financeira.
 * A versão 1 permanece apenas para leitura de capturas legadas já existentes.
 */
export function conteudoHashManifestoOperacao(manifestoDesconhecido: unknown): string {
  const manifesto = objeto(manifestoDesconhecido) ?? {};
  const versaoEsquema = Number(manifesto.schemaVersion ?? manifesto.version ?? 1);
  if (versaoEsquema < 2) {
    const artifacts = (Array.isArray(manifesto.artifacts) ? manifesto.artifacts : [])
      .map((entrada) => objeto(entrada))
      .filter((entrada): entrada is Objeto => Boolean(entrada))
      .map((entrada) => ({ path: entrada.path, sha256: entrada.sha256 }))
      .sort((esquerda, direita) => String(esquerda.path).localeCompare(String(direita.path)));
    return JSON.stringify({
      artifacts,
      errors: Array.isArray(manifesto.errors) ? manifesto.errors : [],
      modules: objeto(manifesto.modules) ?? {},
    });
  }

  return JSON.stringify(
    canonico({
      artifacts: ordenarPorCaminho(manifesto.artifacts),
      baseOrigin: manifesto.baseOrigin,
      businessDate: manifesto.businessDate,
      captureId: manifesto.captureId,
      capturedAt: manifesto.capturedAt,
      complete: manifesto.complete,
      completedAt: manifesto.completedAt,
      errors: Array.isArray(manifesto.errors) ? manifesto.errors : [],
      files: ordenarPorCaminho(manifesto.files),
      modules: objeto(manifesto.modules) ?? {},
      options: objeto(manifesto.options) ?? {},
      schemaVersion: manifesto.schemaVersion,
      sourceOrigin: manifesto.sourceOrigin,
      startedAt: manifesto.startedAt,
      timeZone: manifesto.timeZone,
      version: manifesto.version,
    }),
  );
}
