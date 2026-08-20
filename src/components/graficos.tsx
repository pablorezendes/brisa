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

export const COR_1 = "#4f7a33"; // musgo — dinheiro que ENTRA
export const COR_1_FORTE = "#33511f"; // passo escuro do mesmo matiz (destaque)
export const COR_2 = "#b3801a"; // ocre — o que era DEVIDO, ainda não é saída

/**
 * Dinheiro que SAI é sempre vermelho.
 *
 * Antes cada centro de custo usava a cor da identidade visual dele (ocre para
 * Antonio/Laura, índigo para a Chácara). Bonito, mas o olho não lia "isso é
 * despesa" — a cor não carregava o dado. Agora os dois centros são terracota,
 * distinguidos pela LUMINOSIDADE (um claro, um escuro), o que sobrevive tanto
 * ao daltonismo quanto à impressão em preto e branco.
 */
export const COR_SAIDA = "#ba1a1a"; // terracota (--erro) — despesa
export const COR_SAIDA_2 = "#7a1f1f"; // terracota escura — segundo centro

export const COR_3 = "#4a68a8"; // índigo — série neutra (não é entrada nem saída)

const GRADE = "#e5e1d8"; // --contorno
const EIXO = "#75786f"; // --contorno-forte
const ROTULO = "#444840"; // --tinta-suave
const TINTA = "#1c2430"; // --tinta
const CARTA = "#fdfbf8"; // --carta (fundo dos cards e dos tooltips)

// ---------------------------------------------------------------------------
// utilitários premium: mistura de cor, ids únicos e tooltip rico
// ---------------------------------------------------------------------------

/** Mistura duas cores hex (t=0 → a, t=1 → b). Para gradientes tom-sobre-tom. */
function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return (
    "#" +
    pa
      .map((v, i) =>
        Math.round(v + (pb[i] - v) * t)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

/**
 * Id único por instância de gráfico (defs de gradiente e regras :has do
 * tooltip não podem colidir entre gráficos da mesma página). Contador de
 * módulo: monotônico dentro de uma renderização — suficiente, pois estes
 * SVGs são server components e nunca re-hidratam no cliente.
 */
let sequencia = 0;
function novoUid(): string {
  sequencia = (sequencia + 1) % 100000;
  return `gx${sequencia}`;
}

/**
 * Gradiente vertical sutil da série: topo 16% mais claro (na direção do
 * papel), base na cor sólida. Dá volume de material sem distorcer leitura —
 * o comprimento da barra continua sendo a única codificação do valor.
 */
function DefsGradientes({ uid, cores }: { uid: string; cores: string[] }) {
  return (
    <defs>
      {cores.map((c, i) => (
        <linearGradient key={i} id={`${uid}-g${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={mixHex(c, CARTA, 0.18)} />
          <stop offset="100%" stopColor={c} />
        </linearGradient>
      ))}
    </defs>
  );
}

/** Linha de conteúdo de um tooltip rico. */
interface LinhaTip {
  cor?: string;
  nome: string;
  valor: string;
}

// Corpo do tip em 12 unidades SVG: nos cards de meia largura (~424px reais
// para um viewBox de 620) isso rende ≈8-9px na tela — o mínimo legível.
// Fonte 9 ficava com ~6px reais e virava decoração.
const TIP_CHAR = 7.2; // largura média do mono 12px
const TIP_ALT_LINHA = 15.5;

/**
 * Tooltip rico: cartão desenhado DENTRO do SVG, pintado por último (SVG não
 * tem z-index). Fica invisível até o hover da coluna correspondente — a regra
 * CSS por índice é gerada em <style> pelo EstiloTips, via :has().
 */
function Tip({
  i,
  centro,
  titulo,
  linhas,
}: {
  i: number;
  centro: number;
  titulo: string;
  linhas: LinhaTip[];
}) {
  const maiorLinha = Math.max(
    titulo.length,
    ...linhas.map((l) => l.nome.length + l.valor.length + 2)
  );
  const w = Math.min(maiorLinha * TIP_CHAR + 30, PLOT_W - 8);
  const h = 19 + linhas.length * TIP_ALT_LINHA + 6;
  const x = Math.min(Math.max(centro - w / 2, EIXO_W + 3), LARG - w - 3);
  const y = TOPO - 16;
  return (
    <g className={`g-tip g-t${i}`} aria-hidden="true">
      <rect x={x} y={y} width={w} height={h} rx={5} fill={CARTA} stroke={TINTA} strokeWidth={1} />
      <text
        x={x + 11}
        y={y + 14}
        fontSize={10.5}
        fontWeight={700}
        letterSpacing="0.08em"
        fill={ROTULO}
        style={{ fontFamily: "var(--font-jetbrains), monospace" }}
      >
        {titulo.toUpperCase()}
      </text>
      {linhas.map((l, j) => {
        const ly = y + 19 + (j + 1) * TIP_ALT_LINHA - 4;
        return (
          <g key={j}>
            {l.cor ? <circle cx={x + 15} cy={ly - 4} r={3.5} fill={l.cor} /> : null}
            <text
              x={l.cor ? x + 24 : x + 11}
              y={ly}
              fontSize={12}
              fill={TINTA}
              style={{ fontFamily: "var(--font-jetbrains), monospace" }}
            >
              {l.nome}
            </text>
            <text
              x={x + w - 11}
              y={ly}
              fontSize={12}
              fontWeight={700}
              fill={TINTA}
              textAnchor="end"
              style={{ fontFamily: "var(--font-jetbrains), monospace" }}
            >
              {l.valor}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Regras :has() que ligam cada coluna ao seu tooltip, escopadas pelo uid.
 * Requisito: navegador com :has() (Chrome 105+, Safari 15.4+, Firefox 121+).
 * Em navegador sem :has o tip simplesmente nunca aparece — a informação
 * continua disponível na tabela que acompanha todo gráfico.
 */
function EstiloTips({ uid, n }: { uid: string; n: number }) {
  const regras = Array.from(
    { length: n },
    (_, i) =>
      `.${uid}:has(.g-c${i}:hover) .g-t${i}{opacity:1;transform:translateY(0)}`
  ).join("\n");
  return <style>{regras}</style>;
}

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
  fill,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  cor: string;
  titulo?: string;
  delayMs?: number;
  /** série em destaque: ganha marca de topo */
  foco?: boolean;
  /** pintura do corpo (ex.: url(#gradiente)); default = cor sólida */
  fill?: string;
}) {
  if (h <= 0.5)
    return (
      <rect x={x} y={y - 1} width={w} height={1.5} fill={EIXO} rx={0.75}>
        {titulo ? <title>{titulo}</title> : null}
      </rect>
    );
  const r = Math.min(3, w / 2, h);
  const d = `M${x},${y + h} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
  return (
    <g className="g-barra" style={{ animationDelay: `${delayMs}ms` }}>
      <path d={d} fill={fill ?? cor}>
        {titulo ? <title>{titulo}</title> : null}
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
    </g>
  );
}

/** Faixa hoverável que acende a coluna inteira do mês (crosshair sem JS). */
function ColunaHover({
  x,
  w,
  children,
  indice,
}: {
  x: number;
  w: number;
  children: React.ReactNode;
  /** índice da coluna — liga a coluna ao seu tooltip rico via .g-cN */
  indice?: number;
}) {
  return (
    <g className={indice === undefined ? "g-col" : `g-col g-c${indice}`}>
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
  const uid = novoUid();

  return (
    <svg
      viewBox={VIEWBOX}
      className={`w-full ${uid}`}
      role="img"
      aria-label={rotuloAcessivel}
    >
      <DefsGradientes uid={uid} cores={[cor, COR_1_FORTE]} />
      <EstiloTips uid={uid} n={n} />
      <Moldura ticks={ticks} max={max} />
      {valores.map((v, i) => {
        const h = (v / max) * ALT;
        const centro = EIXO_W + i * passo + passo / 2;
        const x = centro - larguraBarra / 2;
        const selecionado = i + 1 === mesSelecionado;
        const rotular = selecionado || i === maxIdx;
        return (
          <ColunaHover key={i} x={EIXO_W + i * passo + 2} w={passo - 4} indice={i}>
            <Barra
              x={x}
              y={BASE - h}
              w={larguraBarra}
              h={h}
              cor={selecionado ? COR_1_FORTE : cor}
              fill={`url(#${uid}-g${selecionado ? 1 : 0})`}
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
      {/* camada de tooltips — pintada por último, sempre por cima */}
      {valores.map((v, i) => (
        <Tip
          key={i}
          i={i}
          centro={EIXO_W + i * passo + passo / 2}
          titulo={rotuloEixo(rotulos, i)}
          linhas={[
            { cor, nome: "valor", valor: formatarBRL(v) },
            ...(i > 0
              ? [
                  {
                    nome: "vs anterior",
                    valor: variacaoTexto(v, valores[i - 1]),
                  },
                ]
              : []),
          ]}
        />
      ))}
    </svg>
  );
}

/** "▲ 12%" / "▼ 8%" / "estável" — comparação curta para tooltips. */
function variacaoTexto(atual: number, anterior: number): string {
  if (anterior === 0) return atual > 0 ? "novo" : "—";
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < 0.5) return "estável";
  return `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`;
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
  const uid = novoUid();

  return (
    <svg
      viewBox={VIEWBOX}
      className={`w-full ${uid}`}
      role="img"
      aria-label={`${nomeA} e ${nomeB} por mês`}
    >
      <DefsGradientes uid={uid} cores={[corA, corB]} />
      <EstiloTips uid={uid} n={n} />
      <Moldura ticks={ticks} max={max} />
      {serieA.map((a, i) => {
        const b = serieB[i] ?? 0;
        const hA = (a / max) * ALT;
        const hB = (b / max) * ALT;
        const centro = EIXO_W + i * passo + passo / 2;
        const selecionado = i + 1 === mesSelecionado;
        return (
          <ColunaHover key={i} x={EIXO_W + i * passo + 2} w={passo - 4} indice={i}>
            <Barra
              x={centro - larguraBarra - 1.5}
              y={BASE - hA}
              w={larguraBarra}
              h={hA}
              cor={corA}
              fill={`url(#${uid}-g0)`}
              delayMs={i * 45}
            />
            <Barra
              x={centro + 1.5}
              y={BASE - hB}
              w={larguraBarra}
              h={hB}
              cor={corB}
              fill={`url(#${uid}-g1)`}
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
      {serieA.map((a, i) => {
        const b = serieB[i] ?? 0;
        return (
          <Tip
            key={i}
            i={i}
            centro={EIXO_W + i * passo + passo / 2}
            titulo={rotuloEixo(rotulos, i)}
            linhas={[
              { cor: corA, nome: nomeA.toLowerCase(), valor: formatarBRL(a) },
              { cor: corB, nome: nomeB.toLowerCase(), valor: formatarBRL(b) },
              { nome: "diferença", valor: formatarBRL(b - a) },
            ]}
          />
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
  const uid = novoUid();

  return (
    <svg
      viewBox={VIEWBOX}
      className={`w-full ${uid}`}
      role="img"
      aria-label="Receita e despesas do caixa por mês"
    >
      <DefsGradientes uid={uid} cores={[COR_1, COR_SAIDA, COR_SAIDA_2]} />
      <EstiloTips uid={uid} n={n} />
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
          <ColunaHover key={i} x={EIXO_W + i * passo + 2} w={passo - 4} indice={i}>
            <Barra
              x={centro - larguraBarra - 1.5}
              y={BASE - hR}
              w={larguraBarra}
              h={hR}
              cor={COR_1}
              fill={`url(#${uid}-g0)`}
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
                  fill={`url(#${uid}-g1)`}
                />
              </g>
            ) : null}
            {hCH > 0 ? (
              <Barra
                x={xD}
                y={BASE - hAL - (hAL > 0 ? 2 : 0) - hCH}
                w={larguraBarra}
                h={hCH}
                cor={COR_SAIDA_2}
                fill={`url(#${uid}-g2)`}
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
      {receita.map((rec, i) => {
        const al = despesaAL[i] ?? 0;
        const ch = despesaCH[i] ?? 0;
        const saldo = rec - al - ch;
        // 3 linhas escaneáveis: o rateio A/L × chácara já está nas barras,
        // na legenda e na tabela — o tip responde "entrou, saiu, sobrou"
        return (
          <Tip
            key={i}
            i={i}
            centro={EIXO_W + i * passo + passo / 2}
            titulo={rotuloEixo(rotulos, i)}
            linhas={[
              { cor: COR_1, nome: "receita", valor: formatarBRL(rec) },
              { cor: COR_SAIDA, nome: "saídas", valor: formatarBRL(al + ch) },
              { nome: "saldo", valor: formatarBRL(saldo) },
            ]}
          />
        );
      })}
    </svg>
  );
}

/**
 * Tendência mensal em linha (com ou sem preenchimento).
 *
 * Regra de honestidade: meses do FIM da série sem valor não são "zero", são
 * meses que ainda não aconteceram. A curva para no último mês com dado — sem
 * isso a linha despencava até a base e corria rente ao eixo, dando a leitura
 * falsa de que a comissão tinha zerado. Zeros no MEIO da série continuam
 * sendo desenhados: ali o zero é informação de verdade.
 */
export function AreaTendencia({
  valores,
  cor = COR_1,
  destaque,
  rotuloAcessivel = "Tendência mensal",
  rotulos,
  preenchimento = true,
}: {
  valores: number[];
  cor?: string;
  /** posição 1-based na série — ponto cheio */
  destaque?: number;
  rotuloAcessivel?: string;
  /** rótulos do eixo (default JAN..DEZ) */
  rotulos?: string[];
  /** false = só a linha, sem a mancha embaixo */
  preenchimento?: boolean;
}) {
  const n = valores.length;
  if (n === 0) return null;
  const { max, ticks } = escalaAgradavel(Math.max(...valores, 1));
  const px = (i: number) =>
    n === 1 ? EIXO_W + PLOT_W / 2 : EIXO_W + 18 + (i * (PLOT_W - 36)) / (n - 1);
  const py = (v: number) => BASE - (v / max) * ALT;

  // último mês com movimento: daí para a frente é futuro, não é zero
  let ultimo = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (valores[i] > 0) {
      ultimo = i;
      break;
    }
  }
  const comDado = valores.slice(0, ultimo + 1);
  const pontos = comDado.map((v, i) => [px(i), py(v)] as const);
  const linha = pontos
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area =
    pontos.length > 1
      ? `${linha} L${pontos[pontos.length - 1][0].toFixed(1)},${BASE} L${pontos[0][0].toFixed(1)},${BASE} Z`
      : "";
  // com muitos pontos a série vira um colar de bolinhas: marca só o destaque
  const marcarPontos = pontos.length <= 14;
  const uid = novoUid();

  return (
    <svg
      viewBox={VIEWBOX}
      className={`w-full ${uid}`}
      role="img"
      aria-label={rotuloAcessivel}
    >
      <defs>
        {/* véu de gradiente sob a linha: presença sem peso */}
        <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity={0.2} />
          <stop offset="100%" stopColor={cor} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      <EstiloTips uid={uid} n={ultimo + 1} />
      <Moldura ticks={ticks} max={max} />
      {preenchimento && area ? (
        <path
          d={area}
          fill={`url(#${uid}-area)`}
          className="g-surgir"
          style={{ animationDelay: "0.35s" }}
        />
      ) : null}
      {pontos.length > 1 ? (
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
      ) : null}
      {valores.map((v, i) => {
        const marcado = i + 1 === destaque && i <= ultimo;
        const futuro = i > ultimo;
        const x = px(i);
        return (
          <g key={i} className={futuro ? undefined : `g-col g-c${i}`}>
            {!futuro ? (
              <rect
                className="g-realce"
                x={Math.max(x - PLOT_W / n / 2, EIXO_W)}
                y={TOPO - 8}
                width={PLOT_W / n}
                height={ALT + 8}
                rx={3}
                fill={TINTA}
              />
            ) : null}
            {/* o pulso é sinal de "agora": só no ponto destacado quando ele
                é de fato o último mês com dado — um mês histórico em foco
                não deve fingir recência */}
            {marcado && i === ultimo ? (
              <circle
                cx={x}
                cy={py(v)}
                r={5}
                fill="none"
                stroke={cor}
                strokeWidth={1.5}
                className="g-pulso"
                aria-hidden="true"
              />
            ) : null}
            {!futuro && (marcarPontos || marcado) ? (
              <circle
                cx={x}
                cy={py(v)}
                r={marcado ? 4.5 : 2.5}
                fill={marcado ? cor : "#fdfbf8"}
                stroke={cor}
                strokeWidth={marcado ? 0 : 1.6}
                className="g-surgir"
                style={{ animationDelay: `${0.75 + i * 0.035}s` }}
              />
            ) : null}
            {mostrarRotulo(n, i, marcado) ? (
              <text
                x={x}
                y={BASE + 15}
                className="g-rot"
                fontSize={9.5}
                fill={marcado ? TINTA : ROTULO}
                fontWeight={marcado ? 700 : 400}
                opacity={futuro ? 0.4 : 1}
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
      {ultimo < 0 ? (
        <text
          x={EIXO_W + PLOT_W / 2}
          y={TOPO + ALT / 2}
          textAnchor="middle"
          fontSize={11}
          fill={ROTULO}
          opacity={0.7}
        >
          sem movimento no período
        </text>
      ) : null}
      {/* tooltips ricos — só nos meses que já aconteceram */}
      {comDado.map((v, i) => (
        <Tip
          key={i}
          i={i}
          centro={px(i)}
          titulo={rotuloEixo(rotulos, i)}
          linhas={[
            { cor, nome: "valor", valor: formatarBRL(v) },
            ...(i > 0
              ? [{ nome: "vs anterior", valor: variacaoTexto(v, comDado[i - 1]) }]
              : []),
          ]}
        />
      ))}
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
  const cy = 112;
  const R = 82;
  const esp = 14;
  const t = Math.max(0, Math.min(1, fracao));
  const pct = fracao * 100;
  const nivel: Nivel =
    fracao >= faixaBoa ? "otimo" : fracao >= faixaAtencao ? "atencao" : "critico";
  const est = NIVEL[nivel];
  const ponta = (f: number, r: number): [number, number] => {
    const a = Math.PI * (1 - f);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };

  return (
    <svg
      viewBox="0 0 220 126"
      className="w-full"
      role="img"
      aria-label={`${rotulo ?? "medidor"}: ${pct.toFixed(0)}% — ${est.rotulo}`}
    >
      {/* trilho: um arco só, cinza de contorno. Carrega o tooltip mesmo em 0% */}
      <path
        d={arcoMedidor(cx, cy, R, 0, 1)}
        fill="none"
        stroke={GRADE}
        strokeWidth={esp}
        strokeLinecap="round"
      >
        <title>{`${rotulo ?? "Medidor"}: ${pct.toFixed(1).replace(".", ",")}% — ${est.rotulo}`}</title>
      </path>

      {/* limites das faixas: dois riscos finos SOBRE o trilho. É toda a
          sinalização de zona que o medidor precisa — quem dá o veredito é a
          cor do arco, e a palavra embaixo do número confirma. */}
      {[faixaAtencao, faixaBoa].map((f) => {
        const [x0, y0] = ponta(f, R - esp / 2);
        const [x1, y1] = ponta(f, R + esp / 2);
        return (
          <line
            key={f}
            x1={x0}
            y1={y0}
            x2={x1}
            y2={y1}
            stroke="#fdfbf8"
            strokeWidth={1.5}
            opacity={0.9}
          />
        );
      })}

      {/* arco do valor — desenha-se da esquerda para a direita */}
      {t > 0 ? (
        <path
          d={arcoMedidor(cx, cy, R, 0, t)}
          fill="none"
          stroke={est.cor}
          strokeWidth={esp}
          strokeLinecap="round"
          pathLength={1}
          className="g-linha"
        />
      ) : null}

      {/* marcador na ponta do arco: acabamento de instrumento */}
      {t > 0.02
        ? (() => {
            const [mx, my] = ponta(t, R);
            return (
              <circle
                cx={mx}
                cy={my}
                r={esp / 2 - 2.5}
                fill={CARTA}
                stroke={est.cor}
                strokeWidth={2.5}
                className="g-surgir"
                style={{ animationDelay: "1.05s" }}
                aria-hidden="true"
              />
            );
          })()
        : null}

      {/* leitura central */}
      <g className="g-surgir" style={{ animationDelay: "0.6s" }}>
        <text
          x={cx}
          y={cy - 24}
          textAnchor="middle"
          fontSize={42}
          fontWeight={700}
          fill={TINTA}
          style={{ fontFamily: "var(--font-source-serif), Georgia, serif" }}
        >
          {pct.toFixed(0)}%
        </text>
        <text
          x={cx}
          y={cy - 5}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          letterSpacing="0.18em"
          fill={ROTULO}
        >
          {est.rotulo.toUpperCase()}
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
    <div className="flex h-full flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
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
              className="g-fatia"
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
              className="g-linha g-fatia"
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

// ---------------------------------------------------------------------------
// Mapa de calor (matriz linha × coluna)
// ---------------------------------------------------------------------------

/**
 * Mapa de calor para matrizes (empreendimento × mês, ano × mês). A cor é uma
 * RAMPA SEQUENCIAL de um único matiz — do papel quase cru ao musgo escuro —
 * então "mais escuro = mais dinheiro" vale no mapa inteiro e o olho encontra
 * os melhores meses de cada linha em um segundo. Célula vazia é vazia (traço),
 * não é zero. O texto dentro da célula troca para papel quando o fundo
 * escurece, mantendo contraste sempre. Tooltip nativo por célula; a página
 * deve continuar oferecendo a mesma informação em tabela.
 */
export function MapaCalor({
  colunas,
  linhas,
  formatar = abreviarBRL,
  formatarCheio = formatarBRL,
  rotuloAcessivel = "Mapa de calor",
  destaqueColuna,
}: {
  colunas: string[];
  linhas: { rotulo: string; valores: (number | null)[] }[];
  /** número → texto curto da célula */
  formatar?: (v: number) => string;
  /** número → texto completo do tooltip */
  formatarCheio?: (v: number) => string;
  rotuloAcessivel?: string;
  /** índice 0-based da coluna a sublinhar (ex.: mês selecionado) */
  destaqueColuna?: number;
}) {
  const nc = colunas.length;
  const nl = linhas.length;
  if (nc === 0 || nl === 0) return null;

  const ROT_W = 128;
  const GAP = 3;
  const CEL_H = 26;
  const CAB_H = 20;
  const celW = (LARG - ROT_W - 4) / nc;
  const altura = CAB_H + nl * (CEL_H + GAP);

  const todos = linhas.flatMap((l) => l.valores).filter((v): v is number => v !== null && v > 0);
  const max = Math.max(...todos, 1);

  // rampa clara→escura do musgo; gama 0.72 abre os tons baixos para que
  // valores pequenos não sumam no papel
  const corDe = (v: number) => mixHex("#eef2e4", "#33511f", Math.pow(v / max, 0.72));
  // 0.66 é o ponto de contraste-igual desta rampa (≈3,9:1 para os dois
  // lados); com bold e o tooltip/tabela redundantes, é o melhor equilíbrio
  const textoDe = (v: number) => (Math.pow(v / max, 0.72) > 0.66 ? CARTA : TINTA);

  // muitas colunas (períodos multi-ano): cabeçalho raleado e célula sem
  // texto — a cor responde, o tooltip e a tabela dão o número exato
  const cabecalhoCada = nc <= 14 ? 1 : Math.ceil(nc / 14);
  const celulaComTexto = celW >= 34;

  return (
    <svg
      viewBox={`0 0 ${LARG} ${altura}`}
      className="w-full"
      role="img"
      aria-label={rotuloAcessivel}
    >
      {/* cabeçalho de colunas (raleado quando não cabe um rótulo por coluna) */}
      {colunas.map((c, j) =>
        j % cabecalhoCada === 0 || destaqueColuna === j ? (
          <text
            key={j}
            x={ROT_W + j * celW + celW / 2}
            y={CAB_H - 7}
            fontSize={9}
            fontWeight={destaqueColuna === j ? 700 : 400}
            fill={destaqueColuna === j ? TINTA : ROTULO}
            textAnchor="middle"
            style={{ fontFamily: "var(--font-jetbrains), monospace" }}
          >
            {c}
          </text>
        ) : null
      )}
      {destaqueColuna !== undefined && destaqueColuna >= 0 ? (
        <line
          x1={ROT_W + destaqueColuna * celW + 3}
          x2={ROT_W + (destaqueColuna + 1) * celW - 3}
          y1={CAB_H - 3}
          y2={CAB_H - 3}
          stroke={TINTA}
          strokeWidth={1.5}
        />
      ) : null}

      {linhas.map((linha, i) => {
        const y = CAB_H + i * (CEL_H + GAP);
        const rot =
          linha.rotulo.length > 18 ? linha.rotulo.slice(0, 17) + "…" : linha.rotulo;
        return (
          <g key={i} className="g-mapa-linha">
            <text
              x={ROT_W - 10}
              y={y + CEL_H / 2 + 3.5}
              fontSize={10}
              fill={TINTA}
              textAnchor="end"
            >
              {rot}
              <title>{linha.rotulo}</title>
            </text>
            {linha.valores.slice(0, nc).map((v, j) => {
              const x = ROT_W + j * celW;
              if (v === null || v === 0) {
                return (
                  <g key={j} className="g-cel">
                    <rect
                      x={x + 1.5}
                      y={y}
                      width={celW - GAP}
                      height={CEL_H}
                      rx={3.5}
                      fill={GRADE}
                      opacity={0.32}
                    />
                    <text
                      x={x + celW / 2}
                      y={y + CEL_H / 2 + 3}
                      fontSize={8.5}
                      fill={ROTULO}
                      opacity={0.55}
                      textAnchor="middle"
                    >
                      —
                    </text>
                    <title>{`${linha.rotulo} · ${colunas[j]}: sem movimento`}</title>
                  </g>
                );
              }
              // valor NEGATIVO (estorno/ajuste) não é "sem movimento":
              // célula clara com contorno terracota e o valor real em tinta
              if (v < 0) {
                return (
                  <g key={j} className="g-cel">
                    <rect
                      x={x + 1.5}
                      y={y}
                      width={celW - GAP}
                      height={CEL_H}
                      rx={3.5}
                      fill={CARTA}
                      stroke={COR_SAIDA}
                      strokeWidth={1.2}
                    />
                    {celulaComTexto ? (
                      <text
                        x={x + celW / 2}
                        y={y + CEL_H / 2 + 3}
                        fontSize={8.5}
                        fontWeight={700}
                        fill={TINTA}
                        textAnchor="middle"
                        style={{ fontFamily: "var(--font-jetbrains), monospace" }}
                      >
                        {formatar(v)}
                      </text>
                    ) : null}
                    <title>{`${linha.rotulo} · ${colunas[j]}: ${formatarCheio(v)} (negativo)`}</title>
                  </g>
                );
              }
              return (
                <g
                  key={j}
                  className="g-cel g-surgir"
                  style={{ animationDelay: `${i * 55 + j * 16}ms` }}
                >
                  <rect
                    x={x + 1.5}
                    y={y}
                    width={celW - GAP}
                    height={CEL_H}
                    rx={3.5}
                    fill={corDe(v)}
                  />
                  {celulaComTexto ? (
                    <text
                      x={x + celW / 2}
                      y={y + CEL_H / 2 + 3}
                      fontSize={8.5}
                      fontWeight={700}
                      fill={textoDe(v)}
                      textAnchor="middle"
                      style={{ fontFamily: "var(--font-jetbrains), monospace" }}
                    >
                      {formatar(v)}
                    </text>
                  ) : null}
                  <title>{`${linha.rotulo} · ${colunas[j]}: ${formatarCheio(v)}`}</title>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
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
