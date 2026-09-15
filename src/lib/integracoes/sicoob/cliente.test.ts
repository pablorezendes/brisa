import { beforeEach, describe, expect, it, vi } from "vitest";

const requisicaoHttpsJson = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("./http", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("./http")>();
  return { ...original, requisicaoHttpsJson };
});

import { ClienteSicoob } from "./cliente";
import type { ConfiguracaoSicoob } from "./configuracao";

const configuracao: ConfiguracaoSicoob = {
  ambiente: "sandbox",
  baseUrl: "https://sandbox.sicoob.test/cobranca-bancaria/v3",
  tokenUrl: null,
  clientId: "cliente-de-teste",
  clientSecret: null,
  tokenAuth: "body",
  scopes: "boletos_consulta",
  accessTokenEstatico: "token-estatico-de-teste",
  timeoutMs: 1_000,
  tls: {},
  cacheTokenId: "teste",
};

describe("cliente Sicoob — movimentações e webhook", () => {
  beforeEach(() => requisicaoHttpsJson.mockReset());

  it("aceita duas datas inclusivas e rejeita janela de três datas", async () => {
    const cliente = new ClienteSicoob(configuracao);
    await expect(
      cliente.solicitarMovimentacoesLiquidacao({
        numeroCliente: 123,
        dataInicial: "2026-09-13",
        dataFinal: "2026-09-15",
      }),
    ).rejects.toThrow(/no máximo dois dias/);

    requisicaoHttpsJson.mockResolvedValueOnce({
      status: 200,
      headers: {},
      corpo: { resultado: { codigoSolicitacao: 99, mensagem: "recebida" } },
    });
    await expect(
      cliente.solicitarMovimentacoesLiquidacao({
        numeroCliente: 123,
        dataInicial: "2026-09-14",
        dataFinal: "2026-09-15",
      }),
    ).resolves.toMatchObject({ codigoSolicitacao: "99" });
  });

  it("mantém o polling quando a consulta assíncrona ainda retorna HTTP 204", async () => {
    requisicaoHttpsJson.mockResolvedValueOnce({ status: 204, headers: {}, corpo: null });
    const estado = await new ClienteSicoob(configuracao).consultarMovimentacoes(123, "99");
    expect(estado).toEqual({
      pronto: false,
      semRegistros: true,
      quantidadeArquivos: 0,
      quantidadeTotalRegistros: 0,
      idsArquivos: [],
    });
  });

  it("rejeita resposta parcial ou IDs de arquivo duplicados", async () => {
    const cliente = new ClienteSicoob(configuracao);
    requisicaoHttpsJson.mockResolvedValueOnce({
      status: 200,
      headers: {},
      corpo: {
        resultado: {
          quantidadeArquivo: 2,
          quantidadeTotalRegistros: 10,
          idArquivos: [7],
        },
      },
    });
    await expect(cliente.consultarMovimentacoes(123, "99")).rejects.toThrow(
      /lista parcial/,
    );

    requisicaoHttpsJson.mockResolvedValueOnce({
      status: 200,
      headers: {},
      corpo: {
        resultado: {
          quantidadeArquivo: 2,
          quantidadeTotalRegistros: 10,
          idArquivos: [7, 7],
        },
      },
    });
    await expect(cliente.consultarMovimentacoes(123, "99")).rejects.toThrow(
      /arquivos duplicados/,
    );
  });

  it("consulta e normaliza o estado confirmado do webhook", async () => {
    requisicaoHttpsJson.mockResolvedValueOnce({
      status: 200,
      headers: {},
      corpo: {
        resultado: [
          {
            idWebhook: 42,
            url: "https://brisa.test/api/webhook",
            codigoTipoMovimento: 7,
            codigoSituacao: 2,
          },
        ],
      },
    });
    await expect(
      new ClienteSicoob(configuracao).consultarWebhookBaixaOperacional("42"),
    ).resolves.toEqual({
      idWebhook: "42",
      url: "https://brisa.test/api/webhook",
      codigoSituacao: 2,
      status: "VALIDADO",
      statusConfirmado: true,
    });
  });
});
