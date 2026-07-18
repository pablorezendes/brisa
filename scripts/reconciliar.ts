/**
 * Reconciliação DENTRO do sistema (references/07, "critério de aceite do corte"):
 * recomputa a comissão a partir do BANCO (função canônica de src/lib/dominio)
 * e compara com os números da planilha carregados no dataset.json.
 *
 * Critérios verificados:
 *  A. por lançamento: comissão recomputada vs comissao_planilha (tol. R$0,01);
 *  B. por mês (aba): Σ comissão do banco vs Σ comissão da planilha;
 *  C. contagem de recebimentos importados == linhas do dataset;
 *  D. caixa: somas por mês/faixa do banco == somas do dataset;
 *  E. apuração de temporada 2023–2025 == dataset.
 *
 * Exit 0 = tudo verde; 1 = divergência.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { calcularRecebimento } from "../src/lib/dominio/comissao";
import { formatarBRL, paraCentavos, paraCentavosOuZero } from "../src/lib/dominio/dinheiro";
import { competencia, mesParaNumero, NOME_MES_ABREV } from "../src/lib/dominio/normalizacao";
import type { Dataset } from "../src/lib/importacao/importar";

const prisma = new PrismaClient();
let falhas = 0;

function checar(ok: boolean, rotulo: string, detalhe = "") {
  const flag = ok ? " OK " : "FALHA";
  console.log(`  [${flag}] ${rotulo}${detalhe ? " — " + detalhe : ""}`);
  if (!ok) falhas++;
}

async function main() {
  const ds = JSON.parse(
    readFileSync(join(__dirname, "..", "data", "dataset.json"), "utf-8")
  ) as Dataset;

  console.log("==========================================================");
  console.log("RECONCILIAÇÃO SISTEMA vs PLANILHA");
  console.log("==========================================================");

  // ---------- A. por lançamento (regra recomputada vs planilha) ----------
  console.log("\nA. Comissão por lançamento (tolerância R$0,01):");
  let desviosLancamento = 0;
  for (const r of ds.recebimentos) {
    const calc = calcularRecebimento({
      valor: paraCentavosOuZero(r.valor),
      iptu: paraCentavosOuZero(r.iptu),
      cond: paraCentavosOuZero(r.cond),
      recebido: paraCentavos(r.recebido),
      taxaComissaoBps: Math.round((r.taxa_comissao ?? 0.1) * 10000),
    });
    const planilha = paraCentavos(r.comissao_planilha);
    const nosso = calc.comissao;
    if (planilha === null && nosso === null) continue;
    const delta = Math.abs((nosso ?? 0) - (planilha ?? 0));
    if (delta > 1) {
      desviosLancamento++;
      if (desviosLancamento <= 5) {
        console.log(
          `    desvio ${r.mes_ref} ${r.empreendimento}/${r.localizacao}: ` +
            `calc=${formatarBRL(nosso)} planilha=${formatarBRL(planilha)}`
        );
      }
    }
  }
  checar(
    desviosLancamento === 0,
    `todos os ${ds.recebimentos.length} lançamentos dentro da tolerância`,
    desviosLancamento > 0 ? `${desviosLancamento} desvios` : ""
  );

  // ---------- B. por mês, recomputado do BANCO ----------
  console.log("\nB. Comissão mensal (banco recomputado vs planilha):");
  const doBanco = await prisma.recebimento.findMany();
  const porMesBanco = new Map<string, number>();
  for (const r of doBanco) {
    const { comissao } = calcularRecebimento({
      valor: r.valor,
      iptu: r.iptu,
      cond: r.cond,
      recebido: r.recebido,
      taxaComissaoBps: r.taxaComissaoBps,
    });
    if (comissao === null) continue;
    porMesBanco.set(
      r.mesLancamento,
      (porMesBanco.get(r.mesLancamento) ?? 0) + comissao
    );
  }
  const porMesPlanilha = new Map<string, number>();
  for (const r of ds.recebimentos) {
    const c = r.comissao_planilha;
    if (c === null || c === undefined) continue;
    const chave = competencia(2026, r.mes);
    porMesPlanilha.set(chave, (porMesPlanilha.get(chave) ?? 0) + c);
  }
  const meses = [...porMesPlanilha.keys()].sort();
  for (const m of meses) {
    const banco = porMesBanco.get(m) ?? 0;
    const planilha = Math.round((porMesPlanilha.get(m) ?? 0) * 100);
    const delta = banco - planilha;
    const linhasDoMes = ds.recebimentos.filter(
      (r) => competencia(2026, r.mes) === m && r.comissao_planilha !== null
    ).length;
    // tolerância de arredondamento: R$0,01 por lançamento (ref 07)
    const tolerancia = linhasDoMes;
    const abrev = NOME_MES_ABREV[Number(m.split("-")[1])];
    checar(
      Math.abs(delta) <= tolerancia,
      `${abrev}: banco=${formatarBRL(banco)} planilha=${formatarBRL(planilha)}`,
      `Δ=${(delta / 100).toFixed(2)} (tol. ±${(tolerancia / 100).toFixed(2)})`
    );
  }

  // ---------- C. contagens ----------
  console.log("\nC. Contagens:");
  checar(
    doBanco.length === ds.recebimentos.length,
    `recebimentos no banco (${doBanco.length}) == dataset (${ds.recebimentos.length})`
  );

  // ---------- D. caixa ----------
  console.log("\nD. Livro-caixa (somas por mês/faixa):");
  const lancBanco = await prisma.lancamentoCaixa.findMany();
  const somaBanco = new Map<string, number>();
  for (const l of lancBanco) {
    const chave = `${l.mesReferencia}|${l.tipo}|${l.centroCusto}`;
    somaBanco.set(chave, (somaBanco.get(chave) ?? 0) + l.valor);
  }
  const faixaSpec = [
    ["saida_ac", "SAIDA", "AL"],
    ["saida_ch", "SAIDA", "CH"],
    ["entrada", "ENTRADA", "GERAL"],
    ["receb_dinheiro", "RECEB_DINHEIRO", "GERAL"],
  ] as const;
  for (const [aba, faixas] of Object.entries(ds.livro_caixa)) {
    const mes = mesParaNumero(aba);
    const ano = Number(aba.match(/(\d{4})/)?.[1] ?? 2026);
    if (!mes) continue;
    const mesRef = competencia(ano, mes);
    for (const [faixa, tipo, centro] of faixaSpec) {
      const origem = (faixas[faixa] ?? [])
        .filter((l) => l.valor !== null && l.valor !== undefined)
        .reduce((acc, l) => acc + Math.round((l.valor as number) * 100), 0);
      const banco = somaBanco.get(`${mesRef}|${tipo}|${centro}`) ?? 0;
      if (origem === 0 && banco === 0) continue;
      checar(
        origem === banco,
        `${mesRef} ${tipo}/${centro}: ${formatarBRL(banco)}`,
        origem !== banco ? `dataset=${formatarBRL(origem)}` : ""
      );
    }
  }

  // ---------- E. temporada histórica (anos < 2026; ano corrente vem do núcleo)
  console.log("\nE. Apuração histórica de temporada:");
  const apBanco = await prisma.apuracaoTemporadaHistorica.findMany();
  const chaveAp = new Map(apBanco.map((a) => [`${a.ano}-${a.mes}`, a]));
  let apChecadas = 0;
  let apDivergentes = 0;
  for (const [anoStr, mesesAp] of Object.entries(ds.airbnb_apuracao)) {
    if (Number(anoStr) >= 2026) continue;
    for (const [abrev, tot] of Object.entries(mesesAp)) {
      const mes = mesParaNumero(abrev);
      if (!mes) continue;
      const receita = tot["TOTAL RECEB"];
      const despesa = tot["TOTAL DESPESA"];
      if (receita === null || receita === undefined) continue;
      apChecadas++;
      const banco = chaveAp.get(`${anoStr}-${mes}`);
      const ok =
        !!banco &&
        banco.receita === paraCentavosOuZero(receita) &&
        banco.despesa === paraCentavos(despesa);
      if (!ok) apDivergentes++;
    }
  }
  checar(
    apDivergentes === 0,
    `${apChecadas} apurações mensais conferem`,
    apDivergentes > 0 ? `${apDivergentes} divergentes` : ""
  );

  // ---------- veredito ----------
  console.log("\n==========================================================");
  if (falhas === 0) {
    console.log("✔ PARIDADE CONFIRMADA — sistema reproduz a planilha.");
  } else {
    console.log(`✘ ${falhas} verificação(ões) falharam.`);
  }
  process.exit(falhas === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
