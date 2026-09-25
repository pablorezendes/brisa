import { ErroFiscal, ambienteFiscal, type AmbienteFiscal, type PayloadFiscal } from "./dominio";

const BASES: Record<AmbienteFiscal, string> = {
  HOMOLOGACAO: "https://homologacao.focusnfe.com.br",
  PRODUCAO: "https://api.focusnfe.com.br",
};

export type RetornoFiscal = {
  status: "PROCESSANDO" | "AUTORIZADA" | "REJEITADA" | "INCERTA" | "CANCELADA";
  numero?: string; codigoVerificacao?: string; protocolo?: string; urlDocumento?: string;
  erroCodigo?: string; erroMensagem?: string;
};

export function infraestruturaFiscal(ambiente: string) {
  const nome = ambienteFiscal(ambiente);
  return {
    token: Boolean(process.env[`FOCUS_NFSE_TOKEN_${nome}`]?.trim()),
    producaoLiberada: process.env.FISCAL_EMISSAO_PRODUCAO === "1",
  };
}

function textoSeguro(valor: unknown, max = 80): string | undefined {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).replace(/[\x00-\x1f]/g, "").slice(0, max) : undefined;
}

export function urlDocumentoFiscal(valor: unknown): string | undefined {
  if (typeof valor !== "string" || valor.length > 2000) return undefined;
  try {
    const url = new URL(valor);
    const permitidos = ["focusnfe.s3.sa-east-1.amazonaws.com", "api.focusnfe.com.br", "homologacao.focusnfe.com.br", "www.nfse.gov.br", "nfse.gov.br", "www.issnetonline.com.br", "nfse.issnetonline.com.br"];
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !permitidos.includes(url.hostname)) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Só respostas vinculadas à referência original podem alterar o documento. */
export function normalizarRetornoFiscal(body: unknown, referencia: string, cnpj: string): RetornoFiscal {
  if (!body || typeof body !== "object" || Array.isArray(body)) return incerto("RESPOSTA_INVALIDA");
  const r = body as Record<string, unknown>;
  if (r.ref !== referencia || (r.cnpj_prestador !== undefined && String(r.cnpj_prestador).replace(/\D/g, "") !== cnpj)) return incerto("IDENTIDADE_DIVERGENTE");
  const protocolo = textoSeguro(r.protocolo);
  if (r.status === "processando_autorizacao") return { status: "PROCESSANDO", protocolo };
  if (r.status === "autorizado" || r.status === "cancelado") {
    if (String(r.cnpj_prestador).replace(/\D/g, "") !== cnpj || !textoSeguro(r.numero)) return incerto("AUTORIZACAO_INCOMPLETA");
    return { status: r.status === "autorizado" ? "AUTORIZADA" : "CANCELADA", numero: textoSeguro(r.numero), codigoVerificacao: textoSeguro(r.codigo_verificacao), protocolo, urlDocumento: urlDocumentoFiscal(r.url_danfse) ?? urlDocumentoFiscal(r.url) };
  }
  if (r.status === "negado") return incerto("DENEGACAO_REQUER_ANALISE");
  if (r.status === "erro_autorizacao") {
    const erros = Array.isArray(r.erros) ? r.erros : [];
    // DPS já existente pode representar uma nota autorizada fora desta referência.
    // Não disponibilizar reemissão até investigar no portal do órgão/provedor.
    if (erros.some((e) => e && typeof e === "object" && /E0014|duplic|j[aá] existe|j[aá] autorizad/i.test(JSON.stringify(e)))) return incerto("DPS_EXISTENTE");
    const codigo = erros[0] && typeof erros[0] === "object" ? textoSeguro(erros[0].codigo, 40) : undefined;
    return { status: "REJEITADA", erroCodigo: codigo && /^[A-Za-z0-9_.-]+$/.test(codigo) ? codigo : "REJEICAO_FISCAL", erroMensagem: "Documento rejeitado pelo autorizador. Consulte os detalhes no painel fiscal do provedor antes de corrigir este mesmo rascunho." };
  }
  return incerto("STATUS_NAO_RECONHECIDO");
}

function incerto(codigo: string): RetornoFiscal {
  return { status: "INCERTA", erroCodigo: codigo, erroMensagem: "Não foi possível confirmar o resultado. Consulte a referência original; não gere outra nota para a mesma prestação." };
}

async function lerJsonLimitado(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Resposta vazia");
  const reader = response.body.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    tamanho += value.byteLength;
    if (tamanho > 1_048_576) { await reader.cancel(); throw new Error("Resposta excede limite"); }
    partes.push(value);
  }
  return JSON.parse(Buffer.concat(partes).toString("utf8"));
}

/** Hosts fixos, sem redirecionamentos, sem repetição automática e sem log de payload/token. */
export async function chamarFocusFiscal(op: "EMITIR" | "CONSULTAR", ambiente: string, referencia: string, cnpj: string, payload?: PayloadFiscal): Promise<RetornoFiscal> {
  const ambienteValidado = ambienteFiscal(ambiente);
  if (!/^BRISA[a-f0-9]{32}$/.test(referencia)) throw new ErroFiscal("Referência fiscal inválida.");
  const token = process.env[`FOCUS_NFSE_TOKEN_${ambienteValidado}`]?.trim();
  if (!token || token.length > 1000 || /[\s:]/.test(token)) throw new ErroFiscal("Configure o token fiscal deste ambiente no servidor.");
  if (op === "EMITIR" && ambienteValidado === "PRODUCAO" && process.env.FISCAL_EMISSAO_PRODUCAO !== "1") throw new ErroFiscal("Emissão em produção bloqueada pelo servidor.");
  const caminho = op === "EMITIR" ? `/v2/nfsen?ref=${referencia}` : `/v2/nfsen/${referencia}`;
  try {
    const response = await fetch(`${BASES[ambienteValidado]}${caminho}`, {
      method: op === "EMITIR" ? "POST" : "GET", cache: "no-store", redirect: "error",
      headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`, Accept: "application/json", ...(op === "EMITIR" ? { "Content-Type": "application/json" } : {}) },
      ...(op === "EMITIR" ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      // Só a pré-validação síncrona documentada é falha definitiva. Conflitos e
      // 5xx/timeout podem ter sido aceitos antes de o resultado se perder.
      if (op === "EMITIR" && [400, 422].includes(response.status)) {
        const body = await lerJsonLimitado(response) as Record<string, unknown>;
        if (/duplic|j[aá] existe|j[aá] autorizad|refer[eê]ncia.*utilizad/i.test(JSON.stringify(body))) return incerto("REFERENCIA_EXISTENTE");
        return { status: "REJEITADA", erroCodigo: `HTTP_${response.status}`, erroMensagem: "Pré-validação recusada pelo provedor. Verifique o cadastro fiscal e corrija este mesmo rascunho." };
      }
      return incerto(response.status === 404 ? "REFERENCIA_NAO_LOCALIZADA" : `HTTP_${response.status}`);
    }
    return normalizarRetornoFiscal(await lerJsonLimitado(response), referencia, cnpj);
  } catch { return incerto("COMUNICACAO_INCONCLUSIVA"); }
}
