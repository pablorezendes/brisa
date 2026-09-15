import { describe, expect, it } from "vitest";
import {
  CAMPOS_CONVENIO_CONTA_PRINCIPAL_SICOOB,
  CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO,
  CONFIGURACAO_LAYOUT_SICOOB_LEGADO,
  camposAuditoriaLegadaAusentes,
  camposConvenioAusentes,
} from "./layout-sicoob-legado";

describe("snapshot do layout Sicoob legado", () => {
  it("mantém somente parâmetros não secretos e os quatro campos de mensagem vazios", () => {
    expect(CONFIGURACAO_LAYOUT_SICOOB_LEGADO).toMatchObject({
      layoutLegadoId: 2,
      nomeLayoutLegado: "Sicoob Brisa Azul",
      contaLiquidacaoLegadoId: 3,
      bancoLegadoId: 12,
      ativaLegado: true,
      padraoLegado: true,
      sistemaOrigem: "WIDESYS",
      agenciaRemessa: "3299",
      numeroContaPixLegado: "11800",
      numeroContaRemessaLegado: "11800",
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
      bancoEmite: false,
      bancoDespacha: false,
      exibirServicos: true,
      usoAutorizado: false,
      mostrarIptu: false,
      avisoDeposito: false,
      lancarTarifa: false,
      planoContaLegadoId: 78,
    });
    expect(JSON.parse(CONFIGURACAO_LAYOUT_SICOOB_LEGADO.mensagens)).toEqual([]);
    expect(CAMPOS_CONVENIO_CONTA_PRINCIPAL_SICOOB).not.toHaveProperty(
      "codigoModalidade",
    );

    const chaves = Object.keys(CONFIGURACAO_LAYOUT_SICOOB_LEGADO).join(" ").toLowerCase();
    expect(chaves).not.toMatch(/client.?id|pfx|certificado|senha|passphrase|token/);
  });

  it("preenche todos os dados operacionais quando ainda estão ausentes", () => {
    expect(
      camposConvenioAusentes({
        numeroCliente: null,
        numeroContaCorrenteApi: null,
        codigoEspecieDocumento: null,
      }),
    ).toEqual(CAMPOS_CONVENIO_CONTA_PRINCIPAL_SICOOB);
  });

  it("completa a auditoria histórica sem sobrescrever valores já revisados", () => {
    expect(
      camposAuditoriaLegadaAusentes({
        nomeLayoutLegado: null,
        contaLiquidacaoLegadoId: null,
        bancoLegadoId: null,
        ativaLegado: null,
        padraoLegado: null,
        numeroContaPixLegado: null,
        numeroContaRemessaLegado: null,
        bancoEmite: null,
        bancoDespacha: null,
      }),
    ).toEqual(CAMPOS_AUDITORIA_LAYOUT_SICOOB_LEGADO);

    expect(
      camposAuditoriaLegadaAusentes({
        nomeLayoutLegado: "Revisado",
        contaLiquidacaoLegadoId: 99,
        bancoLegadoId: 98,
        ativaLegado: false,
        padraoLegado: false,
        numeroContaPixLegado: "1",
        numeroContaRemessaLegado: "2",
        bancoEmite: true,
        bancoDespacha: true,
      }),
    ).toEqual({});
  });

  it("preserva os valores que já foram configurados", () => {
    expect(
      camposConvenioAusentes({
        numeroCliente: "revisado",
        numeroContaCorrenteApi: null,
        codigoEspecieDocumento: "RC",
      }),
    ).toEqual({ numeroContaCorrenteApi: "11800" });
  });
});
