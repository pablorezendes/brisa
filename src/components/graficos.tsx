/**
 * Gráficos SVG server-side do dashboard executivo. Sem libs.
 * Paleta "pigmentos naturais" do design editorial, validada p/ CVD
 * (todos os critérios PASS): 1 musgo #4F7A33 · 2 ocre #B3801A · 3 índigo
 * #4A68A8. Texto sempre em tons de tinta (nunca na cor da série). Cada
 * gráfico traz tooltips nativos (<title>) e a página oferece a tabela.
 */
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { NOME_MES_ABREV } from "@/lib/dominio/normalizacao";

export const COR_1 = "#4f7a33"; // musgo — série principal (dinheiro que entra)
export const COR_1_FORTE = "#33511f"; // passo escuro do mesmo matiz (destaque)
export const COR_2 = "#b3801a"; // ocre
export const COR_3 = "#4a68a8"; // índigo

const GRADE = "#e5e1d8"; // contorno do papel — recessiva
const EIXO = "#75786f";
const ROTULO = "#444840";

/** Barra com topo arredondado (4px) ancorada na base. */
function BarraPath({
  x,
  y,
  w,
  h,
  cor,
  titulo,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  cor: string;
  titulo: string;
}) {
  if (h <= 0)
    return (
      <rect x={x} y={y - 1} width={w} height={1} fill={GRADE}>
        <title>{titulo}</title>
      </rect>
    );
  const r = Math.min(4, w / 2, h);
  const d = `M${x},${y + h} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
  return (
    <path d={d} fill={cor}>
      <title>{titulo}</title>
    </path>
  );
}

function Grade({
  larg,
  alt,
  topo,
  max,
}: {
  larg: number;
  alt: number;
  topo: number;
  max: number;
}) {
  const linhas = [0.5, 1];
  return (
    <>
      {linhas.map((f) => {
        const y = topo + alt - alt * f;
        return (
          <g key={f}>
            <line x1={0} x2={larg} y1={y} y2={y} stroke={GRADE} strokeWidth={1} />
            <text x={0} y={y - 3} fontSize={9} fill={ROTULO}>
              {formatarBRL(Math.round(max * f)).replace(",00", "")}
            </text>
          </g>
        );
      })}
      <line
        x1={0}
        x2={larg}
        y1={topo + alt}
        y2={topo + alt}
        stroke={EIXO}
        strokeWidth={1}
      />
    </>
  );
}

/** Série única mensal (comissão). Mês selecionado em passo mais escuro do mesmo matiz. */
export function BarrasMensais({
  valores,
  mesSelecionado,
  rotuloAcessivel = "Comissão mês a mês",
}: {
  valores: number[]; // índice 0 = JAN (centavos)
  mesSelecionado: number; // 1..12
  rotuloAcessivel?: string;
}) {
  const LARG = 560;
  const ALT = 150;
  const TOPO = 14;
  const BASE = TOPO + ALT;
  const max = Math.max(...valores, 1);
  const n = valores.length;
  const passo = LARG / n;
  const larguraBarra = Math.min(26, passo - 8);
  const maxIdx = valores.indexOf(Math.max(...valores));

  return (
    <svg
      viewBox={`0 0 ${LARG} ${BASE + 18}`}
      className="w-full"
      role="img"
      aria-label={rotuloAcessivel}
    >
      <Grade larg={LARG} alt={ALT} topo={TOPO} max={max} />
      {valores.map((v, i) => {
        const h = (v / max) * ALT;
        const x = i * passo + (passo - larguraBarra) / 2;
        const selecionado = i + 1 === mesSelecionado;
        const rotular = selecionado || i === maxIdx;
        return (
          <g key={i}>
            <BarraPath
              x={x}
              y={BASE - h}
              w={larguraBarra}
              h={h}
              cor={selecionado ? COR_1_FORTE : COR_1}
              titulo={`${NOME_MES_ABREV[i + 1]}: ${formatarBRL(v)}`}
            />
            {rotular && v > 0 ? (
              <text
                x={x + larguraBarra / 2}
                y={BASE - h - 4}
                fontSize={9}
                fontWeight={600}
                fill="#1c2430"
                textAnchor="middle"
              >
                {formatarBRL(v)}
              </text>
            ) : null}
            <text
              x={x + larguraBarra / 2}
              y={BASE + 12}
              fontSize={9}
              fill={selecionado ? "#1c2430" : ROTULO}
              fontWeight={selecionado ? 700 : 400}
              textAnchor="middle"
            >
              {NOME_MES_ABREV[i + 1]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Duas séries agrupadas por mês (Devido × Recebido), gap de 2px entre barras. */
export function BarrasDuplas({
  serieA,
  serieB,
  nomeA,
  nomeB,
  corA = COR_1,
  corB = COR_2,
}: {
  serieA: number[];
  serieB: number[];
  nomeA: string;
  nomeB: string;
  corA?: string;
  corB?: string;
}) {
  const LARG = 560;
  const ALT = 150;
  const TOPO = 14;
  const BASE = TOPO + ALT;
  const max = Math.max(...serieA, ...serieB, 1);
  const n = serieA.length;
  const passo = LARG / n;
  const larguraBarra = Math.min(12, (passo - 10) / 2);

  return (
    <svg
      viewBox={`0 0 ${LARG} ${BASE + 18}`}
      className="w-full"
      role="img"
      aria-label={`${nomeA} e ${nomeB} por mês`}
    >
      <Grade larg={LARG} alt={ALT} topo={TOPO} max={max} />
      {serieA.map((a, i) => {
        const b = serieB[i] ?? 0;
        const hA = (a / max) * ALT;
        const hB = (b / max) * ALT;
        const centro = i * passo + passo / 2;
        const xA = centro - larguraBarra - 1; // 2px de gap entre as duas
        const xB = centro + 1;
        return (
          <g key={i}>
            <BarraPath
              x={xA}
              y={BASE - hA}
              w={larguraBarra}
              h={hA}
              cor={corA}
              titulo={`${NOME_MES_ABREV[i + 1]} — ${nomeA}: ${formatarBRL(a)}`}
            />
            <BarraPath
              x={xB}
              y={BASE - hB}
              w={larguraBarra}
              h={hB}
              cor={corB}
              titulo={`${NOME_MES_ABREV[i + 1]} — ${nomeB}: ${formatarBRL(b)}`}
            />
            <text
              x={centro}
              y={BASE + 12}
              fontSize={9}
              fill={ROTULO}
              textAnchor="middle"
            >
              {NOME_MES_ABREV[i + 1]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Caixa: Receita (azul) × Despesa empilhada AL/CH (água/amarelo, gap 2px). */
export function BarrasCaixa({
  receita,
  despesaAL,
  despesaCH,
}: {
  receita: number[];
  despesaAL: number[];
  despesaCH: number[];
}) {
  const LARG = 560;
  const ALT = 150;
  const TOPO = 14;
  const BASE = TOPO + ALT;
  const max = Math.max(
    ...receita,
    ...despesaAL.map((v, i) => v + (despesaCH[i] ?? 0)),
    1
  );
  const n = receita.length;
  const passo = LARG / n;
  const larguraBarra = Math.min(12, (passo - 10) / 2);

  return (
    <svg
      viewBox={`0 0 ${LARG} ${BASE + 18}`}
      className="w-full"
      role="img"
      aria-label="Receita e despesas do caixa por mês"
    >
      <Grade larg={LARG} alt={ALT} topo={TOPO} max={max} />
      {receita.map((rec, i) => {
        const al = despesaAL[i] ?? 0;
        const ch = despesaCH[i] ?? 0;
        const centro = i * passo + passo / 2;
        const xR = centro - larguraBarra - 1;
        const xD = centro + 1;
        const hR = (rec / max) * ALT;
        const hAL = (al / max) * ALT;
        const hCH = (ch / max) * ALT;
        const mes = NOME_MES_ABREV[i + 1];
        return (
          <g key={i}>
            <BarraPath
              x={xR}
              y={BASE - hR}
              w={larguraBarra}
              h={hR}
              cor={COR_1}
              titulo={`${mes} — Receita: ${formatarBRL(rec)}`}
            />
            {/* pilha: AL na base; CH acima com 2px de respiro */}
            {hAL > 0 ? (
              <rect
                x={xD}
                y={BASE - hAL}
                width={larguraBarra}
                height={hAL}
                fill={COR_2}
              >
                <title>{`${mes} — Despesa Antonio/Laura: ${formatarBRL(al)}`}</title>
              </rect>
            ) : null}
            {hCH > 0 ? (
              <BarraPath
                x={xD}
                y={BASE - hAL - (hAL > 0 ? 2 : 0) - hCH}
                w={larguraBarra}
                h={hCH}
                cor={COR_3}
                titulo={`${mes} — Despesa Chácara Brisa: ${formatarBRL(ch)}`}
              />
            ) : null}
            <text
              x={centro}
              y={BASE + 12}
              fontSize={9}
              fill={ROTULO}
              textAnchor="middle"
            >
              {mes}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Barras horizontais para rankings (top categorias, top devedores).
 * Série única em um matiz; rótulo direto do valor em cada barra (a relação
 * de contraste da cor pede rótulos visíveis — regra do design de dados).
 */
export function BarrasHorizontais({
  itens,
  cor = COR_1,
}: {
  itens: { rotulo: string; valor: number }[];
  cor?: string;
}) {
  const LARG = 560;
  const ALT_BARRA = 18;
  const GAP = 10;
  const ROTULO_W = 170;
  const VALOR_W = 90;
  const n = itens.length;
  if (n === 0) return null;
  const max = Math.max(...itens.map((i) => i.valor), 1);
  const plotW = LARG - ROTULO_W - VALOR_W;
  const altura = n * (ALT_BARRA + GAP);

  return (
    <svg
      viewBox={`0 0 ${LARG} ${altura}`}
      className="w-full"
      role="img"
      aria-label="Ranking"
    >
      {itens.map((item, i) => {
        const y = i * (ALT_BARRA + GAP);
        const w = Math.max((item.valor / max) * plotW, 2);
        const rotulo =
          item.rotulo.length > 24 ? item.rotulo.slice(0, 23) + "…" : item.rotulo;
        return (
          <g key={i}>
            <text
              x={ROTULO_W - 8}
              y={y + ALT_BARRA / 2 + 3.5}
              fontSize={10}
              fill="#1c2430"
              textAnchor="end"
            >
              {rotulo}
              <title>{item.rotulo}</title>
            </text>
            <path
              d={`M${ROTULO_W},${y} h${w - 4} q4,0 4,4 v${ALT_BARRA - 8} q0,4 -4,4 h${-(w - 4)} z`}
              fill={cor}
            >
              <title>{`${item.rotulo}: ${formatarBRL(item.valor)}`}</title>
            </path>
            <text
              x={ROTULO_W + w + 6}
              y={y + ALT_BARRA / 2 + 3.5}
              fontSize={10}
              fontWeight={600}
              fill="#444840"
            >
              {formatarBRL(item.valor)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Sparkline de evolução (linha 2px + ponto final). */
export function Sparkline({ valores }: { valores: number[] }) {
  const LARG = 110;
  const ALT = 26;
  const PAD = 3;
  if (valores.length === 0) return null;
  const max = Math.max(...valores, 1);
  const n = valores.length;
  const px = (i: number) =>
    n === 1 ? LARG / 2 : PAD + (i * (LARG - 2 * PAD)) / (n - 1);
  const py = (v: number) => ALT - PAD - (v / max) * (ALT - 2 * PAD);
  const pontos = valores.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`);
  const ultimo = valores[n - 1];
  return (
    <svg
      viewBox={`0 0 ${LARG} ${ALT}`}
      width={LARG}
      height={ALT}
      role="img"
      aria-label="Evolução mensal"
    >
      <polyline
        points={pontos.join(" ")}
        fill="none"
        stroke={COR_1}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={px(n - 1)} cy={py(ultimo)} r={2.5} fill={COR_1_FORTE} />
      <title>
        {valores.map((v, i) => `${NOME_MES_ABREV[i + 1]} ${formatarBRL(v)}`).join(" · ")}
      </title>
    </svg>
  );
}

/** Chip de legenda (texto em tom de texto; a cor fica só no quadrado). */
export function Legenda({ itens }: { itens: { cor: string; nome: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
      {itens.map((i) => (
        <span key={i.nome} className="inline-flex items-center gap-1.5">
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
