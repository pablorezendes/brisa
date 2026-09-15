import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  chaveIdempotenciaLiquidacaoSicoob,
  decodificarArquivoLiquidacoesSicoob,
  ErroArquivoMovimentacaoSicoob,
  processarRespostaArquivoLiquidacoesSicoob,
} from "./movimentacoes";

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function criarZip(
  nome: string,
  conteudo: Buffer,
  opcoes: { comprimir?: boolean; crc?: number } = {},
): Buffer {
  const nomeBytes = Buffer.from(nome, "utf8");
  const metodo = opcoes.comprimir === false ? 0 : 8;
  const comprimido = metodo === 8 ? deflateRawSync(conteudo) : conteudo;
  const checksum = opcoes.crc ?? crc32(conteudo);
  const flags = 0x0800;

  const local = Buffer.alloc(30 + nomeBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(metodo, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(comprimido.length, 18);
  local.writeUInt32LE(conteudo.length, 22);
  local.writeUInt16LE(nomeBytes.length, 26);
  nomeBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nomeBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(metodo, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(comprimido.length, 20);
  central.writeUInt32LE(conteudo.length, 24);
  central.writeUInt16LE(nomeBytes.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  nomeBytes.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + comprimido.length, 16);

  return Buffer.concat([local, comprimido, central, eocd]);
}

function movimento(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    codigoTipoMovimento: 5,
    siglaMovimento: "LIQUI",
    dataInicioMovimento: "2026-09-15T00:00:00-03:00",
    dataFimMovimento: "2026-09-15T23:59:59-03:00",
    numeroCliente: 123456,
    numeroContrato: 987654,
    modalidade: 1,
    numeroTitulo: 1004,
    seuNumero: "REC-42",
    dataVencimentoTitulo: "2026-09-10T00:00:00-03:00",
    valorTitulo: 156.23,
    codigoBarras: "75600000000000000000000000000000000000000001",
    dataMovimentoLiquidacao: "2026-09-15T10:30:00-03:00",
    dataLiquidacao: "2026-09-15T10:29:00-03:00",
    dataPrevisaoCredito: "2026-09-16T00:00:00-03:00",
    numeroBancoRecebedor: 756,
    numeroAgenciaRecebedora: 3299,
    numeroContaCorrente: 1180,
    idTipoOpFinanceira: 212,
    tipoOpFinanceira: "07 - Via Pix",
    valorAbatimento: 0,
    valorDesconto: 1.23,
    valorMora: 0,
    valorLiquido: 155,
    valorTarifaMovimento: 0,
    tipoCarteiraOpCredito: "COBRANÇA",
    ...overrides,
  };
}

function envelope(
  registros: unknown[],
  opcoes: { nomeZip?: string; nomeJson?: string; comprimir?: boolean; crc?: number } = {},
) {
  const zip = criarZip(
    opcoes.nomeJson ?? "LIQUI_123456_1.json",
    Buffer.from(JSON.stringify(registros), "utf8"),
    { comprimir: opcoes.comprimir, crc: opcoes.crc },
  );
  return {
    resultado: {
      arquivo: zip.toString("base64"),
      nomeArquivo: opcoes.nomeZip ?? "LIQUI_123456_1.zip",
    },
  };
}

const contexto = {
  numeroCliente: 123456,
  codigoSolicitacao: "132",
  idArquivo: "30025254",
};

describe("arquivo de movimentação 5/LIQUI", () => {
  it("valida envelope, descompacta Deflate e normaliza valores críticos", () => {
    const arquivo = processarRespostaArquivoLiquidacoesSicoob(
      envelope([movimento()]),
      contexto,
    );

    expect(arquivo).toMatchObject({
      idArquivo: "30025254",
      nomeArquivo: "LIQUI_123456_1.zip",
      nomeEntrada: "LIQUI_123456_1.json",
      quantidadeRegistros: 1,
    });
    expect(arquivo.liquidacoes[0]).toMatchObject({
      codigoTipoMovimento: 5,
      siglaMovimento: "LIQUI",
      numeroCliente: 123456,
      codigoModalidade: 1,
      numeroTitulo: "1004",
      seuNumero: "REC-42",
      valorTituloCentavos: 15_623,
      valorLiquidoCentavos: 15_500,
      valorDescontoCentavos: 123,
      dataLiquidacao: "2026-09-15T13:29:00.000Z",
    });
  });

  it("também aceita o método Store e gera chave idempotente estável", () => {
    const arquivo = processarRespostaArquivoLiquidacoesSicoob(
      envelope([movimento()], { comprimir: false }),
      contexto,
    );
    const primeira = chaveIdempotenciaLiquidacaoSicoob(arquivo.liquidacoes[0]);
    const segunda = chaveIdempotenciaLiquidacaoSicoob(arquivo.liquidacoes[0]);

    expect(primeira).toBe(segunda);
    expect(primeira).toMatch(/^sicoob-liqui-v1:[a-f0-9]{64}$/);
  });

  it("rejeita Base64 permissivo, nomes com path e envelopes inesperados", () => {
    expect(() =>
      decodificarArquivoLiquidacoesSicoob("UEsD BA==", {
        numeroCliente: 123456,
        idArquivo: "1",
        nomeArquivo: "LIQUI.zip",
      }),
    ).toThrowError(ErroArquivoMovimentacaoSicoob);
    expect(() =>
      processarRespostaArquivoLiquidacoesSicoob(
        envelope([movimento()], { nomeJson: "../LIQUI.json" }),
        contexto,
      ),
    ).toThrow(/inseguro/);
    expect(() => processarRespostaArquivoLiquidacoesSicoob({}, contexto)).toThrow(
      /envelope inválido/,
    );
  });

  it("rejeita ZIP adulterado, excesso de entradas e taxa de compressão suspeita", () => {
    expect(() =>
      processarRespostaArquivoLiquidacoesSicoob(
        envelope([movimento()], { comprimir: false, crc: 123 }),
        contexto,
      ),
    ).toThrow(/Integridade CRC/);

    const duasEntradasDeclaradas = envelope([movimento()]);
    const zip = Buffer.from(duasEntradasDeclaradas.resultado.arquivo, "base64");
    zip.writeUInt16LE(2, zip.length - 14);
    zip.writeUInt16LE(2, zip.length - 12);
    duasEntradasDeclaradas.resultado.arquivo = zip.toString("base64");
    expect(() =>
      processarRespostaArquivoLiquidacoesSicoob(duasEntradasDeclaradas, contexto),
    ).toThrow(/exatamente um arquivo JSON/);

    expect(() =>
      processarRespostaArquivoLiquidacoesSicoob(envelope([movimento()]), contexto, {
        maximoTaxaCompressao: 1,
      }),
    ).toThrow(/Taxa de compressão suspeita/);
  });

  it("falha fechado para movimento não LIQUI ou cliente divergente", () => {
    expect(() =>
      processarRespostaArquivoLiquidacoesSicoob(
        envelope([movimento({ codigoTipoMovimento: 6, siglaMovimento: "BAIX" })]),
        contexto,
      ),
    ).toThrow(/movimento diferente/);
    expect(() =>
      processarRespostaArquivoLiquidacoesSicoob(
        envelope([movimento({ numeroCliente: 999999 })]),
        contexto,
      ),
    ).toThrow(/outro número de cliente/);
  });

  it("rejeita campos críticos ausentes, estrutura aninhada e limite de registros", () => {
    expect(() =>
      processarRespostaArquivoLiquidacoesSicoob(
        envelope([movimento({ valorLiquido: undefined })]),
        contexto,
      ),
    ).toThrow(/valorLiquido inválido/);
    expect(() =>
      processarRespostaArquivoLiquidacoesSicoob(
        envelope([movimento({ campoNovo: { inesperado: true } })]),
        contexto,
      ),
    ).toThrow(/layout JSON plano/);
    expect(() =>
      processarRespostaArquivoLiquidacoesSicoob(
        envelope([movimento(), movimento({ numeroTitulo: 1005 })]),
        contexto,
        { maximoRegistros: 1 },
      ),
    ).toThrow(/limite de registros/);
  });
});
