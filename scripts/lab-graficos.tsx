/**
 * Banco de provas visual dos gráficos — gera public/lab-graficos.svg.
 *
 * Serve para OLHAR o resultado sem passar pelo login: o proxy exclui `.svg$`
 * do matcher, então o arquivo abre direto em /lab-graficos.svg. Renderiza cada
 * componente com dados realistas (inclusive os casos que já quebraram: eixo
 * com valores altos, janela de 48 meses, série vazia).
 *
 *   npx tsx scripts/lab-graficos.tsx
 *
 * É ferramenta de desenvolvimento; o SVG gerado não é servido em produção
 * porque nada linka para ele (e pode ser apagado a qualquer momento).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import {
  AreaTendencia,
  BarrasCaixa,
  BarrasDuplas,
  BarrasHorizontais,
  BarrasMensais,
  COR_1,
  Medidor,
} from "../src/components/graficos";

const L = 620; // largura do viewBox dos gráficos de coluna

/** Dados do screenshot real do usuário (JUN/2026). */
const COMISSAO = [
  1_161_000, 1_120_000, 1_553_000, 1_380_000, 1_340_000, 1_222_428, 0, 0, 0, 0,
  0, 0,
];
const DEVIDO = [
  14_098_277, 14_500_000, 14_800_000, 14_300_000, 14_600_000, 14_400_000,
  13_900_000, 13_900_000, 13_900_000, 13_900_000, 13_900_000, 13_900_000,
];
const RECEBIDO = [
  15_200_000, 15_400_000, 17_130_000, 16_400_000, 15_100_000, 13_743_376, 0, 0,
  0, 0, 0, 0,
];

/** Um gráfico posicionado dentro do SVG de contato. */
function bloco(
  titulo: string,
  markup: string,
  y: number,
  alturaCaixa: number,
  x = 24,
  larguraCaixa = 640
): { svg: string; altura: number } {
  // o componente devolve <svg viewBox="..."> sem x/y — injeta o posicionamento
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(markup);
  const vw = vb ? Number(vb[1]) : L;
  const vh = vb ? Number(vb[2]) : 216;
  const larguraGrafico = larguraCaixa - 32;
  const alturaGrafico = (vh / vw) * larguraGrafico;
  const posicionado = markup.replace(
    "<svg ",
    `<svg x="${x + 16}" y="${y + 38}" width="${larguraGrafico}" height="${alturaGrafico}" `
  );
  return {
    svg: `
    <rect x="${x}" y="${y}" width="${larguraCaixa}" height="${alturaCaixa}" rx="8" fill="#fdfbf8" stroke="#e5e1d8"/>
    <text x="${x + 16}" y="${y + 24}" font-size="13" font-weight="600" fill="#1c2430" font-family="Georgia, serif">${titulo}</text>
    ${posicionado}`,
    altura: alturaCaixa,
  };
}

const partes: string[] = [];
let y = 24;

function empilhar(titulo: string, el: React.ReactElement, alturaCaixa: number) {
  const b = bloco(titulo, renderToStaticMarkup(el), y, alturaCaixa);
  partes.push(b.svg);
  y += alturaCaixa + 20;
}

empilhar(
  "BarrasMensais — comissão 2026 (JUN em foco)",
  <BarrasMensais valores={COMISSAO} mesSelecionado={6} />,
  296
);
empilhar(
  "BarrasDuplas — Devido × Recebido (o caso que cortava o eixo: máx R$ 171,3 mil)",
  <BarrasDuplas
    serieA={DEVIDO}
    serieB={RECEBIDO}
    nomeA="Devido"
    nomeB="Recebido"
    mesSelecionado={6}
  />,
  296
);
empilhar(
  "BarrasCaixa — receita × despesas empilhadas",
  <BarrasCaixa
    receita={RECEBIDO}
    despesaAL={DEVIDO.map((v) => v * 0.3)}
    despesaCH={DEVIDO.map((v) => v * 0.15)}
  />,
  296
);
empilhar(
  "AreaTendencia · ÁREA — o caso do print: JUL–DEZ sem lançamento não viram zero",
  <AreaTendencia valores={COMISSAO} destaque={6} />,
  296
);
empilhar(
  "AreaTendencia · LINHA — mesma série, sem a mancha",
  <AreaTendencia valores={COMISSAO} destaque={6} preenchimento={false} />,
  296
);
empilhar(
  "AreaTendencia · ACUMULADO — soma progressiva, para a curva só subir",
  <AreaTendencia
    valores={COMISSAO.map((_, i) =>
      i > 5 ? 0 : COMISSAO.slice(0, i + 1).reduce((a, v) => a + v, 0)
    )}
    destaque={6}
  />,
  296
);
empilhar(
  "AreaTendencia · zero no MEIO da série continua sendo desenhado",
  <AreaTendencia
    valores={[1_100_000, 1_200_000, 0, 1_400_000, 1_300_000, 1_222_428, 0, 0, 0, 0, 0, 0]}
    destaque={6}
  />,
  296
);
empilhar(
  "BarrasDuplas — janela de 48 meses (larguras com clamp, rótulos rareados)",
  <BarrasDuplas
    serieA={Array.from({ length: 48 }, (_, i) => 8_000_000 + i * 90_000)}
    serieB={Array.from({ length: 48 }, (_, i) => 7_000_000 + i * 120_000)}
    nomeA="Devido"
    nomeB="Recebido"
    rotulos={Array.from(
      { length: 48 },
      (_, i) => `${["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"][i % 12]}/${23 + Math.floor(i / 12)}`
    )}
  />,
  296
);
empilhar(
  "BarrasHorizontais — ranking por empreendimento",
  <BarrasHorizontais
    itens={[
      { rotulo: "BRISA AZUL", valor: 501_565 },
      { rotulo: "JCAMARGO", valor: 296_733 },
      { rotulo: "AIRBNB", valor: 216_092 },
      { rotulo: "LAURA CENTER", valor: 79_324 },
      { rotulo: "ED ROBERTA", valor: 65_371 },
    ]}
    cor={COR_1}
  />,
  240
);

// medidores lado a lado: as três zonas do semáforo
const medidores = [
  { f: 0.975, t: "97,5% — ótimo" },
  { f: 0.87, t: "87% — atenção" },
  { f: 0.62, t: "62% — crítico" },
];
partes.push(
  `<rect x="24" y="${y}" width="640" height="248" rx="8" fill="#fdfbf8" stroke="#e5e1d8"/>
   <text x="40" y="${y + 24}" font-size="13" font-weight="600" fill="#1c2430" font-family="Georgia, serif">Medidor — um arco só; os dois riscos brancos marcam 80% e 95%</text>`
);
medidores.forEach((m, i) => {
  const markup = renderToStaticMarkup(
    <Medidor fracao={m.f} rotulo="Taxa de recebimento" />
  );
  partes.push(
    markup.replace(
      "<svg ",
      `<svg x="${40 + i * 200}" y="${y + 40}" width="192" height="131" `
    ) +
      `<text x="${136 + i * 200}" y="${y + 196}" font-size="10" fill="#444840" text-anchor="middle" font-family="monospace">${m.t}</text>`
  );
});
y += 268;

const ALTURA = y;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="688" height="${ALTURA}" viewBox="0 0 688 ${ALTURA}">
<style>
  :root { --font-jetbrains: ui-monospace, "Cascadia Mono", Menlo, monospace;
          --font-source-serif: Georgia, "Times New Roman", serif; }
  text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  @keyframes g-crescer { from { transform: scaleY(0); } to { transform: scaleY(1); } }
  @keyframes g-crescer-x { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes g-desenhar { to { stroke-dashoffset: 0; } }
  @keyframes g-surgir { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
  @keyframes g-entrar-x { from { opacity: 0; transform: translateX(-7px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes g-entrar-y { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  .g-barra { transform-box: fill-box; transform-origin: bottom; animation: g-crescer .6s cubic-bezier(.16,1,.3,1) both; }
  .g-barra-x { transform-box: fill-box; transform-origin: left; animation: g-crescer-x .65s cubic-bezier(.16,1,.3,1) both; }
  .g-linha { stroke-dasharray: 1; stroke-dashoffset: 1; animation: g-desenhar 1.15s cubic-bezier(.16,1,.3,1) forwards; }
  .g-surgir { transform-box: fill-box; transform-origin: center; animation: g-surgir .5s cubic-bezier(.16,1,.3,1) both; }
  .g-grade, .g-eixo { animation: g-entrar-x .5s cubic-bezier(.16,1,.3,1) both; }
  .g-rot { animation: g-entrar-y .45s cubic-bezier(.16,1,.3,1) both; }
  .g-realce { opacity: 0; }
</style>
<rect width="688" height="${ALTURA}" fill="#faf7f1"/>
${partes.join("\n")}
</svg>`;

writeFileSync("public/lab-graficos.svg", svg, "utf8");
console.log(`public/lab-graficos.svg — ${ALTURA}px de altura`);
