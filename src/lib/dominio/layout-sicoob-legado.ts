export const CAMPOS_CONVENIO_CONTA_PRINCIPAL_SICOOB = {
  numeroCliente: "20060",
  numeroContaCorrenteApi: "11800",
  codigoEspecieDocumento: "DS",
} as const;

export const CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO = {
  nomeLayoutLegado: "Sicoob Brisa Azul",
  contaLiquidacaoLegadoId: 3,
  bancoLegadoId: 12,
  ativaLegado: true,
  padraoLegado: true,
  numeroContaPixLegado: "11800",
  numeroContaRemessaLegado: "11800",
  bancoEmite: false,
  bancoDespacha: false,
} as const;

// A carteira 1 é um dado do layout legado. O campo legado de modalidade de
// cobrança estava vazio, portanto não inferimos codigoModalidade da API.
export const CONFIGURACAO_LAYOUT_SICOOB_LEGADO = {
  layoutLegadoId: 2,
  ...CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO,
  sistemaOrigem: "WIDESYS",
  capturadoEm: new Date("2026-09-15T00:00:00-03:00"),
  agenciaRemessa: "3299",
  numeroContaCorrenteApi: "11800",
  carteiraLegada: "1",
  convenioLegado: null,
  modalidadeCobrancaLegada: null,
  numeroCliente: "20060",
  codigoEspecieDocumento: "DS",
  aceite: "N",
  moeda: "R$",
  protestoAutomaticoLegado: null,
  diasProtesto: 0,
  ultimoNossoNumeroLegado: 41675,
  loteLegado: 1,
  escopos: "boletos_inclusao boletos_consulta boletos_alteracao",
  toleranciaPagamentoDias: 60,
  protestoEmDiasUteis: false,
  correspondente: "API",
  bancoNumera: false,
  mensagens: "[]",
  exibirServicos: true,
  usoAutorizado: false,
  mostrarIptu: false,
  avisoDeposito: false,
  lancarTarifa: false,
  planoContaLegadoId: 78,
} as const;

type CamposAuditoriaAtuais = {
  nomeLayoutLegado: string | null;
  contaLiquidacaoLegadoId: number | null;
  bancoLegadoId: number | null;
  ativaLegado: boolean | null;
  padraoLegado: boolean | null;
  numeroContaPixLegado: string | null;
  numeroContaRemessaLegado: string | null;
  bancoEmite: boolean | null;
  bancoDespacha: boolean | null;
};

/** Completa somente colunas de auditoria adicionadas depois do primeiro import. */
export function camposAuditoriaLegadaAusentes(conta: CamposAuditoriaAtuais) {
  return {
    ...(conta.nomeLayoutLegado === null
      ? { nomeLayoutLegado: CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO.nomeLayoutLegado }
      : {}),
    ...(conta.contaLiquidacaoLegadoId === null
      ? { contaLiquidacaoLegadoId: CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO.contaLiquidacaoLegadoId }
      : {}),
    ...(conta.bancoLegadoId === null
      ? { bancoLegadoId: CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO.bancoLegadoId }
      : {}),
    ...(conta.ativaLegado === null
      ? { ativaLegado: CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO.ativaLegado }
      : {}),
    ...(conta.padraoLegado === null
      ? { padraoLegado: CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO.padraoLegado }
      : {}),
    ...(conta.numeroContaPixLegado === null
      ? { numeroContaPixLegado: CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO.numeroContaPixLegado }
      : {}),
    ...(conta.numeroContaRemessaLegado === null
      ? { numeroContaRemessaLegado: CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO.numeroContaRemessaLegado }
      : {}),
    ...(conta.bancoEmite === null
      ? { bancoEmite: CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO.bancoEmite }
      : {}),
    ...(conta.bancoDespacha === null
      ? { bancoDespacha: CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO.bancoDespacha }
      : {}),
  };
}

type CamposConvenioAtuais = {
  numeroCliente: string | null;
  numeroContaCorrenteApi: string | null;
  codigoEspecieDocumento: string | null;
};

/**
 * Retorna apenas dados ainda ausentes. Um valor já revisado no Brisa nunca é
 * substituído pelo snapshot raspado do sistema legado.
 */
export function camposConvenioAusentes(conta: CamposConvenioAtuais) {
  return {
    ...(conta.numeroCliente === null
      ? { numeroCliente: CAMPOS_CONVENIO_CONTA_PRINCIPAL_SICOOB.numeroCliente }
      : {}),
    ...(conta.numeroContaCorrenteApi === null
      ? {
          numeroContaCorrenteApi:
            CAMPOS_CONVENIO_CONTA_PRINCIPAL_SICOOB.numeroContaCorrenteApi,
        }
      : {}),
    ...(conta.codigoEspecieDocumento === null
      ? {
          codigoEspecieDocumento:
            CAMPOS_CONVENIO_CONTA_PRINCIPAL_SICOOB.codigoEspecieDocumento,
        }
      : {}),
  };
}
