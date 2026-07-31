/**
 * Gráficos SVG server-side. Sem libs, sem JavaScript no cliente.
 *
 * Linguagem visual: a base editorial (papel quente, tinta azul-preta) ganhou
 * profundidade — gradiente vertical em cada série, halo suave no que está em
 * foco, grade pontilhada recessiva e moldura com eixo de valores à esquerda.
 * O realce de coluna no hover é CSS puro (.g-col:hover), então continua
 * funcionando em componente de servidor.
 *
 * Paleta validada para daltonismo (todos os critérios PASS):
 *   1 verde #2f7d4f (dinheiro que entra) · 2 ocre #b3801a (o que era devido)
 *   3 índigo #3f5fa8 (terceira série). Texto SEMPRE em tom de tinta, nunca na
 *   cor da série. Todo gráfico traz <title> (tooltip nativo) e a página oferece
 *   a mesma informação em tabela.
 */
import { abreviarBRL, formatarBRL } from "@/lib/dominio/dinheiro";
import { NOME_MES_ABREV } from "@/lib/dominio/normalizacao";
import { NIVEL, type Nivel } from "@/lib/dominio/semaforo";

export const COR_1 = "#2f7d4f"; // verde — série principal (dinheiro que entra)
export const COR_1_FORTE = "#1b5733"; // passo escuro do mesmo matiz (destaque)
export const COR_2 = "#b3801a"; // ocre — devido / atenção
export const COR_3 = "#3f5fa8"; // índigo — terceira série

const GRADE = "#e0dcd2"; // grade recessiva
const EIXO = "#b9b4a8";
const ROTULO = "#5c6058";
const TINTA = "#1c2430";

// ---------------------------------------------------------------------------
// geometria comum das molduras verticais
// ---------------------------------------------------------------------------

const LARG = 620;
const EIXO_W = 56; // faixa dos rótulos de valor, à esquerda
const TOPO = 20;
const ALT = 168;
const BASE = TOPO + ALT;
const ROD = 24; // faixa dos nomes de mês, embaixo
const PLOT_W = LARG - EIXO_W;
const VIEWBOX = `0 0 ${LARG} ${BASE + ROD}`;

/** Clareia um hex em direção ao branco (0 = igual, 1 = branco). */
function clarear(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const canal = (c: number) => Math.round(c + (255 - c) * f);
  const r = canal((n >> 16) & 255);
  const g = canal((n >> 8) & 255);
  const b = canal(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** id determinístico por cor: mesma cor ⇒ mesma definição, colisão inofensiva. */
function gid(cor: string): string {
  return `gr${cor.replace("#", "")}`;
}

/**
 * Gradientes e halo de cada gráfico. Como o id deriva da cor, dois gráficos na
 * mesma página compartilham definições idênticas sem conflito visual.
 */
function Defs({ cores }: { cores: string[] }) {
  const unicas = [...new Set(cores)];
  return (
    <defs>
      {unicas.map((c) => (
        <linearGradient key={c} id={gid(c)} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={clarear(c, 0.38)} />
          <stop offset="55%" stopColor={clarear(c, 0.08)} />
          <stop offset="100%" stopColor={c} />
        </linearGradient>
      ))}
      {unicas.map((c) => (
        <linearGradient
          key={`x${c}`}
          id={`${gid(c)}x`}
          x1="0"
          y1="0"
          x2="1"
          y2="0"
        >
          <stop offset="0%" stopColor={c} />
          <stop offset="100%" stopColor={clarear(c, 0.34)} />
        </linearGradient>
      ))}
      {unicas.map((c) => (
        <linearGradient
          key={`a${c}`}
          id={`${gid(c)}a`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={c} stopOpacity={0.3} />
          <stop offset="100%" stopColor={c} stopOpacity={0.02} />
        </linearGradient>
      ))}
      <filter id="halo" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3.5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

/** Barra vertical com topo arredondado, ancorada na base. Cresce ao carregar. */
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
  /** série em destaque: ganha halo e traço de topo */
  foco?: boolean;
}) {
  if (h <= 0.5)
    return (
      <rect x={x} y={y - 1} width={w} height={1.5} fill={EIXO} rx={0.75}>
        <title>{titulo}</title>
      </rect>
    );
  const r = Math.min(5, w / 2, h);
  const d = `M${x},${y + h} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
  return (
    <g
      className="g-barra"
      style={{ animationDelay: `${delayMs}ms` }}
      filter={foco ? "url(#halo)" : undefined}
    >
      <path d={d} fill={`url(#${gid(cor)})`}>
        <title>{titulo}</title>
      </path>
      {/* fio de luz no topo: dá relevo sem sombra */}
      <path
        d={`M${x + 0.6},${y + r} q0,${-r + 0.6} ${r - 0.6},${-r + 0.6} h${w - 2 * r + 1.2} q${r - 0.6},0 ${r - 0.6},${r - 0.6}`}
        fill="none"
        stroke={clarear(cor, 0.62)}
        strokeWidth={1.1}
        strokeLinecap="round"
      />
    </g>
  );
}

/** Grade pontilhada + eixo de valores à esquerda + linha de base. */
function Moldura({ max, niveis = 4 }: { max: number; niveis?: number }) {
  const linhas = Array.from({ length: niveis }, (_, i) => (i + 1) / niveis);
  return (
    <g aria-hidden="true">
      {linhas.map((f) => {
        const y = TOPO + ALT - ALT * f;
        return (
          <g key={f}>
            <line
              x1={EIXO_W}
              x2={LARG}
              y1={y}
              y2={y}
              stroke={GRADE}
              strokeWidth={1}
              strokeDasharray="2 5"
            />
            <text
              x={EIXO_W - 9}
              y={y + 3.2}
              fontSize={9.5}
              fill={ROTULO}
              textAnchor="end"
              style={{ fontFamily: "var(--font-jetbrains), monospace" }}
            >
              {abreviarBRL(Math.round(max * f))}
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
      />
    </g>
  );
}

/** Faixa clicável/hoverável que acende a coluna inteira do mês. */
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
        y={TOPO - 6}
        width={w}
        height={ALT + 6}
        rx={4}
        fill={TINTA}
      />
      {children}
    </g>
  );
}

/** Etiqueta de valor sobre a barra em foco (pílula de leitura rápida). */
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
  const w = texto.length * 5.4 + 12;
  return (
    <g className="g-surgir" style={{ animationDelay: "0.6s" }}>
      <rect
        x={x - w / 2}
        y={y - 15}
        width={w}
        height={15}
        rx={7.5}
        fill={cor}
        opacity={0.12}
      />
      <text
        x={x}
        y={y - 4.5}
        fontSize={9.5}
        fontWeight={700}
        fill={cor}
        textAnchor="middle"
        style={{ fontFamily: "var(--font-jetbrains), monospace" }}
      >
        {texto}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Gráficos de coluna
// ---------------------------------------------------------------------------

/** Série única mensal (comissão). Mês selecionado com halo e etiqueta. */
export function BarrasMensais({
  valores,
  mesSelecionado,
  rotuloAcessivel = "Comissão mês a mês",
  cor = COR_1,
}: {
  valores: number[]; // índice 0 = JAN (centavos)
  mesSelecionado: number; // 1..12
  rotuloAcessivel?: string;
  cor?: string;
}) {
  const max = Math.max(...valores, 1);
  const n = valores.length;
  const passo = PLOT_W / n;
  const larguraBarra = Math.min(30, passo - 10);
  const maxIdx = valores.indexOf(Math.max(...valores));

  return (
    <svg viewBox={VIEWBOX} className="w-full" role="img" aria-label={rotuloAcessivel}>
      <Defs cores={[cor, COR_1_FORTE]} />
      <Moldura max={max} />
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
              titulo={`${NOME_MES_ABREV[i + 1]}: ${formatarBRL(v)}`}
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
            <text
              x={centro}
              y={BASE + 15}
              fontSize={9.5}
              fill={selecionado ? TINTA : ROTULO}
              fontWeight={selecionado ? 700 : 400}
              textAnchor="middle"
              style={{ fontFamily: "var(--font-jetbrains), monospace" }}
            >
              {NOME_MES_ABREV[i + 1]}
            </text>
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
}: {
  serieA: number[];
  serieB: number[];
  nomeA: string;
  nomeB: string;
  corA?: string;
  corB?: string;
  /** 1..12 — recebe marcação embaixo, se informado */
  mesSelecionado?: number;
}) {
  const max = Math.max(...serieA, ...serieB, 1);
  const n = serieA.length;
  const passo = PLOT_W / n;
  const larguraBarra = Math.min(14, (passo - 12) / 2);

  return (
    <svg
      viewBox={VIEWBOX}
      className="w-full"
      role="img"
      aria-label={`${nomeA} e ${nomeB} por mês`}
    >
      <Defs cores={[corA, corB]} />
      <Moldura max={max} />
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
              titulo={`${NOME_MES_ABREV[i + 1]} — ${nomeA}: ${formatarBRL(a)}`}
              delayMs={i * 45}
            />
            <Barra
              x={centro + 1.5}
              y={BASE - hB}
              w={larguraBarra}
              h={hB}
              cor={corB}
              titulo={`${NOME_MES_ABREV[i + 1]} — ${nomeB}: ${formatarBRL(b)}`}
              delayMs={i * 45 + 20}
              foco={selecionado}
            />
            <text
              x={centro}
              y={BASE + 15}
              fontSize={9.5}
              fill={selecionado ? TINTA : ROTULO}
              fontWeight={selecionado ? 700 : 400}
              textAnchor="middle"
              style={{ fontFamily: "var(--font-jetbrains), monospace" }}
            >
              {NOME_MES_ABREV[i + 1]}
            </text>
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
}: {
  receita: number[];
  despesaAL: number[];
  despesaCH: number[];
}) {
  const max = Math.max(
    ...receita,
    ...despesaAL.map((v, i) => v + (despesaCH[i] ?? 0)),
    1
  );
  const n = receita.length;
  const passo = PLOT_W / n;
  const larguraBarra = Math.min(14, (passo - 12) / 2);

  return (
    <svg
      viewBox={VIEWBOX}
      className="w-full"
      role="img"
      aria-label="Receita e despesas do caixa por mês"
    >
      <Defs cores={[COR_1, COR_2, COR_3]} />
      <Moldura max={max} />
      {receita.map((rec, i) => {
        const al = despesaAL[i] ?? 0;
        const ch = despesaCH[i] ?? 0;
        const centro = EIXO_W + i * passo + passo / 2;
        const xD = centro + 1.5;
        const hR = (rec / max) * ALT;
        const hAL = (al / max) * ALT;
        const hCH = (ch / max) * ALT;
        const mes = NOME_MES_ABREV[i + 1];
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
                  fill={`url(#${gid(COR_2)})`}
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
            <text
              x={centro}
              y={BASE + 15}
              fontSize={9.5}
              fill={ROTULO}
              textAnchor="middle"
              style={{ fontFamily: "var(--font-jetbrains), monospace" }}
            >
              {mes}
            </text>
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
}: {
  valores: number[];
  cor?: string;
  /** 1..12 — ponto marcado com anel */
  destaque?: number;
  rotuloAcessivel?: string;
}) {
  const n = valores.length;
  if (n === 0) return null;
  const max = Math.max(...valores, 1);
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
      <Defs cores={[cor]} />
      <Moldura max={max} />
      <path d={area} fill={`url(#${gid(cor)}a)`} className="g-surgir" />
      <path
        d={linha}
        fill="none"
        stroke={cor}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        className="g-linha"
        filter="url(#halo)"
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
              <title>{`${NOME_MES_ABREV[i + 1]}: ${formatarBRL(valores[i])}`}</title>
            </circle>
            <text
              x={x}
              y={BASE + 15}
              fontSize={9.5}
              fill={marcado ? TINTA : ROTULO}
              fontWeight={marcado ? 700 : 400}
              textAnchor="middle"
              style={{ fontFamily: "var(--font-jetbrains), monospace" }}
            >
              {NOME_MES_ABREV[i + 1]}
            </text>
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
      <Defs cores={[...cores, cor]} />
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
              rx={(ALT_BARRA - 2) / 2}
              fill={GRADE}
              opacity={0.55}
            />
            <rect
              x={ROTULO_W}
              y={y + 1}
              width={w}
              height={ALT_BARRA - 2}
              rx={(ALT_BARRA - 2) / 2}
              fill={`url(#${gid(c)}x)`}
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
              fill={item.nivel ? NIVEL[item.nivel].forte : "#3f423b"}
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
}: {
  valores: number[];
  cor?: string;
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
      <Defs cores={[cor]} />
      <path d={`${linha} L${px(n - 1)},${A} L${px(0)},${A} Z`} fill={`url(#${gid(cor)}a)`} />
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
        {valores.map((v, i) => `${NOME_MES_ABREV[i + 1]} ${formatarBRL(v)}`).join(" · ")}
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
  const cy = 116;
  const R = 88;
  const esp = 17;
  const t = Math.max(0, Math.min(1, fracao));
  const pct = fracao * 100;
  const nivel: Nivel =
    fracao >= faixaBoa ? "otimo" : fracao >= faixaAtencao ? "atencao" : "critico";
  const est = NIVEL[nivel];
  const [mx, my] = [
    cx + R * Math.cos(Math.PI * (1 - t)),
    cy - R * Math.sin(Math.PI * (1 - t)),
  ];

  return (
    <svg
      viewBox="0 0 220 138"
      className="w-full"
      role="img"
      aria-label={`${rotulo ?? "medidor"}: ${pct.toFixed(0)}% — ${est.rotulo}`}
    >
      <Defs cores={[est.cor]} />
      {/* trilho com as três zonas do semáforo, bem esmaecidas */}
      <path
        d={arcoMedidor(cx, cy, R, 0, faixaAtencao)}
        fill="none"
        stroke={NIVEL.critico.cor}
        strokeWidth={esp}
        opacity={0.16}
        strokeLinecap="round"
      />
      <path
        d={arcoMedidor(cx, cy, R, faixaAtencao, faixaBoa)}
        fill="none"
        stroke={NIVEL.atencao.cor}
        strokeWidth={esp}
        opacity={0.2}
      />
      <path
        d={arcoMedidor(cx, cy, R, faixaBoa, 1)}
        fill="none"
        stroke={NIVEL.otimo.cor}
        strokeWidth={esp}
        opacity={0.18}
        strokeLinecap="round"
      />
      {/* marcas dos limites das faixas */}
      {[faixaAtencao, faixaBoa].map((f) => {
        const t0 = Math.PI * (1 - f);
        const r0 = R - esp / 2 - 1;
        const r1 = R + esp / 2 + 1;
        return (
          <line
            key={f}
            x1={cx + r0 * Math.cos(t0)}
            y1={cy - r0 * Math.sin(t0)}
            x2={cx + r1 * Math.cos(t0)}
            y2={cy - r1 * Math.sin(t0)}
            stroke="#fdfbf8"
            strokeWidth={2}
          />
        );
      })}
      {/* arco do valor */}
      {t > 0 ? (
        <>
          <path
            d={arcoMedidor(cx, cy, R, 0, t)}
            fill="none"
            stroke={est.cor}
            strokeWidth={esp}
            strokeLinecap="round"
            pathLength={1}
            className="g-linha"
            filter="url(#halo)"
          >
            <title>{`${rotulo ?? ""}: ${pct.toFixed(1).replace(".", ",")}%`}</title>
          </path>
          <circle
            cx={mx}
            cy={my}
            r={esp / 2 - 2.5}
            fill="#fdfbf8"
            stroke={est.forte}
            strokeWidth={3}
            className="g-surgir"
            style={{ animationDelay: "1s" }}
          />
        </>
      ) : null}
      {/* leitura central */}
      <text
        x={cx}
        y={cy - 22}
        textAnchor="middle"
        fontSize={38}
        fontWeight={700}
        fill={TINTA}
        style={{ fontFamily: "var(--font-source-serif), Georgia, serif" }}
      >
        {pct.toFixed(0)}%
      </text>
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        letterSpacing="0.12em"
        fill={est.forte}
      >
        {`${est.icone}  ${est.rotulo.toUpperCase()}`}
      </text>
      {/* âncoras 0% e 100% */}
      <text x={cx - R} y={cy + 17} textAnchor="middle" fontSize={9} fill={ROTULO}>
        0%
      </text>
      <text x={cx + R} y={cy + 17} textAnchor="middle" fontSize={9} fill={ROTULO}>
        100%
      </text>
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
  const CORES = [COR_1, COR_2, COR_3, "#8a8578", "#5c6058"];
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const cx = 96;
  const cy = 96;
  const R = 68;
  const esp = 24;
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
      cor: CORES[i] ?? "#5c6058",
    };
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg
        viewBox="0 0 192 192"
        width={168}
        height={168}
        className="shrink-0"
        role="img"
        aria-label="Composição"
      >
        <Defs cores={segs.map((s) => s.cor)} />
        <circle
          cx={cx}
          cy={cy}
          r={R}
          fill="none"
          stroke={GRADE}
          strokeWidth={esp}
          opacity={0.5}
        />
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
              strokeLinecap="round"
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
            fontSize={20}
            fontWeight={700}
            fill={TINTA}
            style={{ fontFamily: "var(--font-source-serif), Georgia, serif" }}
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
          <div key={i} className="flex items-center gap-2.5 text-xs">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-full"
              style={{
                background: `linear-gradient(135deg, ${clarear(s.cor, 0.3)}, ${s.cor})`,
              }}
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
        className="flex w-full overflow-hidden rounded-full"
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
                background: `linear-gradient(90deg, ${p.cor}, ${clarear(p.cor, 0.28)})`,
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
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: p.cor }}
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
      {itens.map((i) => (
        <span key={i.nome} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background: `linear-gradient(135deg, ${clarear(i.cor, 0.3)}, ${i.cor})`,
            }}
          />
          {i.nome}
        </span>
      ))}
    </div>
  );
}
