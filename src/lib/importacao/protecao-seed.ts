import { Prisma, type PrismaClient } from "@prisma/client";

// Lista fixa: nomes vindos do catálogo do SQLite nunca entram diretamente no SQL.
// Usuários e contas bancárias de bootstrap não são dados da carga de planilhas.
const TABELAS_PROTEGIDAS = [
  "Empreendimento", "Unidade", "Locatario", "Contrato", "Recebimento",
  "ParametroComissao", "FechamentoMensal", "UnidadeTemporada", "Limpeza",
  "DespesaTemporada", "RecebimentoTemporada", "ApuracaoTemporadaHistorica",
  "LancamentoCaixa", "CategoriaCentroCusto", "Pessoa", "PessoaPapel",
  "PessoaEmail", "PessoaTelefone", "ImovelLegado", "ImovelProprietarioLegado",
  "ImportacaoLegadoLote", "ImportacaoLegadoItem", "ContratoLegado",
  "ContratoParteLegado", "TituloFinanceiroLegado", "BaixaFinanceiraLegado",
  "MovimentoFinanceiroLegado", "CatalogoLegadoCaptura", "CatalogoLegadoItem",
  "CatalogoLegadoRegistro", "Boleto", "EventoBoleto", "PagamentoRecebimento",
  "SincronizacaoBancaria", "PerfilIntegracaoSicoob", "UnificacaoRegistro",
] as const;

export class ErroSeedBaseNaoVazia extends Error {
  readonly codigo = "SEED_BASE_NAO_VAZIA";

  constructor(readonly tabelasComDados: string[]) {
    super(
      "Carga inicial de planilhas bloqueada: esta base já contém cadastros, " +
      "operação financeira ou dados importados. Nenhum registro foi alterado. " +
      "Use o fluxo de importação e unificação para incorporar dados; db:seed " +
      "é permitido somente antes da primeira carga, em uma base operacional vazia.",
    );
    this.name = "ErroSeedBaseNaoVazia";
  }
}

/** Verifica também tabelas novas sem exigir que o Prisma Client já as conheça. */
export async function exigirBaseVaziaParaSeed(
  prisma: Pick<PrismaClient, "$queryRaw">,
): Promise<void> {
  const tabelas = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `;
  const existentes = new Set(tabelas.map((tabela) => tabela.name));
  const protegidas = TABELAS_PROTEGIDAS.filter((tabela) => existentes.has(tabela));
  if (protegidas.length === 0) return;

  const preenchidas = await prisma.$queryRaw<Array<{ tabela: string }>>(
    Prisma.join(
      protegidas.map((tabela) => Prisma.sql`
        SELECT ${tabela} AS tabela WHERE EXISTS (
          SELECT 1 FROM ${Prisma.raw(`"${tabela}"`)} LIMIT 1
        )
      `),
      " UNION ALL ",
    ),
  );
  if (preenchidas.length > 0) {
    throw new ErroSeedBaseNaoVazia(preenchidas.map((registro) => registro.tabela));
  }
}
