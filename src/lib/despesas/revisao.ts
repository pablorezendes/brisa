import type { PrismaClient } from "@prisma/client";
import { autorizarRevisaoFinanceira, concluirRevisaoFinanceira, obterRevisaoFinanceiraNaTransacao } from "../unificacao/revisao-financeira";
import { ErroDespesa } from "./tipos";
import type { ConcluirRevisaoDespesaEntrada, RevisaoDespesa } from "./tipos-revisao";

type Ator = { id: string };

export async function obterRevisaoDespesa(db: PrismaClient, selecao: { id?: string; origemChave?: string }, ator: Ator): Promise<RevisaoDespesa | null> {
  return db.$transaction(async tx => {
    await autorizarRevisaoFinanceira(tx, ator, "PAGAR");
    if (!selecao.id && !selecao.origemChave) return null;
    if ((selecao.id && (typeof selecao.id !== "string" || selecao.id.length > 100))
      || (selecao.origemChave && !/^WIDESYS:PAGAR:[^\s:]{1,150}$/.test(selecao.origemChave))) throw new ErroDespesa("ORIGEM_INVALIDA", "Reabra uma conta a pagar válida.");
    const documento = selecao.id ? await tx.despesaDocumento.findUnique({ where: { id: selecao.id }, select: { id: true, origemChave: true } }) : null;
    if (selecao.id && !documento) throw new ErroDespesa("NAO_ENCONTRADA", "A despesa não foi encontrada.");
    if (documento && selecao.origemChave && documento.origemChave !== selecao.origemChave) throw new ErroDespesa("ORIGEM_INVALIDA", "A despesa não corresponde à origem escolhida.");
    const chave = documento?.origemChave ?? selecao.origemChave ?? `BRISA:PAGAR:${documento!.id}`;
    return obterRevisaoFinanceiraNaTransacao(tx, { chave }, ator);
  }, { maxWait: 5000, timeout: 20000 });
}

export async function concluirRevisaoDespesa(db: PrismaClient, entrada: ConcluirRevisaoDespesaEntrada, ator: Ator): Promise<{ estado: "ATIVO" | "VINCULADO"; revisao: RevisaoDespesa }> {
  if (!entrada || !/^(BRISA|WIDESYS):PAGAR:[^\s:]{1,150}$/.test(entrada.chave)) throw new ErroDespesa("DADOS_INVALIDOS", "Reabra uma conta a pagar válida.");
  return concluirRevisaoFinanceira(db, entrada, ator);
}
