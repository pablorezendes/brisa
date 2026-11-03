import type { LinhaUnificada } from "../unificacao/tipos";
import { mesOperacionalUnificado } from "../unificacao/periodo";
import type { CaixaMensal, Pendente } from "../consultas/executivo";

function resumoOrigem() {
  return { receber: 0, devido: 0, recebido: 0, pagar: 0, despesa: 0, pago: 0,
    movimentos: 0, entradas: 0, saidas: 0, vinculados: 0, conciliar: 0, conferidosNaOrigemAConciliar: 0, inconsistentes: 0 };
}

function novoMes(mes: string) {
  const caixa: CaixaMensal = { mes, receita: 0, despesaAL: 0, despesaCH: 0, despesaOutros: 0, dinheiro: 0, saldo: 0 };
  return { mes, devido: 0, recebido: 0, pendentes: 0, pendenteValor: 0, caixa };
}

export function mesPadraoConsolidado(linhas: LinhaUnificada[], hoje: string) {
  const atual = hoje.slice(0, 7);
  let ultimo = "";
  for (const linha of linhas) {
    if (!linha.contabiliza) continue;
    if (!(linha.dominio === "RECEBER" && (linha.pago ?? 0) > 0) && linha.dominio !== "MOVIMENTO") continue;
    const mes = mesOperacionalUnificado(linha);
    if (mes && mes <= atual && mes > ultimo) ultimo = mes;
  }
  return ultimo || atual;
}

/** Os mesmos títulos principais das listas alimentam os totais e sua composição.
 * Baixas detalham a liquidação do título. Somente MOVIMENTO afeta o caixa. */
export function consolidarExecutivo(linhas: LinhaUnificada[], mesesSerie: string[], mesesJanela: string[], hoje: string) {
  const janela = new Set(mesesJanela);
  const serie = mesesSerie.map(novoMes);
  const porMes = new Map(serie.map(m => [m.mes, m]));
  const origens = { WIDESYS: resumoOrigem(), BRISA: resumoOrigem() };
  const porEmp = new Map<string, { recebido: number; pagos: number }>();
  const pendentes: (Pendente & { mes: string })[] = [];
  const cadastroImovel = new Map<string, LinhaUnificada>();
  for (const l of linhas) {
    if (l.dominio === "IMOVEL" && l.qualidade === "OK") cadastroImovel.set(l.chave, l);
  }
  for (const l of cadastroImovel.values()) {
    if (l.estado === "ATIVO") for (const chave of l.fontes) cadastroImovel.set(chave, l);
  }
  for (const l of linhas) {
    if (l.dominio !== "RECEBER" && l.dominio !== "PAGAR" && l.dominio !== "MOVIMENTO") continue;
    const mes = mesOperacionalUnificado(l);
    if (!mes) continue;
    const linhaMes = porMes.get(mes);
    if (!linhaMes) continue;
    const naJanela = janela.has(mes);
    const origem = origens[l.origem];
    if (naJanela && !l.cancelado && !l.informativo) {
      if (l.estado === "VINCULADO") origem.vinculados++;
      if (l.estado === "PENDENTE" || l.estado === "REVISAR") {
        origem.conciliar++;
        if (l.conferidoNaOrigem) origem.conferidosNaOrigemAConciliar++;
      }
      if (l.estado === "QUARENTENA") origem.inconsistentes++;
    }
    const valor = l.valor ?? 0;
    const pago = l.pago ?? 0;
    const aberto = l.aberto ?? 0;
    if (!l.contabiliza) {
      if (l.estado === "ATIVO" && l.origem === "BRISA" && l.dominio === "MOVIMENTO" && l.informativo && !l.cancelado && l.natureza === "ENTRADA") linhaMes.caixa.dinheiro += valor;
      continue;
    }
    if (l.dominio === "MOVIMENTO") {
      const caixa = linhaMes.caixa;
      if (l.natureza === "ENTRADA") {
        caixa.receita += valor;
        caixa.saldo += valor;
        if (naJanela) origem.entradas += valor;
      } else if (l.natureza === "SAIDA") {
        const centro = l.campos.centro?.valor;
        if (centro === "AL") caixa.despesaAL += valor;
        else if (centro === "CH") caixa.despesaCH += valor;
        else caixa.despesaOutros += valor;
        caixa.saldo -= valor;
        if (naJanela) origem.saidas += valor;
      } else continue;
      if (naJanela) origem.movimentos++;
      continue;
    }
    if (l.dominio === "PAGAR") {
      if (naJanela) {
        origem.pagar++;
        origem.despesa += valor;
        origem.pago += pago;
      }
      continue;
    }
    linhaMes.devido += valor;
    linhaMes.recebido += pago;
    if (aberto > 0) {
      linhaMes.pendentes++;
      linhaMes.pendenteValor += aberto;
    }
    if (!naJanela) continue;
    origem.receber++;
    origem.devido += valor;
    origem.recebido += pago;
    const imovel = l.imovelChave ? cadastroImovel.get(l.imovelChave) : undefined;
    const empreendimento = String(imovel?.campos.empreendimento?.valor || "Sem empreendimento identificado");
    const grupo = porEmp.get(empreendimento) ?? { recebido: 0, pagos: 0 };
    grupo.recebido += pago;
    if (pago > 0) grupo.pagos++;
    porEmp.set(empreendimento, grupo);
    if (aberto > 0) {
      const dias = l.vencimento ? (Date.parse(hoje) - Date.parse(l.vencimento)) / 86400000 : NaN;
      pendentes.push({ mes, empreendimento, locatario: l.titulo, localizacao: String(l.campos.imovel?.valor || "—"),
        totalDevido: valor, recebido: pago, saldoAberto: aberto, diasAtraso: Number.isFinite(dias) ? Math.max(0, Math.floor(dias)) : null });
    }
  }
  const { WIDESYS, BRISA } = origens;
  const devido = WIDESYS.devido + BRISA.devido;
  const recebido = WIDESYS.recebido + BRISA.recebido;
  const caixaReceita = WIDESYS.entradas + BRISA.entradas;
  const caixaDespesa = WIDESYS.saidas + BRISA.saidas;
  return { origens, serie, devido, recebido, taxa: devido > 0 ? recebido / devido : null, caixaReceita, caixaDespesa,
    saldoCaixa: caixaReceita - caixaDespesa, temCaixa: WIDESYS.movimentos + BRISA.movimentos > 0,
    inadQtde: pendentes.length, inadValor: pendentes.reduce((s, p) => s + p.saldoAberto, 0),
    pendentes: pendentes.sort((a, b) => b.saldoAberto - a.saldoAberto),
    porEmp: [...porEmp].map(([nome, e]) => ({ id: nome, nome, recebido: e.recebido, ticket: e.pagos ? Math.round(e.recebido / e.pagos) : null })),
  };
}
