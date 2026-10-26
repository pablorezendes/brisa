import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { FonteUnificacao } from "../unificacao/tipos";
vi.mock("server-only", () => ({}));
import { apresentarClassificacaoDespesa, carregarClassificacoesApresentacao } from "./classificacao-apresentacao";

const fonte: FonteUnificacao = {
  chave: "WIDESYS:PAGAR:titulo", dominio: "PAGAR", origem: "WIDESYS", origemId: "titulo", titulo: "Fornecedor sintético",
  descricao: "PIX · Plano original Widesys", href: null, hash: "hash-financeiro-original", nomeNorm: "FORNECEDOR",
  qualidade: "OK", motivos: [], campos: { plano: { rotulo: "Plano de contas", valor: "Plano original Widesys" } },
  valor: 12300, pago: 12300, aberto: 0,
};
const overlay = { origemChave: fonte.chave, categoriaCodigo: "PROGRAMA_WIDESYS", destinoCusto: "ADMINISTRADORA", restrita: false };
function banco(documentos = [overlay]) {
  const findMany = vi.fn().mockResolvedValue(documentos);
  return { db: { despesaDocumento: { findMany } } as unknown as Pick<PrismaClient, "despesaDocumento">, findMany };
}

describe("classificação local apenas na apresentação do Widesys", () => {
  it("carrega uma vez por chaves autorizadas e distintas, sem ler anexos, valores ou snapshots", async () => {
    const { db, findMany } = banco();
    const classificacoes = await carregarClassificacoesApresentacao(db, [fonte, fonte, { ...fonte, origem: "BRISA", chave: "BRISA:PAGAR:manual" }], "FINANCEIRO");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({ where: { origemChave: { in: [fonte.chave] }, categoriaCodigo: { not: null }, restrita: false },
      select: { origemChave: true, categoriaCodigo: true, categoriaRotulo: true, destinoCusto: true, restrita: true } });
    expect(classificacoes.get(fonte.chave)).toEqual({ categoria: "Programa Widesys", responsavel: "Administradora" });
  });

  it("preserva hash, valores e plano da origem sem alterar a fotografia compartilhada", async () => {
    const { db } = banco();
    const antes = structuredClone(fonte);
    const classificacoes = await carregarClassificacoesApresentacao(db, [fonte], "FINANCEIRO");
    const apresentada = apresentarClassificacaoDespesa(fonte, classificacoes);
    expect(fonte).toEqual(antes);
    expect(apresentada).toMatchObject({ hash: fonte.hash, valor: 12300, pago: 12300, aberto: 0, campos: { plano: fonte.campos.plano } });
    expect(apresentada.descricao).toBe("Categoria no Brisa: Programa Widesys · Custo no Brisa: Administradora · PIX · Plano original Widesys");
    expect(apresentada.campos.categoriaBrisa.valor).toBe("Programa Widesys");
    expect(apresentada.campos.responsavelCustoBrisa.valor).toBe("Administradora");
    expect(JSON.stringify(apresentada)).not.toContain("Conferido");
  });

  it.each(["SOCIO", "CONTABILIDADE", "CONSULTA"])("não consulta metadados de acesso integral para perfil %s", async perfil => {
    const { db, findMany } = banco();
    expect((await carregarClassificacoesApresentacao(db, [fonte], perfil)).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("não faz consulta para outros domínios ou página sem Widesys", async () => {
    const { db, findMany } = banco();
    await carregarClassificacoesApresentacao(db, [{ ...fonte, dominio: "RECEBER" }, { ...fonte, origem: "BRISA" }], "ADMINISTRADOR");
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([{ restrita: true }, { categoriaCodigo: "ADMINISTRACAO_COMISSAO" }])("financeiro não recebe categoria reservada mesmo se retornada pelo banco (%j)", async extra => {
    const { db } = banco([{ ...overlay, ...extra }]);
    const classificacoes = await carregarClassificacoesApresentacao(db, [fonte], "FINANCEIRO");
    expect(classificacoes.size).toBe(0);
    expect(apresentarClassificacaoDespesa(fonte, classificacoes)).toBe(fonte);
  });

  it("administrador recebe sua categoria restrita, sem expandir chaves fora da seleção", async () => {
    const { db } = banco([{ ...overlay, categoriaCodigo: "ADMINISTRACAO_COMISSAO", restrita: true }, { ...overlay, origemChave: "WIDESYS:PAGAR:fora" }]);
    const classificacoes = await carregarClassificacoesApresentacao(db, [fonte], "ADMINISTRADOR");
    expect([...classificacoes.keys()]).toEqual([fonte.chave]);
    expect(classificacoes.get(fonte.chave)?.categoria).toBe("Administração / comissão");
  });

  it("não infere categoria por nome nem por grupo antigo", async () => {
    const { db } = banco([{ ...overlay, categoriaCodigo: "333" }]);
    expect((await carregarClassificacoesApresentacao(db, [fonte], "ADMINISTRADOR")).size).toBe(0);
  });
});
