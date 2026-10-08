import { notFound } from "next/navigation";
import { perfilAtual } from "@/lib/autorizacao";
import { acessoAtual } from "@/lib/acesso/servidor";
import { carteiraIrrestrita, pode } from "@/lib/acesso/politica";
import { MOTIVOS_UNIFICACAO } from "@/lib/unificacao/reconciliacao";

export { ESTADOS_UNIFICACAO, EstadoUnificado, OrigensUnificadas } from "@/components/unificacao-visual";

export type ParametrosUnificacao = Record<string, string | string[] | undefined>;
export function primeiroParametro(valor: string | string[] | undefined) { return Array.isArray(valor) ? valor[0] : valor; }
export function mensagemUnificacao(valor: string) { return ({ "analise-atualizada": "Análise local atualizada. Nenhum dado novo foi buscado no Widesys. Confira as correspondências abaixo.", resolvido: "Decisão registrada. A consulta unificada já reflete o resultado." } as Record<string, string>)[valor] ?? valor; }
export function hrefUnificacao(chave: string) { return `/unificacao/${encodeURIComponent(chave)}`; }
export function motivoUnificacao(motivo: string) {
  const correspondencias: Record<string, string> = {
    DOCUMENTO_IGUAL: "Mesmo CPF/CNPJ", NOME_IGUAL: "Mesmo nome", IDENTIFICACAO_IGUAL: "Mesma identificação", ENDERECO_IGUAL: "Mesmo endereço",
    PESSOA_E_IMOVEL: "Mesma pessoa e imóvel", MESMA_PESSOA: "Mesma pessoa", MESMO_IMOVEL: "Mesmo imóvel", ALUGUEL_IGUAL_CONFERIR_IMOVEL: "Mesmo aluguel; conferir imóvel",
    MES_E_VINCULO: "Mesma competência e vínculo cadastral", MES_E_VALOR: "Mesma competência e valor", CONTEUDO_REPETIDO: "Conteúdo repetido", DATA_VALOR_NATUREZA: "Mesma data, valor e natureza", TITULO_DATA_VALOR: "Mesmo título, data e valor", PARAMETRO_IGUAL: "Mesmo parâmetro",
    UNIAO_CONFIRMADA: "Vínculo confirmado na revisão", REGISTRO_DISTINTO_CONFIRMADO: "Registro confirmado como distinto", REVISAO_REABERTA: "Decisão reaberta para revisão",
  };
  return MOTIVOS_UNIFICACAO[motivo] ?? correspondencias[motivo] ?? motivo.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}
export function dataUnificada(data: string | null | undefined) {
  return data && /^\d{4}-\d{2}-\d{2}/.test(data) ? `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}` : data || "—";
}
export async function exigirPerfilUnificacao() {
  if (!await podeAcessarUnificacao()) notFound();
}
export async function podeAcessarUnificacao() {
  const perfil = await perfilAtual();
  const acesso = await acessoAtual();
  return (perfil === "ADMINISTRADOR" || perfil === "FINANCEIRO")
    && carteiraIrrestrita(acesso) && pode(acesso, "cadastros.sensiveis");
}
