import type { LinhaUnificada } from "../unificacao/tipos";
import { mesOperacionalUnificado } from "../unificacao/periodo";
import type { Pendente } from "../consultas/executivo";
import { integraFinanceiro } from "./projecao-widesys";

function novoMes(mes: string) {
  const caixa = { mes, receita: 0, saida: 0, saldo: 0 };
  return { mes, devido: 0, recebido: 0, pendentes: 0, pendenteValor: 0, caixa };
}

export function mesPadraoConsolidado(linhas: LinhaUnificada[], hoje: string) {
  const atual = hoje.slice(0, 7);
  let ultimo = "";
  for (const linha of linhas) {
    if (!integraFinanceiro(linha) || !linha.contabiliza) continue;
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
  let titulosReceber = 0, devido = 0, recebido = 0, titulosPagar = 0, despesa = 0, despesaPaga = 0;
  let movimentos = 0, caixaReceita = 0, caixaDespesa = 0;
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
    if (!integraFinanceiro(l) || !l.contabiliza) continue;
    if (l.dominio !== "RECEBER" && l.dominio !== "PAGAR" && l.dominio !== "MOVIMENTO") continue;
    const mes = mesOperacionalUnificado(l);
    if (!mes) continue;
    const linhaMes = porMes.get(mes);
    if (!linhaMes) continue;
    const naJanela = janela.has(mes);
    const valor = l.valor ?? 0;
    const pago = l.pago ?? 0;
    const aberto = l.aberto ?? 0;
    if (l.dominio === "MOVIMENTO") {
      const caixa = linhaMes.caixa;
      if (l.natureza === "ENTRADA") {
        caixa.receita += valor;
        caixa.saldo += valor;
        if (naJanela) caixaReceita += valor;
      } else if (l.natureza === "SAIDA") {
        caixa.saida += valor;
        caixa.saldo -= valor;
        if (naJanela) caixaDespesa += valor;
      } else continue;
      if (naJanela) movimentos++;
      continue;
    }
    if (l.dominio === "PAGAR") {
      if (naJanela) {
        titulosPagar++;
        despesa += valor;
        despesaPaga += pago;
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
    titulosReceber++;
    devido += valor;
    recebido += pago;
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
  return { serie, titulosReceber, devido, recebido, titulosPagar, despesa, despesaPaga,
    taxa: devido > 0 ? recebido / devido : null, caixaReceita, caixaDespesa,
    saldoCaixa: caixaReceita - caixaDespesa, temCaixa: movimentos > 0,
    inadQtde: pendentes.length, inadValor: pendentes.reduce((s, p) => s + p.saldoAberto, 0),
    pendentes: pendentes.sort((a, b) => b.saldoAberto - a.saldoAberto),
    porEmp: [...porEmp].map(([nome, e]) => ({ id: nome, nome, recebido: e.recebido, ticket: e.pagos ? Math.round(e.recebido / e.pagos) : null })),
  };
}
