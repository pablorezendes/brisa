/**
 * Parte não secreta da configuração de cobrança necessária para registrar um
 * boleto. O tipo é estrutural de propósito: o domínio não depende do Prisma.
 */
export type ConfiguracaoPoliticaCobrancaSicoob = {
  aceite: unknown;
  toleranciaPagamentoDias: unknown;
  diasProtesto: unknown;
  protestoEmDiasUteis: unknown;
  mensagens: unknown;
};

export type PoliticaEmissaoSicoob = {
  aceite: boolean;
  dataLimitePagamento?: string;
  mensagensInstrucao?: string[];
  politica: {
    codigoProtesto: 1 | 2 | 3;
    numeroDiasProtesto?: number;
  };
};

export class ErroPoliticaCobrancaSicoob extends TypeError {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroPoliticaCobrancaSicoob";
  }
}

function inteiroNoIntervalo(
  valor: unknown,
  campo: string,
  maximo: number,
): number {
  if (
    !Number.isSafeInteger(valor) ||
    (valor as number) < 0 ||
    (valor as number) > maximo
  ) {
    throw new ErroPoliticaCobrancaSicoob(
      `${campo} deve ser um inteiro entre 0 e ${maximo}.`,
    );
  }
  return valor as number;
}

function dataCivil(valor: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!match) {
    throw new ErroPoliticaCobrancaSicoob(
      "Data de vencimento deve usar o formato AAAA-MM-DD.",
    );
  }

  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const data = new Date(0);
  data.setUTCHours(0, 0, 0, 0);
  data.setUTCFullYear(ano, mes - 1, dia);
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    throw new ErroPoliticaCobrancaSicoob(
      "Data de vencimento contém uma data inexistente.",
    );
  }
  return data;
}

function adicionarDiasCivis(dataIso: string, dias: number): string {
  const data = dataCivil(dataIso);
  data.setUTCDate(data.getUTCDate() + dias);
  const ano = data.getUTCFullYear();
  if (!Number.isFinite(data.getTime()) || ano < 0 || ano > 9999) {
    throw new ErroPoliticaCobrancaSicoob(
      "Tolerância de pagamento resulta em uma data fora do intervalo aceito.",
    );
  }
  return `${String(ano).padStart(4, "0")}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
}

function normalizarMensagens(valor: unknown): string[] {
  if (typeof valor !== "string") {
    throw new ErroPoliticaCobrancaSicoob(
      "Mensagens da cobrança devem estar armazenadas como uma lista JSON.",
    );
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(valor);
  } catch {
    throw new ErroPoliticaCobrancaSicoob(
      "Mensagens da cobrança contêm um JSON inválido.",
    );
  }
  if (!Array.isArray(bruto)) {
    throw new ErroPoliticaCobrancaSicoob(
      "Mensagens da cobrança devem formar uma lista JSON.",
    );
  }
  if (bruto.length > 5) {
    throw new ErroPoliticaCobrancaSicoob(
      "A cobrança aceita no máximo 5 mensagens de instrução.",
    );
  }

  return bruto.map((mensagem, indice) => {
    if (typeof mensagem !== "string") {
      throw new ErroPoliticaCobrancaSicoob(
        `Mensagem ${indice + 1} da cobrança deve ser um texto.`,
      );
    }
    const limpa = mensagem.trim();
    if (!limpa) {
      throw new ErroPoliticaCobrancaSicoob(
        `Mensagem ${indice + 1} da cobrança não pode estar vazia.`,
      );
    }
    if (limpa.length > 40) {
      throw new ErroPoliticaCobrancaSicoob(
        `Mensagem ${indice + 1} da cobrança deve ter no máximo 40 caracteres.`,
      );
    }
    return limpa;
  });
}

/**
 * Converte o registro persistido em um snapshot pronto para o payload Sicoob.
 * Sem configuração, aplica uma política deliberadamente conservadora.
 */
export function resolverPoliticaEmissaoSicoob(
  configuracao: ConfiguracaoPoliticaCobrancaSicoob | null | undefined,
  dataVencimento: string,
): PoliticaEmissaoSicoob {
  dataCivil(dataVencimento);
  if (!configuracao) {
    return {
      aceite: false,
      politica: { codigoProtesto: 3 },
    };
  }

  if (typeof configuracao.aceite !== "string") {
    throw new ErroPoliticaCobrancaSicoob("Aceite deve ser S ou N.");
  }
  const aceiteNormalizado = configuracao.aceite.trim().toUpperCase();
  if (aceiteNormalizado !== "S" && aceiteNormalizado !== "N") {
    throw new ErroPoliticaCobrancaSicoob("Aceite deve ser S ou N.");
  }
  if (typeof configuracao.protestoEmDiasUteis !== "boolean") {
    throw new ErroPoliticaCobrancaSicoob(
      "A opção de protesto em dias úteis deve ser verdadeira ou falsa.",
    );
  }

  const tolerancia = inteiroNoIntervalo(
    configuracao.toleranciaPagamentoDias,
    "Tolerância de pagamento",
    180,
  );
  const diasProtesto = inteiroNoIntervalo(
    configuracao.diasProtesto,
    "Dias para protesto",
    99,
  );
  const mensagens = normalizarMensagens(configuracao.mensagens);

  return {
    aceite: aceiteNormalizado === "S",
    ...(tolerancia > 0
      ? { dataLimitePagamento: adicionarDiasCivis(dataVencimento, tolerancia) }
      : {}),
    ...(mensagens.length > 0 ? { mensagensInstrucao: mensagens } : {}),
    politica:
      diasProtesto === 0
        ? { codigoProtesto: 3 }
        : {
            codigoProtesto: configuracao.protestoEmDiasUteis ? 2 : 1,
            numeroDiasProtesto: diasProtesto,
          },
  };
}

/** Representação estável usada para detectar mudanças entre duas leituras. */
export function assinaturaPoliticaEmissaoSicoob(
  politica: PoliticaEmissaoSicoob,
): string {
  return JSON.stringify(politica);
}
