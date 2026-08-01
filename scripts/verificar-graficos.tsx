/**
 * Verificação geométrica dos gráficos — checa o SVG realmente emitido.
 *
 * Nasceu do bug que cortava o eixo ("171,3 mil" virava ".71,3 mil"): rótulo
 * mais largo que a canaleta, ancorado à direita, saía pela borda esquerda do
 * viewBox. Aqui as regras viram teste: nada de texto fora do quadro, nada de
 * medida negativa, marcas de escala sempre em números redondos.
 *
 *   npx tsx scripts/verificar-graficos.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import {
  AreaTendencia,
  BarrasCaixa,
  BarrasDuplas,
  BarrasHorizontais,
  BarrasMensais,
  Medidor,
  escalaAgradavel,
} from "../src/components/graficos";

/** Largura de avanço por caractere (fração do font-size). Mono ~0.6, sans ~0.55. */
const AVANCO_MONO = 0.6;
const AVANCO_SANS = 0.56;

interface Falha {
  grafico: string;
  regra: string;
  detalhe: string;
}
const falhas: Falha[] = [];
let checagens = 0;

function atributo(tag: string, nome: string): string | null {
  const m = new RegExp(`\\b${nome}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}
function num(tag: string, nome: string): number | null {
  const v = atributo(tag, nome);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Confere um SVG de gráfico: todo <text> e toda medida têm de caber no
 * viewBox declarado pelo próprio componente.
 */
function conferir(grafico: string, markup: string) {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(markup);
  if (!vb) {
    falhas.push({ grafico, regra: "viewBox", detalhe: "não declarado" });
    return;
  }
  const [larg, alt] = [Number(vb[1]), Number(vb[2])];

  // ---- texto dentro do quadro ----
  for (const m of markup.matchAll(/<text\b([^>]*)>([^<]*)</g)) {
    const [, attrs, texto] = m;
    const conteudo = texto.trim();
    if (!conteudo) continue;
    const x = num(attrs, "x") ?? 0;
    const y = num(attrs, "y") ?? 0;
    const fs = num(attrs, "font-size") ?? 10;
    const mono = /monospace/.test(attrs);
    const largura = conteudo.length * fs * (mono ? AVANCO_MONO : AVANCO_SANS);
    const ancora = atributo(attrs, "text-anchor") ?? "start";
    const esq =
      ancora === "end" ? x - largura : ancora === "middle" ? x - largura / 2 : x;
    const dir = esq + largura;
    checagens++;
    if (esq < -0.5) {
      falhas.push({
        grafico,
        regra: "texto cortado à esquerda",
        detalhe: `"${conteudo}" começa em x=${esq.toFixed(1)} (viewBox começa em 0)`,
      });
    }
    if (dir > larg + 0.5) {
      falhas.push({
        grafico,
        regra: "texto cortado à direita",
        detalhe: `"${conteudo}" termina em x=${dir.toFixed(1)} (viewBox vai até ${larg})`,
      });
    }
    if (y < 0 || y > alt + 0.5) {
      falhas.push({
        grafico,
        regra: "texto fora na vertical",
        detalhe: `"${conteudo}" em y=${y} (viewBox tem ${alt} de altura)`,
      });
    }
  }

  // ---- medidas não-negativas ----
  for (const m of markup.matchAll(/<(rect|circle|line|path)\b([^>]*)>/g)) {
    const [, tag, attrs] = m;
    for (const nome of ["width", "height", "r", "stroke-width"]) {
      const v = num(attrs, nome);
      if (v === null) continue;
      checagens++;
      if (v < 0) {
        falhas.push({
          grafico,
          regra: "medida negativa",
          detalhe: `<${tag} ${nome}="${v}"> — o navegador descarta o elemento`,
        });
      }
    }
    // path com raio negativo produz curva degenerada
    const d = atributo(attrs, "d");
    if (d && /[qa]-?\d*\.?\d+,-?\d*\.?\d+ -?\d/.test(d) && /q-/.test(d)) {
      checagens++;
    }
  }

  // ---- todo dado tem tooltip nativo ----
  const titles = (markup.match(/<title>/g) ?? []).length;
  checagens++;
  if (titles === 0) {
    falhas.push({
      grafico,
      regra: "sem tooltip",
      detalhe: "nenhum <title> — o dado exato fica inacessível no hover",
    });
  }

  // ---- animação declarada ----
  checagens++;
  if (!/class="g-/.test(markup)) {
    falhas.push({
      grafico,
      regra: "sem animação",
      detalhe: "nenhum elemento com classe g-*",
    });
  }
}

// ---------------------------------------------------------------------------
// escala redonda
// ---------------------------------------------------------------------------
const CASOS_ESCALA = [
  17_130_000, 1_553_000, 140_982_77, 999, 1, 87_654_321, 250_000, 3_333_333,
];
for (const bruto of CASOS_ESCALA) {
  const { max, ticks } = escalaAgradavel(bruto);
  checagens++;
  if (max < bruto) {
    falhas.push({
      grafico: "escalaAgradavel",
      regra: "topo abaixo do dado",
      detalhe: `max=${max} < série=${bruto} — a barra estouraria o quadro`,
    });
  }
  checagens++;
  if (ticks.length < 3 || ticks.length > 6) {
    falhas.push({
      grafico: "escalaAgradavel",
      regra: "densidade de marcas",
      detalhe: `${ticks.length} marcas para ${bruto} (esperado 3–6)`,
    });
  }
  // passo tem de ser 1/2/2,5/5 × 10ⁿ
  const passo = ticks[0];
  const mag = Math.pow(10, Math.floor(Math.log10(passo)));
  const norm = Number((passo / mag).toFixed(6));
  checagens++;
  if (![1, 2, 2.5, 5].includes(norm)) {
    falhas.push({
      grafico: "escalaAgradavel",
      regra: "passo não-redondo",
      detalhe: `passo=${passo} (normalizado ${norm}) para série ${bruto}`,
    });
  }
}

// ---------------------------------------------------------------------------
// gráficos, incluindo os casos-limite que já quebraram
// ---------------------------------------------------------------------------
const DOZE = Array.from({ length: 12 }, (_, i) => 1_000_000 + i * 130_000);
const ALTO = Array.from({ length: 12 }, (_, i) => 14_000_000 + i * 300_000);

conferir(
  "BarrasMensais · 12 meses",
  renderToStaticMarkup(<BarrasMensais valores={DOZE} mesSelecionado={6} />)
);
conferir(
  "BarrasMensais · série zerada",
  renderToStaticMarkup(<BarrasMensais valores={new Array(12).fill(0)} />)
);
conferir(
  "BarrasMensais · 60 meses (teto do período)",
  renderToStaticMarkup(
    <BarrasMensais
      valores={Array.from({ length: 60 }, (_, i) => 500_000 + i * 40_000)}
      rotulos={Array.from({ length: 60 }, (_, i) => `M${i + 1}/2${i % 9}`)}
    />
  )
);
conferir(
  "BarrasDuplas · valores altos (o bug do eixo cortado)",
  renderToStaticMarkup(
    <BarrasDuplas serieA={ALTO} serieB={ALTO} nomeA="Devido" nomeB="Recebido" />
  )
);
conferir(
  "BarrasDuplas · 48 meses",
  renderToStaticMarkup(
    <BarrasDuplas
      serieA={Array.from({ length: 48 }, () => 9_000_000)}
      serieB={Array.from({ length: 48 }, () => 8_000_000)}
      nomeA="Devido"
      nomeB="Recebido"
      rotulos={Array.from({ length: 48 }, (_, i) => `JAN/2${i % 9}`)}
    />
  )
);
conferir(
  "BarrasCaixa · empilhado",
  renderToStaticMarkup(
    <BarrasCaixa
      receita={ALTO}
      despesaAL={DOZE}
      despesaCH={DOZE.map((v) => v / 2)}
    />
  )
);
conferir(
  "AreaTendencia · 12 meses",
  renderToStaticMarkup(<AreaTendencia valores={DOZE} destaque={6} />)
);
conferir(
  "BarrasHorizontais · ranking",
  renderToStaticMarkup(
    <BarrasHorizontais
      itens={[
        { rotulo: "BRISA AZUL", valor: 501_565 },
        { rotulo: "NOME MUITO LONGO DE EMPREENDIMENTO", valor: 296_733 },
        { rotulo: "AIRBNB", valor: 216_092 },
      ]}
    />
  )
);
for (const f of [0, 0.62, 0.87, 0.975, 1, 1.34]) {
  conferir(
    `Medidor · ${(f * 100).toFixed(0)}%`,
    renderToStaticMarkup(<Medidor fracao={f} rotulo="Taxa" />)
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${checagens} checagens em ${new Set(falhas.map((f) => f.grafico)).size || 0} gráficos com falha\n`);
if (falhas.length === 0) {
  console.log("✓ tudo dentro do quadro, medidas positivas, escalas redondas");
  process.exit(0);
}
for (const f of falhas) {
  console.log(`✗ [${f.grafico}] ${f.regra}\n    ${f.detalhe}`);
}
process.exit(1);
