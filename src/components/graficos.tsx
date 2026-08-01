/**
 * Gráficos SVG server-side. Sem libs, sem JavaScript no cliente.
 *
 * Linguagem visual: flat editorial (stile/DESIGN.md) — sem gradientes, sem
 * sombras, sem brilhos. A riqueza vem dos DETALHES informativos: eixo de
 * valores à esquerda, grade pontilhada recessiva, realce da coluna no hover
 * (CSS puro, .g-col:hover — segue server component), etiquetas de valor e as
 * zonas do semáforo desenhadas no medidor.
 *
 * Paleta "pigmentos naturais" do design editorial, validada p/ daltonismo:
 *   1 musgo #4f7a33 (dinheiro que entra) · 2 ocre #b3801a (o que era devido)
 *   3 índigo #4a68a8 (terceira série). Texto SEMPRE em tom de tinta, nunca na
 *   cor da série. Todo gráfico traz <title> (tooltip nativo) e a página oferece
 *   a mesma informação em tabela.
 */
import { abreviarBRL, formatarBRL } from "@/lib/dominio/dinheiro";
import { NOME_MES_ABREV } from "@/lib/dominio/normalizacao";
import { NIVEL, type Nivel } from "@/lib/dominio/semaforo";

export const COR_1 = "#4f7a33"; // musgo — série principal (dinheiro que entra)
export const COR_1_FORTE = "#33511f"; // passo escuro do mesmo matiz (destaque)
export const COR_2 = "#b3801a"; // ocre — devido / atenção (--ambar)
export const COR_3 = "#4a68a8"; // índigo — terceira série

const GRADE = "#e5e1d8"; // --contorno
const EIXO = "#75786f"; // --contorno-forte
const ROTULO = "#444840"; // --tinta-suave
const TINTA = "#1c2430"; // --tinta

// ---------------------------------------------------------------------------
// geometria comum das molduras verticais
// ---------------------------------------------------------------------------

const LARG = 620;
const EIXO_W = 66; // canaleta dos rótulos de valor — cabe "200 mil" com folga
const TOPO = 22;
const ALT = 168;
const BASE = TOPO + ALT;
const ROD = 26; // faixa dos nomes de mês, embaixo
const PLOT_W = LARG - EIXO_W;
const VIEWBOX = `0 0 ${LARG} ${BASE + ROD}`;

/**
 * Escala com números REDONDOS (1 · 2 · 2,5 · 5 × 10ⁿ).
 *
 * Sem isto o topo do eixo é o próprio máximo da série e as marcas viram
 * frações quebradas — "171,3 mil", "128,5 mil" — que além de ilegíveis não
 * cabiam na canaleta e saíam cortadas pela borda do SVG. Com escala redonda,
 * o rótulo mais longo é curto e a leitura vira instantânea.
 */
export function escalaAgradavel(
  maxBruto: number,
  divisoes = 4
): { max: number; ticks: number[] } {
  if (!(maxBruto > 0)) return { max: 1, ticks: [] };
  const mag = Math.pow(10, Math.floor(Math.log10(maxBruto / divisoes)));
  const norm = maxBruto / divisoes / mag;
  const passo =
    (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) *
    mag;
  const max = Math.ceil(maxBruto / passo) * passo;
  const ticks: number[] = [];
  for (let v = passo; v <= max * 1.0001; v += passo) ticks.push(v);
  return { max, ticks };
}

/** Barra vertical de canto vivo suave, ancorada na base. Cresce ao carregar. */
function Barra({
  x,
  y,
  w,
  h,
  cor,
  titulo,
  delayMs = 0,
  foco = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  cor: string;
  titulo: string;
  delayMs?: number;
  /** série em destaque: ganha marca de topo */
  foco?: boolean;
}) {
  if (h <= 0.5)
    return (
      <rect x={x} y={y - 1} width={w} height={1.5} fill={EIXO} rx={0.75}>
        <title>{titulo}</title>
      </rect>
    );
  const r = Math.min(3, w / 2, h);
  const d = `M${x},${y + h} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
  return (
    <g className="g-barra" style={{ animationDelay: `${delayMs}ms` }}>
      <path d={d} fill={cor}>
        <title>{titulo}</title>
      </path>
      {/* marca de topo: fio de 1,5px que fecha a coluna em foco */}
      {foco ? (
        <line
          x1={x}
          x2={x + w}
          y1={y - 1.5}
          y2={y - 1.5}
          stroke={cor}
          strokeWidth={1.5}
        />
      ) : null}
    </g>
  );
}

/**
 * Moldura de instrumento: espinha do eixo à esquerda, marcas de escala,
 * grade fina pontilhada e cantoneiras nos extremos do plot. Cada elemento
 * entra em sequência ao carregar — a leitura é de aparelho calibrando.
 */
function Moldura({ ticks, max }: { ticks: number[]; max: number }) {
  return (
    <g aria-hidden="true">
      <line
        x1={EIXO_W}
        x2={EIXO_W}
        y1={TOPO - 8}
        y2={BASE}
        stroke={EIXO}
        strokeWidth={1}
        opacity={0.5}
        className="g-eixo"
      />
      {ticks.map((v, i) => {
        const y = BASE - (v / max) * ALT;
        return (
          <g
            key={v}
            className="g-grade"
            style={{ animationDelay: `${100 + i * 60}ms` }}
          >
            <line
              x1={EIXO_W}
              x2={LARG}
              y1={y}
              y2={y}
              stroke={GRADE}
              strokeWidth={1}
              strokeDasharray="1 4"
            />
            <line
              x1={EIXO_W - 4}
              x2={EIXO_W}
              y1={y}
              y2={y}
              stroke={EIXO}
              strokeWidth={1}
              opacity={0.65}
            />
            <text
              x={EIXO_W - 10}
              y={y + 3.2}
              fontSize={9.5}
              fill={ROTULO}
              textAnchor="end"
              style={{ fontFamily: "var(--font-jetbrains), monospace" }}
            >
              {abreviarBRL(Math.round(v))}
            </text>
          </g>
        );
      })}
      <line
        x1={EIXO_W}
        x2={LARG}
        y1={BASE}
        y2={BASE}
        stroke={EIXO}
        strokeWidth={1.25}
        className="g-eixo"
      />
      {/* cantoneiras — detalhe de instrumento, sem custo de tinta */}
      {[
        [EIXO_W, 1],
        [LARG, -1],
      ].map(([x, sx]) => (
        <path
          key={x}
          d={`M${x},${TOPO - 1} V${TOPO - 8} H${x + sx * 8}`}
          fill="none"
          stroke={EIXO}
          strokeWidth={1}
          opacity={0.45}
          className="g-surgir"
          style={{ animationDelay: "0.45s" }}
        />
      ))}
    </g>
  );
}

/** Faixa hoverável que acende a coluna inteira do mês (crosshair sem JS). */
function ColunaHover({
  x,
  w,
  children,
}: {
  x: number;
  w: number;
  children: React.ReactNode;
}) {
  return (
    <g className="g-col">
      <rect
        className="g-realce"
        x={x}
        y={TOPO - 8}
        width={w}
        height={ALT + 8}
        rx={3}
        fill={TINTA}
      />
      {children}
    </g>
  );
}

/** Etiqueta de valor sobre a barra em foco (leitura direta, em tinta). */
function Etiqueta({
  x,
  y,
  texto,
  cor,
}: {
  x: number;
  y: number;
  texto: string;
  cor: string;
}) {
  void cor; // rótulo em tinta — cor fica só na barra
  // a etiqueta é centrada na barra; nas colunas das pontas isso jogaria o
  // texto para fora do quadro, então ela encosta na borda em vez de vazar
  const meia = (texto.length * 9.5 * 0.6) / 2;
  const xc = Math.min(Math.max(x, EIXO_W + meia), LARG - meia);
  return (
    <text
      x={xc}
      y={y - 6}
      fontSize={9.5}
      fontWeight={700}
      fill={TINTA}
      textAnchor="middle"
      className="g-surgir"
      style={{
        fontFamily: "var(--font-jetbrains), monospace",
        animationDelay: "0.55s",
      }}
    >
      {texto}
    </text>
  );
}

// ---------------------------------------------------------------------------
// Gráficos de coluna
// ---------------------------------------------------------------------------

/** Rótulos default de eixo: posição i → NOME_MES_ABREV[i+1] (JAN..DEZ). */
function rotuloEixo(rotulos: string[] | undefined, i: number): string {
  return rotulos?.[i] ?? NOME_MES_ABREV[i + 1] ?? String(i + 1);
}

/**
 * Em janelas longas (período de vários anos) não cabe um rótulo por mês:
 * mostra 1 a cada k posições (k cresce com n), mantendo o primeiro. A posição
 * em destaque é sempre rotulada por quem chama (forcar).
 */
function mostrarRotulo(n: number, i: number, forcar = false): boolean {
  if (forcar || n <= 16) return true;
  return i % Math.ceil(n / 16) === 0;
}

/**
 * Série única mensal (comissão). Posição selecionada com halo e etiqueta.
 * `mesSelecionado` é a POSIÇÃO 1-based na série (no ano JAN..DEZ coincide com
 * o número do mês); `rotulos` troca o eixo quando o período cruza anos.
 */
export function BarrasMensais({
  valores,
  mesSelecionado,
  rotuloAcessivel = "Comissão mês a mês",
  cor = COR_1,
  rotulos,
}: {
  valores: number[]; // índice 0 = primeiro mês da janela (centavos)
  mesSelecionado?: number; // posição 1-based na série
  rotuloAcessivel?: string;
  cor?: string;
  rotulos?: string[];
}) {
  const { max, ticks } = escalaAgradavel(Math.max(...valores, 1));
  const n = valores.length;
  const passo = PLOT_W / n;
  const larguraBarra = Math.max(2, Math.min(30, passo - 10));
  const maxIdx = valores.indexOf(Math.max(...valores));

  return (
    <svg viewBox={VIEWBOX} className="w-full" role="img" aria-label={rotuloAcessivel}>
      <Moldura ticks={ticks} max={max} />
      {valores.map((v, i) => {
        const h = (v / max) * ALT;
        const centro = EIXO_W + i * passo + passo / 2;
        const x = centro - larguraBarra / 2;
        const selecionado = i + 1 === mesSelecionado;
        const rotular = selecionado || i === maxIdx;
        return (
          <ColunaHover key={i} x={EIXO_W + i * passo + 2} w={passo - 4}>
            <Barra
              x={x}
              y={BASE - h}
              w={larguraBarra}
              h={h}
              cor={selecionado ? COR_1_FORTE : cor}
              titulo={`${rotuloEixo(rotulos, i)}: ${formatarBRL(v)}`}
              delayMs={i * 45}
              foco={selecionado}
            />
            {rotular && v > 0 ? (
              <Etiqueta
                x={centro}
                y={BASE - h}
                texto={abreviarBRL(v)}
                cor={selecionado ? COR_1_FORTE : ROTULO}
              />
            ) : null}
            {mostrarRotulo(n, i, selecionado) ? (
              <text
                x={centro}
                y={BASE + 15}
                className="g-rot"
                fontSize={9.5}
                fill={selecionado ? TINTA : ROTULO}
                fontWeight={selecionado ? 700 : 400}
                textAnchor="middle"
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  animationDelay: `${300 + i * 30}ms`,
                }}
              >
                {rotuloEixo(rotulos, i)}
              </text>
            ) : null}
            {selecionado ? (
              <line
                x1={centro - larguraBarra / 2}
                x2={centro + larguraBarra / 2}
                y1={BASE + 20}
                y2={BASE + 20}
                stroke={COR_1_FORTE}
                strokeWidth={2}
                strokeLinecap="round"
              />
            ) : null}
          </ColunaHover>
        );
      })}
    </svg>
  );
}

/** Duas séries agrupadas por mês (Devido × Recebido). */
export function BarrasDuplas({
  serieA,
  serieB,
  nomeA,
  nomeB,
  corA = COR_2,
  corB = COR_1,
  mesSelecionado,
  rotulos,
}: {
  serieA: number[];
  serieB: number[];
  nomeA: string;
  nomeB: string;
  corA?: string;
  corB?: string;
  /** posição 1-based na série — recebe marcação embaixo, se informado */
  mesSelecionado?: number;
  /** rótulos do eixo (default JAN..DEZ) */
  rotulos?: string[];
}) {
  const { max, ticks } = escalaAgradavel(Math.max(...serieA, ...serieB, 1));
  const n = serieA.length;
  const passo = PLOT_W / n;
  const larguraBarra = Math.max(1.5, Math.min(14, (passo - 12) / 2));

  return (
    <svg
      viewBox={VIEWBOX}
      className="w-full"
      role="img"
      aria-label={`${nomeA} e ${nomeB} por mês`}
    >
      <Moldura ticks={ticks} max={max} />
      {serieA.map((a, i) => {
        const b = serieB[i] ?? 0;
        const hA = (a / max) * ALT;
        const hB = (b / max) * ALT;
        const centro = EIXO_W + i * passo + passo / 2;
        const selecionado = i + 1 === mesSelecionado;
        return (
          <ColunaHover key={i} x={EIXO_W + i * passo + 2} w={passo - 4}>
            <Barra
              x={centro - larguraBarra - 1.5}
              y={BASE - hA}
              w={larguraBarra}
              h={hA}
              cor={corA}
              titulo={`${rotuloEixo(rotulos, i)} — ${nomeA}: ${formatarBRL(a)}`}
              delayMs={i * 45}
            />
            <Barra
              x={centro + 1.5}
              y={BASE - hB}
              w={larguraBarra}
              h={hB}
              cor={corB}
              titulo={`${rotuloEixo(rotulos, i)} — ${nomeB}: ${formatarBRL(b)}`}
              delayMs={i * 45 + 20}
              foco={selecionado}
            />
            {mostrarRotulo(n, i, selecionado) ? (
              <text
                x={centro}
                y={BASE + 15}
                className="g-rot"
                fontSize={9.5}
                fill={selecionado ? TINTA : ROTULO}
                fontWeight={selecionado ? 700 : 400}
                textAnchor="middle"
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  animationDelay: `${300 + i * 30}ms`,
                }}
              >
                {rotuloEixo(rotulos, i)}
              </text>
            ) : null}
          </ColunaHover>
        );
      })}
    </svg>
  );
}

/** Caixa: Receita × Despesa empilhada por centro (AL na base, CH acima). */
export function BarrasCaixa({
  receita,
  despesaAL,
  despesaCH,
  rotulos,
}: {
  receita: number[];
  despesaAL: number[];
  despesaCH: number[];
  /** rótulos do eixo (default JAN..DEZ) */
  rotulos?: string[];
}) {
  const { max, ticks } = escalaAgradavel(
    Math.max(...receita, ...despesaAL.map((v, i) => v + (despesaCH[i] ?? 0)), 1)
  );
  const n = receita.length;
  const passo = PLOT_W / n;
  const larguraBarra = Math.max(1.5, Math.min(14, (passo - 12) / 2));

  return (
    <svg
      viewBox={VIEWBOX}
      className="w-full"
      role="img"
      aria-label="Receita e despesas do caixa por mês"
    >
      <Moldura ticks={ticks} max={max} />
      {receita.map((rec, i) => {
        const al = despesaAL[i] ?? 0;
        const ch = despesaCH[i] ?? 0;
        const centro = EIXO_W + i * passo + passo / 2;
        const xD = centro + 1.5;
        const hR = (rec / max) * ALT;
        const hAL = (al / max) * ALT;
        const hCH = (ch / max) * ALT;
        const mes = rotuloEixo(rotulos, i);
        return (
          <ColunaHover key={i} x={EIXO_W + i * passo + 2} w={passo - 4}>
            <Barra
              x={centro - larguraBarra - 1.5}
              y={BASE - hR}
              w={larguraBarra}
              h={hR}
              cor={COR_1}
              titulo={`${mes} — Receita: ${formatarBRL(rec)}`}
              delayMs={i * 45}
            />
            {/* pilha de despesas: AL na base, CH acima com 2px de respiro */}
            {hAL > 0 ? (
              <g className="g-barra" style={{ animationDelay: `${i * 45 + 20}ms` }}>
                <rect
                  x={xD}
                  y={BASE - hAL}
                  width={larguraBarra}
                  height={hAL}
                  fill={COR_2}
                >
                  <title>{`${mes} — Despesa Antonio/Laura: ${formatarBRL(al)}`}</title>
                </rect>
              </g>
            ) : null}
            {hCH > 0 ? (
              <Barra
                x={xD}
                y={BASE - hAL - (hAL > 0 ? 2 : 0) - hCH}
                w={larguraBarra}
                h={hCH}
                cor={COR_3}
                titulo={`${mes} — Despesa Chácara Brisa: ${formatarBRL(ch)}`}
                delayMs={i * 45 + 40}
              />
            ) : null}
            {mostrarRotulo(n, i) ? (
              <text
                x={centro}
                y={BASE + 15}
                className="g-rot"
                fontSize={9.5}
                fill={ROTULO}
                textAnchor="middle"
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  animationDelay: `${300 + i * 30}ms`,
                }}
              >
                {mes}
              </text>
            ) : null}
          </ColunaHover>
        );
      })}
    </svg>
  );
}

/**
 * Tendência em área — a curva do ano com o preenchimento esvaindo para baixo.
 * Melhor que barras quando a pergunta é "está subindo ou descendo?".
 */
export function AreaTendencia({
  valores,
  cor = COR_1,
  destaque,
  rotuloAcessivel = "Tendência mensal",
  rotulos,
}: {
  valores: number[];
  cor?: string;
  /** posição 1-based na série — ponto marcado com anel */
  destaque?: number;
  rotuloAcessivel?: string;
  /** rótulos do eixo (default JAN..DEZ) */
  rotulos?: string[];
}) {
  const n = valores.length;
  if (n === 0) return null;
  const { max, ticks } = escalaAgradavel(Math.max(...valores, 1));
  const px = (i: number) =>
    n === 1 ? EIXO_W + PLOT_W / 2 : EIXO_W + 18 + (i * (PLOT_W - 36)) / (n - 1);
  const py = (v: number) => BASE - (v / max) * ALT;

  const pontos = valores.map((v, i) => [px(i), py(v)] as const);
  const linha = pontos
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${linha} L${pontos[n - 1][0].toFixed(1)},${BASE} L${pontos[0][0].toFixed(1)},${BASE} Z`;

  return (
    <svg viewBox={VIEWBOX} className="w-full" role="img" aria-label={rotuloAcessivel}>
      <Moldura ticks={ticks} max={max} />
      <path d={area} fill={cor} fillOpacity={0.08} className="g-surgir" />
      <path
        d={linha}
        fill="none"
        stroke={cor}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        className="g-linha"
      />
      {pontos.map(([x, y], i) => {
        const marcado = i + 1 === destaque;
        const largura = PLOT_W / n;
        // não deixa o realce invadir a faixa dos rótulos de valor
        const x0 = Math.max(x - largura / 2, EIXO_W);
        return (
          <g key={i} className="g-col">
            <rect
              className="g-realce"
              x={x0}
              y={TOPO - 6}
              width={Math.min(largura, LARG - x0)}
              height={ALT + 6}
              rx={4}
              fill={TINTA}
            />
            <circle
              cx={x}
              cy={y}
              r={marcado ? 5 : 3}
              fill={marcado ? cor : "#fdfbf8"}
              stroke={cor}
              strokeWidth={marcado ? 2.5 : 1.8}
              className="g-surgir"
              style={{ animationDelay: `${0.7 + i * 0.04}s` }}
            >
              <title>{`${rotuloEixo(rotulos, i)}: ${formatarBRL(valores[i])}`}</title>
            </circle>
            {mostrarRotulo(n, i, marcado) ? (
              <text
                x={x}
                y={BASE + 15}
                className="g-rot"
                fontSize={9.5}
                fill={marcado ? TINTA : ROTULO}
                fontWeight={marcado ? 700 : 400}
                textAnchor="middle"
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  animationDelay: `${300 + i * 30}ms`,
                }}
              >
                {rotuloEixo(rotulos, i)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Ranking horizontal
// ---------------------------------------------------------------------------

/**
 * Barras horizontais para rankings. Cada linha tem um trilho de fundo (mostra
 * o quanto falta para o líder) e o valor em rótulo direto. Passe `nivel` por
 * item para pintar a linha com o semáforo (ex.: aging por urgência).
 */
export function BarrasHorizontais({
  itens,
  cor = COR_1,
}: {
  itens: { rotulo: string; valor: number; nivel?: Nivel }[];
  cor?: string;
}) {
  const L = 620;
  const ALT_BARRA = 20;
  const GAP = 12;
  const ROTULO_W = 175;
  const VALOR_W = 95;
  const n = itens.length;
  if (n === 0) return null;
  const max = Math.max(...itens.map((i) => i.valor), 1);
  const plotW = L - ROTULO_W - VALOR_W;
  const altura = n * (ALT_BARRA + GAP);
  const cores = itens.map((i) => (i.nivel ? NIVEL[i.nivel].cor : cor));

  return (
    <svg
      viewBox={`0 0 ${L} ${altura}`}
      className="w-full"
      role="img"
      aria-label="Ranking"
    >
      {itens.map((item, i) => {
        const y = i * (ALT_BARRA + GAP);
        const w = Math.max((item.valor / max) * plotW, 3);
        const c = cores[i];
        const rotulo =
          item.rotulo.length > 26 ? item.rotulo.slice(0, 25) + "…" : item.rotulo;
        return (
          <g key={i}>
            <text
              x={ROTULO_W - 10}
              y={y + ALT_BARRA / 2 + 3.5}
              fontSize={10.5}
              fill={TINTA}
              textAnchor="end"
            >
              {rotulo}
              <title>{item.rotulo}</title>
            </text>
            {/* trilho: o espaço que falta até o maior da lista */}
            <rect
              x={ROTULO_W}
              y={y + 1}
              width={plotW}
              height={ALT_BARRA - 2}
              rx={3}
              fill={GRADE}
              opacity={0.5}
              className="g-grade"
              style={{ animationDelay: `${i * 55}ms` }}
            />
            <rect
              x={ROTULO_W}
              y={y + 1}
              width={w}
              height={ALT_BARRA - 2}
              rx={3}
              fill={c}
              className="g-barra-x"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <title>{`${item.rotulo}: ${formatarBRL(item.valor)}`}</title>
            </rect>
            <text
              x={ROTULO_W + w + 8}
              y={y + ALT_BARRA / 2 + 3.5}
              fontSize={10.5}
              fontWeight={700}
              fill={ROTULO}
              style={{ fontFamily: "var(--font-jetbrains), monospace" }}
            >
              {formatarBRL(item.valor)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Sparkline de evolução: linha, área esvaecida e ponto final destacado. */
export function Sparkline({
  valores,
  cor = COR_1,
  rotulos,
}: {
  valores: number[];
  cor?: string;
  /** rótulos do tooltip (default JAN..DEZ) */
  rotulos?: string[];
}) {
  const L = 118;
  const A = 30;
  const PAD = 4;
  if (valores.length === 0) return null;
  const max = Math.max(...valores, 1);
  const n = valores.length;
  const px = (i: number) =>
    n === 1 ? L / 2 : PAD + (i * (L - 2 * PAD)) / (n - 1);
  const py = (v: number) => A - PAD - (v / max) * (A - 2 * PAD);
  const linha = valores
    .map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`)
    .join(" ");
  const ultimo = valores[n - 1];
  return (
    <svg viewBox={`0 0 ${L} ${A}`} width={L} height={A} role="img" aria-label="Evolução mensal">
      <path d={`${linha} L${px(n - 1)},${A} L${px(0)},${A} Z`} fill={cor} fillOpacity={0.08} />
      <path
        d={linha}
        fill="none"
        stroke={cor}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        className="g-linha"
      />
      <circle
        cx={px(n - 1)}
        cy={py(ultimo)}
        r={3}
        fill={cor}
        stroke="#fdfbf8"
        strokeWidth={1.5}
        className="g-surgir"
        style={{ animationDelay: "0.9s" }}
      />
      <title>
        {valores.map((v, i) => `${rotuloEixo(rotulos, i)} ${formatarBRL(v)}`).join(" · ")}
      </title>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// geometria de arcos (medidor e rosca)
// ---------------------------------------------------------------------------

function polar(cx: number, cy: number, r: number, ang: number): [number, number] {
  const a = ((ang - 90) * Math.PI) / 180; // 0° = topo, cresce no sentido horário
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcoPath(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number
): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const grande = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${grande} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** Soma acumulada exclusiva: [0.5, 0.3, 0.2] → [0, 0.5, 0.8] (início de cada fatia). */
function inicios(fracoes: number[]): number[] {
  const saida: number[] = [];
  let acumulado = 0;
  for (const f of fracoes) {
    saida.push(acumulado);
    acumulado += f;
  }
  return saida;
}

/** Arco no semicírculo superior, medido em fração 0..1 da esquerda p/ direita. */
function arcoMedidor(cx: number, cy: number, r: number, f0: number, f1: number) {
  const ponto = (f: number) => {
    const t = Math.PI * (1 - f);
    return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  };
  const [x0, y0] = ponto(f0);
  const [x1, y1] = ponto(f1);
  const grande = f1 - f0 > 0.5 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${grande} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/**
 * Medidor (velocímetro) com as três zonas do semáforo desenhadas no trilho:
 * o operador vê de relance em que faixa está — vermelho, âmbar ou verde — sem
 * precisar decorar limite nenhum. O arco de valor tem gradiente e halo; um
 * marcador circular fecha a ponta. O número pode passar de 100% (atrasos
 * quitados), e nesse caso o arco satura em 100% mas o texto conta a verdade.
 */
export function Medidor({
  fracao,
  rotulo,
  faixaBoa = 0.95,
  faixaAtencao = 0.8,
}: {
  fracao: number; // 1 = 100%
  rotulo?: string;
  faixaBoa?: number;
  faixaAtencao?: number;
}) {
  const cx = 110;
  const cy = 120;
  const R = 82; // raio do arco de valor
  const esp = 12; // espessura do arco de valor — fina, de instrumento
  const rZona = R + esp / 2 + 7; // anel das zonas, FORA do arco (não encosta)
  const espZona = 3;
  const t = Math.max(0, Math.min(1, fracao));
  const pct = fracao * 100;
  const nivel: Nivel =
    fracao >= faixaBoa ? "otimo" : fracao >= faixaAtencao ? "atencao" : "critico";
  const est = NIVEL[nivel];
  const ponta = (f: number, r: number): [number, number] => {
    const a = Math.PI * (1 - f);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const [mx, my] = ponta(t, R);

  // marcas de escala a cada 10%; as de 0/50/100 são mais longas
  const marcas = Array.from({ length: 11 }, (_, i) => i / 10);

  return (
    <svg
      viewBox="0 0 220 150"
      className="w-full"
      role="img"
      aria-label={`${rotulo ?? "medidor"}: ${pct.toFixed(0)}% — ${est.rotulo}`}
    >
      {/* anel externo das três zonas do semáforo — pontas retas, sem calombo */}
      <g className="g-surgir" style={{ animationDelay: "0.15s" }}>
        <path
          d={arcoMedidor(cx, cy, rZona, 0, faixaAtencao)}
          fill="none"
          stroke={NIVEL.critico.cor}
          strokeWidth={espZona}
          opacity={0.55}
        />
        <path
          d={arcoMedidor(cx, cy, rZona, faixaAtencao, faixaBoa)}
          fill="none"
          stroke={NIVEL.atencao.cor}
          strokeWidth={espZona}
          opacity={0.55}
        />
        <path
          d={arcoMedidor(cx, cy, rZona, faixaBoa, 1)}
          fill="none"
          stroke={NIVEL.otimo.cor}
          strokeWidth={espZona}
          opacity={0.55}
        />
      </g>

      {/* marcas de escala */}
      <g aria-hidden="true" className="g-surgir" style={{ animationDelay: "0.3s" }}>
        {marcas.map((f) => {
          const longa = f === 0 || f === 0.5 || f === 1;
          const r0 = R - esp / 2 - 3;
          const r1 = r0 - (longa ? 7 : 4);
          const [x0, y0] = ponta(f, r0);
          const [x1, y1] = ponta(f, r1);
          return (
            <line
              key={f}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={EIXO}
              strokeWidth={longa ? 1.2 : 0.8}
              opacity={longa ? 0.75 : 0.4}
            />
          );
        })}
      </g>

      {/* trilho do arco de valor — carrega o tooltip mesmo com 0% */}
      <path
        d={arcoMedidor(cx, cy, R, 0, 1)}
        fill="none"
        stroke={GRADE}
        strokeWidth={esp}
      >
        <title>{`${rotulo ?? "Medidor"}: ${pct.toFixed(1).replace(".", ",")}% — ${est.rotulo}`}</title>
      </path>

      {/* arco do valor — desenha-se da esquerda para a direita */}
      {t > 0 ? (
        <>
          <path
            d={arcoMedidor(cx, cy, R, 0, t)}
            fill="none"
            stroke={est.cor}
            strokeWidth={esp}
            pathLength={1}
            className="g-linha"
          >
            <title>{`${rotulo ?? ""}: ${pct.toFixed(1).replace(".", ",")}%`}</title>
          </path>
          {/* cursor na ponta: fio radial + anel, como agulha de aparelho */}
          <g className="g-surgir" style={{ animationDelay: "1.05s" }}>
            <line
              x1={ponta(t, R - esp / 2)[0]}
              y1={ponta(t, R - esp / 2)[1]}
              x2={ponta(t, R + esp / 2)[0]}
              y2={ponta(t, R + esp / 2)[1]}
              stroke="#fdfbf8"
              strokeWidth={2}
            />
            <circle
              cx={mx}
              cy={my}
              r={4}
              fill="#fdfbf8"
              stroke={est.forte}
              strokeWidth={2.5}
            />
          </g>
        </>
      ) : null}

      {/* leitura central */}
      <g className="g-surgir" style={{ animationDelay: "0.7s" }}>
        <text
          x={cx}
          y={cy - 26}
          textAnchor="middle"
          fontSize={40}
          fontWeight={700}
          fill={TINTA}
          style={{ fontFamily: "var(--font-source-serif), Georgia, serif" }}
        >
          {pct.toFixed(0)}%
        </text>
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          letterSpacing="0.16em"
          fill={ROTULO}
        >
          {est.rotulo.toUpperCase()}
        </text>
      </g>

      {/* âncoras da escala */}
      <g
        className="g-rot"
        style={{ animationDelay: "0.5s" }}
        aria-hidden="true"
      >
        <text
          x={cx - rZona}
          y={cy + 15}
          textAnchor="middle"
          fontSize={8.5}
          fill={ROTULO}
          opacity={0.75}
          style={{ fontFamily: "var(--font-jetbrains), monospace" }}
        >
          0%
        </text>
        <text
          x={cx + rZona}
          y={cy + 15}
          textAnchor="middle"
          fontSize={8.5}
          fill={ROTULO}
          opacity={0.75}
          style={{ fontFamily: "var(--font-jetbrains), monospace" }}
        >
          100%
        </text>
      </g>
    </svg>
  );
}

/**
 * Rosca (donut) de composição. Cada arco desenha-se em sequência ao redor do
 * anel, com gradiente e pontas arredondadas; a legenda ao lado carrega valor e
 * percentual. Use no máximo 4 fatias (top 3 + "Outros").
 */
export function Rosca({
  fatias,
  centroTitulo,
  centroValor,
}: {
  fatias: { rotulo: string; valor: number }[];
  centroTitulo?: string;
  centroValor?: string;
}) {
  const CORES = [COR_1, COR_2, COR_3, "#a9a7ad", "#75786f"];
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const cx = 106;
  const cy = 106;
  const R = 76;
  const esp = 22;
  if (total <= 0) return null;

  const fracoes = fatias.map((f) => f.valor / total);
  const partidas = inicios(fracoes);
  const segs = fatias.map((f, i) => {
    const frac = fracoes[i];
    const a0 = partidas[i] * 360;
    // respiro de 1,6° entre fatias — sem deixar a fatia minúscula sumir
    const a1 = Math.max((partidas[i] + frac) * 360 - 1.6, a0 + 0.6);
    return {
      ...f,
      frac,
      a0,
      a1,
      delay: partidas[i] * 0.7,
      cor: CORES[i] ?? "#75786f",
    };
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg
        viewBox="0 0 212 212"
        width={192}
        height={192}
        className="shrink-0"
        role="img"
        aria-label="Composição"
      >
        <circle
          cx={cx}
          cy={cy}
          r={R}
          fill="none"
          stroke={GRADE}
          strokeWidth={esp}
          opacity={0.5}
        />
        {/* anéis-guia finos: dão a régua do instrumento ao redor da rosca */}
        <g className="g-surgir" style={{ animationDelay: "0.15s" }}>
          <circle
            cx={cx}
            cy={cy}
            r={R + esp / 2 + 5}
            fill="none"
            stroke={EIXO}
            strokeWidth={0.75}
            opacity={0.35}
          />
          <circle
            cx={cx}
            cy={cy}
            r={R - esp / 2 - 5}
            fill="none"
            stroke={EIXO}
            strokeWidth={0.75}
            opacity={0.2}
          />
        </g>
        {segs.map((s, i) =>
          s.frac >= 0.999 ? (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={R}
              fill="none"
              stroke={s.cor}
              strokeWidth={esp}
            >
              <title>{`${s.rotulo}: ${formatarBRL(s.valor)}`}</title>
            </circle>
          ) : (
            <path
              key={i}
              d={arcoPath(cx, cy, R, s.a0, s.a1)}
              fill="none"
              stroke={s.cor}
              strokeWidth={esp}
              strokeLinecap="butt"
              pathLength={1}
              className="g-linha"
              style={{ animationDelay: `${s.delay}s` }}
            >
              <title>{`${s.rotulo}: ${formatarBRL(s.valor)} (${(s.frac * 100).toFixed(1).replace(".", ",")}%)`}</title>
            </path>
          )
        )}
        {centroValor ? (
          <text
            x={cx}
            y={cy + 2}
            textAnchor="middle"
            className="g-surgir"
            fontSize={22}
            fontWeight={700}
            fill={TINTA}
            style={{
              fontFamily: "var(--font-source-serif), Georgia, serif",
              animationDelay: "0.75s",
            }}
          >
            {centroValor}
          </text>
        ) : null}
        {centroTitulo ? (
          <text
            x={cx}
            y={cy + 19}
            textAnchor="middle"
            fontSize={9}
            letterSpacing="0.14em"
            fill={ROTULO}
          >
            {centroTitulo.toUpperCase()}
          </text>
        ) : null}
      </svg>
      <div className="flex w-full flex-col gap-2">
        {segs.map((s, i) => (
          <div
            key={i}
            className="g-chip flex items-center gap-2.5 border-b border-contorno/60 pb-2 text-xs last:border-b-0"
            style={{ animationDelay: `${0.5 + i * 0.09}s` }}
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: s.cor }}
            />
            <span className="min-w-0 flex-1 truncate text-tinta">{s.rotulo}</span>
            <span className="font-mono tabular-nums font-semibold text-tinta-suave">
              {(s.frac * 100).toFixed(0)}%
            </span>
            <span className="w-24 text-right font-mono tabular-nums text-tinta">
              {formatarBRL(s.valor)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Barra de composição em uma linha só (empilhada horizontal). Cabe dentro de
 * um card e responde "quanto do total já entrou / quanto falta" de relance.
 */
export function BarraComposicao({
  partes,
  altura = 12,
}: {
  partes: { rotulo: string; valor: number; cor: string }[];
  altura?: number;
}) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (total <= 0) return null;
  const partidas = inicios(partes.map((p) => p.valor / total));
  return (
    <div className="w-full">
      <div
        className="flex w-full overflow-hidden rounded"
        style={{ height: altura, background: GRADE }}
      >
        {partes.map((p, i) => {
          const frac = p.valor / total;
          if (frac <= 0) return null;
          return (
            <div
              key={i}
              title={`${p.rotulo}: ${formatarBRL(p.valor)} (${(frac * 100).toFixed(1).replace(".", ",")}%)`}
              className="g-fita h-full"
              style={{
                width: `${frac * 100}%`,
                background: p.cor,
                animationDelay: `${partidas[i] * 0.5}s`,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-tinta-suave">
        {partes.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: p.cor }}
            />
            {p.rotulo}
            <span className="font-mono font-semibold text-tinta">
              {formatarBRL(p.valor)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Chip de legenda (a cor fica só no ponto; o texto continua em tinta). */
export function Legenda({ itens }: { itens: { cor: string; nome: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-medium text-tinta-suave">
      {itens.map((i, idx) => (
        <span
          key={i.nome}
          className="g-chip inline-flex items-center gap-1.5"
          style={{ animationDelay: `${0.35 + idx * 0.08}s` }}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: i.cor }}
          />
          {i.nome}
        </span>
      ))}
    </div>
  );
}
