"use client";

import { Card, Dinheiro, Kpi, Sigilo } from "@/components/ui";

/** Projeção numérica explícita; não recebe registros, DAL nem o resumo completo da consulta. */
type ResumoOperacaoUnificadaProps = {
  financeiro: boolean;
  movimento: boolean;
  fonteFinanceiraUnica?: boolean;
  devido: number;
  pago: number;
  aberto: number;
  entradas: number;
  saidas: number;
  ativos: number;
  vinculados: number;
  pendentes: number;
  quarentena: number;
  abertoPendente: number;
};

export function ResumoOperacaoUnificada({ financeiro, movimento, fonteFinanceiraUnica, devido, pago, aberto, entradas, saidas, ativos, vinculados, pendentes, quarentena, abertoPendente }: ResumoOperacaoUnificadaProps) {
  if (fonteFinanceiraUnica) return <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Kpi rotulo={financeiro ? "Total devido" : movimento ? "Entradas" : "Baixas disponíveis"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? devido : entradas} /> : ativos} ajuda="Considera os lançamentos válidos do Widesys no período e na busca selecionados." />
    {financeiro || movimento ? <>
      <Kpi rotulo={financeiro ? "Pago / recebido" : "Saídas"} valor={<Dinheiro centavos={financeiro ? pago : saidas} />} ajuda="Valores registrados na captura mais recente do Widesys." />
      <Kpi rotulo={financeiro ? "Saldo em aberto" : "Saldo de movimentos"} valor={<Dinheiro centavos={financeiro ? aberto : entradas - saidas} />} ajuda={financeiro ? "Saldo em aberto dos títulos válidos do Widesys." : "Entradas menos saídas dos movimentos válidos do Widesys."} />
    </> : null}
    <Kpi rotulo="Inconsistências na captura" valor={quarentena} nivel={quarentena ? "atencao" : "otimo"} ajuda="Registros com inconsistências ficam fora dos totais até a correção na origem." />
  </div>;
  return <>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi rotulo={financeiro ? "Devido incluído" : movimento ? "Entradas incluídas" : "Registros disponíveis"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? devido : entradas} /> : ativos} ajuda="Conta os registros atualmente disponíveis, inclusive decisões automáticas. Pendências, quarentena e cópias vinculadas não aumentam o total; inclusão não equivale a auditoria manual." />
      <Kpi rotulo={financeiro ? "Pago / recebido" : movimento ? "Saídas incluídas" : "Fontes vinculadas"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? pago : saidas} /> : vinculados} ajuda="Uma fonte vinculada acrescenta contexto ao registro principal; seus valores não são somados novamente." />
      <Kpi rotulo={financeiro ? "Saldo em aberto" : movimento ? "Saldo consolidado" : "Possíveis duplicidades"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? aberto : entradas - saidas} /> : pendentes} nivel={pendentes ? "atencao" : "neutro"} ajuda="Os totais consideram período, busca e registros aceitos, independentemente do filtro de situação da lista." />
      <Kpi rotulo="Ainda precisam de conferência" valor={pendentes + quarentena} detalhe={`${pendentes} correspondências · ${quarentena} inconsistências`} nivel={pendentes + quarentena ? "atencao" : "otimo"} ajuda="Inclui possíveis duplicatas, decisões a revisar e inconsistências. Nenhum item pendente é incluído automaticamente nos totais." />
    </div>
    {financeiro && abertoPendente > 0 ? <Card nivel="atencao" className="mb-5 flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span className="text-xs text-tinta-suave">Saldo a conferir · possíveis correspondências, fora dos totais consolidados</span><span className="text-sm font-semibold"><Sigilo><Dinheiro centavos={abertoPendente} /></Sigilo></span></Card> : null}
  </>;
}
