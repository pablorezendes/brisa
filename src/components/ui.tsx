import Link from "next/link";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  parseCompetencia,
  competencia as fmtCompetencia,
} from "@/lib/dominio/normalizacao";
import { presetsPeriodo, type Periodo } from "@/lib/dominio/periodo";
import { NIVEL, PESO_NIVEL, type Nivel } from "@/lib/dominio/semaforo";

/**
 * Botão de sigilo: vela ou revela os valores da tela.
 *
 * É um checkbox escondido + CSS (`:has`) — sem JavaScript, sem cookie, sem
 * nada gravado. Toda página abre velada; ao recarregar, vela de novo. Serve
 * para abrir o sistema na frente de outras pessoas sem expor números.
 */
function BotaoSigilo() {
  return (
    <>
      <input type="checkbox" id="ver-valores" className="sr-only" />
      <label
        htmlFor="ver-valores"
        title="Mostrar ou ocultar os valores da tela"
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-contorno bg-carta px-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-tinta-suave transition-colors hover:border-tinta hover:text-tinta"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
          <path
            className="olho-velado"
            d="M3.5 3.5l17 17"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span className="olho-velado">Ver valores</span>
        <span className="olho-revelado">Ocultar</span>
      </label>
    </>
  );
}

/** Cabeçalho padrão de página. Traz sempre o botão de sigilo dos valores. */
export function PageHeader({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{titulo}</h1>
        {descricao ? (
          <p className="mt-1 text-sm text-tinta-suave">{descricao}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BotaoSigilo />
        {acoes}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = "",
  style,
  nivel,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** desenha um filete de 3px à esquerda na cor do semáforo — a única cor do card */
  nivel?: Nivel;
}) {
  const est = nivel && nivel !== "neutro" ? NIVEL[nivel] : null;
  return (
    <div
      className={`rounded-lg border border-contorno bg-carta ${est ? "card-sem" : ""} ${className}`}
      style={{
        ...(est ? ({ "--sem-cor": est.cor } as React.CSSProperties) : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Valor monetário (centavos) alinhado à direita; negativo em vermelho. */
export function Dinheiro({
  centavos,
  destaque = false,
}: {
  centavos: number | null | undefined;
  destaque?: boolean;
}) {
  const negativo = (centavos ?? 0) < 0;
  return (
    <span
      className={`font-mono tabular-nums ${negativo ? "text-erro" : ""} ${
        destaque ? "font-semibold" : ""
      }`}
    >
      {formatarBRL(centavos)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Semáforo — ponto colorido + palavra em tinta. A cor nunca vem sozinha.
// ---------------------------------------------------------------------------

/** Só o ponto colorido de 8px (células apertadas). Tem título nativo. */
export function Ponto({ nivel, titulo }: { nivel: Nivel; titulo?: string }) {
  const est = NIVEL[nivel];
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full align-middle"
      style={{ background: est.cor }}
      title={titulo ?? est.rotulo}
      aria-label={titulo ?? est.rotulo}
    />
  );
}

/**
 * Selo de nível no estilo editorial: ponto colorido de 8px + palavra em caixa
 * alta em tinta-suave. A cor fica SÓ no ponto — o design system proíbe
 * pílulas/badges preenchidos. É a peça que responde "isso está bom ou ruim?"
 * sem obrigar a ler o número.
 */
export function Selo({
  nivel,
  children,
  icone,
}: {
  nivel: Nivel;
  children?: React.ReactNode;
  /** mantido por compatibilidade — o ponto já é o sinal visual */
  icone?: boolean;
}) {
  void icone;
  const est = NIVEL[nivel];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.09em] text-tinta-suave">
      <Ponto nivel={nivel} />
      {children ?? est.rotulo}
    </span>
  );
}

const COR_PARA_NIVEL: Record<string, Nivel> = {
  verde: "otimo",
  ambar: "atencao",
  vermelho: "critico",
  azul: "info",
  slate: "neutro",
};

/**
 * Status em linha. Aceita a paleta antiga (`cor`) ou o nível do semáforo
 * (`nivel`) — as duas desembocam no mesmo selo.
 */
export function Badge({
  children,
  cor = "slate",
  nivel,
}: {
  children: React.ReactNode;
  cor?: "slate" | "verde" | "vermelho" | "ambar" | "azul";
  nivel?: Nivel;
}) {
  return (
    <Selo nivel={nivel ?? COR_PARA_NIVEL[cor] ?? "neutro"} icone={false}>
      {children}
    </Selo>
  );
}

/**
 * "i" de informação com explicação em tooltip (CSS puro, hover/foco).
 * Vai ao lado de TODO rótulo de KPI, título de card e cabeçalho de coluna —
 * sempre em linguagem simples e dizendo COMO agir no lançamento.
 */
export function Ajuda({ dica }: { dica: string }) {
  // O texto é um ELEMENTO de verdade, não `content: attr(data-dica)` num
  // ::after. Assim o leitor de tela lê a explicação como conteúdo (antes ela
  // virava um aria-label de 350 caracteres no próprio botão) e o balão pode
  // ter largura fluida — coisa que `attr()` não permitia medir.
  return (
    <span className="dica" tabIndex={0}>
      <span aria-hidden="true">i</span>
      <span className="dica-balao" role="note">
        {dica}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

/**
 * Cartão de indicador. Além do número, carrega:
 *  · o "i" com a explicação da métrica;
 *  · o selo do semáforo (ponto + palavra) e o filete lateral de 3px — toda a
 *    cor que o card usa;
 *  · uma linha de recado (`nota`) dizendo o que fazer quando não está verde.
 */
export function Kpi({
  rotulo,
  valor,
  detalhe,
  variacao,
  ajuda,
  nivel,
  nota,
  selo,
  grafico,
  href,
  secundario,
  destaque = false,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: string;
  variacao?: React.ReactNode;
  /** explicação da métrica em linguagem simples (vira o "i" com tooltip) */
  ajuda?: string;
  /** veredito do semáforo — filete lateral + selo */
  nivel?: Nivel;
  /** o que fazer a respeito, quando há algo a fazer */
  nota?: string;
  /** texto do selo; por padrão usa a palavra do nível */
  selo?: string;
  /** mini-gráfico (sparkline, barra de composição) no rodapé do card */
  grafico?: React.ReactNode;
  /** torna o card inteiro clicável */
  href?: string;
  /** segunda leitura no mesmo card (ex.: acumulada do ano sob a do mês) */
  secundario?: { rotulo: string; valor: React.ReactNode };
  /** card de resultado: número maior, ocupa o lugar de destaque da grade */
  destaque?: boolean;
}) {
  const est = nivel ? NIVEL[nivel] : null;
  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
          {rotulo}
          {ajuda ? <Ajuda dica={ajuda} /> : null}
        </div>
        {nivel && nivel !== "neutro" ? (
          <Selo nivel={nivel}>{selo}</Selo>
        ) : null}
      </div>
      <div
        className={`mt-2 font-serif font-semibold tabular-nums text-tinta ${
          destaque
            ? "text-2xl sm:text-[34px] sm:leading-tight"
            : "text-xl sm:text-[26px] sm:leading-tight"
        }`}
      >
        <span className="sigilo">
          <span>{valor}</span>
        </span>
      </div>
      {secundario ? (
        <div className="mt-1.5 flex items-baseline gap-1.5 border-t border-contorno/70 pt-1.5 text-[11px] text-tinta-suave">
          <span className="font-bold uppercase tracking-[0.06em]">
            {secundario.rotulo}
          </span>
          <span className="font-mono font-semibold tabular-nums text-tinta">
            <span className="sigilo">
              <span>{secundario.valor}</span>
            </span>
          </span>
        </div>
      ) : null}
      {variacao ? <div className="mt-1.5">{variacao}</div> : null}
      {detalhe ? (
        <div className="mt-1.5 text-xs leading-snug text-tinta-suave">
          {detalhe}
        </div>
      ) : null}
      {grafico ? <div className="mt-3">{grafico}</div> : null}
      {nota && est ? (
        <div className="mt-3 flex items-start gap-1.5 border-t border-contorno pt-2 text-[11px] font-medium leading-snug text-tinta-suave">
          <span aria-hidden="true" className="mt-[3px]">
            <Ponto nivel={nivel!} />
          </span>
          <span>{nota}</span>
        </div>
      ) : null}
    </>
  );

  const classe = `px-4 py-4 transition-colors sm:px-5 ${
    href ? "block rounded-lg hover:bg-[#efeee9]" : ""
  }`;

  if (href) {
    return (
      <Card nivel={nivel} className="p-0">
        <Link href={href} className={classe}>
          {conteudo}
        </Link>
      </Card>
    );
  }
  return (
    <Card nivel={nivel} className={classe}>
      {conteudo}
    </Card>
  );
}

/**
 * Variação vs mês anterior, legível por qualquer pessoa:
 * "▲ 12,3% vs mês anterior" — verde/âmbar conforme o que é bom para a métrica
 * (comissão: subir é bom; inadimplência: subir é ruim).
 */
export function Variacao({
  atual,
  anterior,
  bomQuandoSobe = true,
}: {
  atual: number;
  anterior: number | null | undefined;
  bomQuandoSobe?: boolean;
}) {
  if (
    anterior === null ||
    anterior === undefined ||
    anterior === 0 ||
    atual === anterior
  ) {
    return (
      <span className="font-mono text-[11px] text-tinta-suave/70">
        {anterior === 0 || anterior === null || anterior === undefined
          ? "sem base de comparação"
          : "estável vs mês anterior"}
      </span>
    );
  }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  const subiu = pct > 0;
  const positivo = subiu === bomQuandoSobe;
  return (
    <span
      className={`font-mono text-[11px] font-bold ${
        positivo ? "text-oliva-escura" : "text-erro"
      }`}
    >
      {subiu ? "▲" : "▼"} {Math.abs(pct).toFixed(1).replace(".", ",")}%{" "}
      <span className="font-normal text-tinta-suave">vs mês anterior</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Alertas — a fila de atenção do topo das páginas
// ---------------------------------------------------------------------------

export interface ItemAlerta {
  nivel: Nivel;
  titulo: string;
  /** o que está acontecendo e o que fazer, em uma frase */
  texto: string;
  acao?: { rotulo: string; href: string };
}

/**
 * Uma linha da fila de atenção — editorial: filete de 3px na cor do nível à
 * esquerda, ponto + título em tinta, ação em oliva. Nenhum fundo colorido.
 */
export function Alerta({ item }: { item: ItemAlerta }) {
  const est = NIVEL[item.nivel];
  return (
    <div
      className="flex items-start gap-3 rounded border border-contorno px-3.5 py-2.5"
      style={{ borderLeft: `3px solid ${est.cor}` }}
    >
      <span aria-hidden="true" className="mt-[5px]">
        <Ponto nivel={item.nivel} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-tinta">
          {item.titulo}
          <span className="ml-2 font-normal normal-case tracking-normal text-tinta-suave">
            {est.rotulo}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-tinta">{item.texto}</p>
      </div>
      {item.acao ? (
        <Link
          href={item.acao.href}
          className="mt-0.5 shrink-0 whitespace-nowrap text-[12px] font-bold text-oliva-escura hover:underline"
        >
          {item.acao.rotulo} →
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Central de atenção: ordena do mais urgente para o menos e mostra tudo que
 * pede ação hoje. Quando não há nada pendente, dá o "tudo em dia" — silêncio
 * num painel de alertas é ambíguo, confirmação não é.
 */
export function PainelAlertas({
  itens,
  ajuda,
  vazio = "Nada pedindo atenção neste mês — comissão em dia, cobranças recebidas e nenhum reajuste a aplicar.",
}: {
  itens: ItemAlerta[];
  ajuda?: string;
  vazio?: string;
}) {
  const ordenados = [...itens].sort(
    (a, b) => PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel]
  );
  const criticos = ordenados.filter((i) => i.nivel === "critico").length;
  const atencoes = ordenados.filter((i) => i.nivel === "atencao").length;

  return (
    <Card className="mb-6 px-5 py-3.5">
      {/* dobrado por padrão: o resumo já diz QUANTO pede atenção, e o detalhe
          só aparece a pedido — a tela abre com menos texto na frente */}
      <details className="bloco-dobra">
        <summary className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-tinta-suave">
            <svg
              className="dobra-seta"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M9 5l7 7-7 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Precisa da sua atenção
            {ajuda ? <Ajuda dica={ajuda} /> : null}
          </h2>
          <div className="flex items-center gap-2">
            {criticos > 0 ? (
              <Selo nivel="critico">
                {criticos} {criticos === 1 ? "urgente" : "urgentes"}
              </Selo>
            ) : null}
            {atencoes > 0 ? (
              <Selo nivel="atencao">{atencoes} a olhar</Selo>
            ) : null}
            {criticos === 0 && atencoes === 0 ? (
              <Selo nivel="otimo">tudo em dia</Selo>
            ) : null}
          </div>
        </summary>
        <div className="mt-3">
          {ordenados.length === 0 ? (
            <div
              className="flex items-center gap-3 rounded border border-contorno px-3.5 py-2.5 text-[13px] text-tinta"
              style={{ borderLeft: `3px solid ${NIVEL.otimo.cor}` }}
            >
              <Ponto nivel="otimo" titulo="tudo em dia" />
              {vazio}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {ordenados.map((item, i) => (
                <Alerta key={i} item={item} />
              ))}
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}

/**
 * Busca dentro de um card (form GET, sem JavaScript). Preserva os demais
 * parâmetros da página em campos ocultos para não perder mês/período.
 */
export function BuscaCard({
  base,
  campo,
  valor,
  ocultos,
  placeholder = "Buscar…",
}: {
  base: string;
  /** nome do parâmetro na querystring (ex.: "qr") */
  campo: string;
  valor?: string;
  /** outros parâmetros a preservar (mes, de, ate, g...) */
  ocultos?: Record<string, string | undefined>;
  placeholder?: string;
}) {
  return (
    <form method="get" action={base} className="flex items-center gap-1.5">
      {Object.entries(ocultos ?? {}).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null
      )}
      <input
        type="search"
        name={campo}
        defaultValue={valor ?? ""}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${inputBase} h-8 w-44 py-0 text-[12px]`}
      />
      <button
        type="submit"
        className="h-8 rounded-lg border border-contorno bg-carta px-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-tinta-suave transition-colors hover:border-tinta hover:text-tinta"
      >
        Buscar
      </button>
      {valor ? (
        <Link
          href={
            Object.entries(ocultos ?? {}).filter(([, v]) => v).length
              ? `${base}?${Object.entries(ocultos ?? {})
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
                  .join("&")}`
              : base
          }
          className="text-[11px] font-bold text-tinta-suave hover:text-tinta"
          title="Limpar busca"
        >
          ×
        </Link>
      ) : null}
    </form>
  );
}

/**
 * Cabeçalho de card/seção: título em serifa, "i" com a explicação e um espaço
 * à direita para legenda, selo ou link de aprofundamento.
 */
export function TituloCard({
  titulo,
  ajuda,
  nivel,
  direita,
}: {
  titulo: string;
  ajuda?: string;
  nivel?: Nivel;
  direita?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <h2 className="flex items-center gap-1.5 font-serif text-[15px] font-semibold text-tinta">
        {nivel && nivel !== "neutro" ? <Ponto nivel={nivel} /> : null}
        {titulo}
        {ajuda ? <Ajuda dica={ajuda} /> : null}
      </h2>
      {direita ? (
        <div className="flex items-center gap-3">{direita}</div>
      ) : null}
    </div>
  );
}

/**
 * Alternador de tipo de gráfico — links, não botões: cada opção é uma URL
 * (?g=linha) que o servidor renderiza. Zero JavaScript no cliente, e a
 * escolha sobrevive ao compartilhar o link.
 */
export function SeletorGrafico({
  base,
  qs,
  atual,
  opcoes,
}: {
  base: string;
  /** querystring da página SEM o parâmetro `g` (ex.: "mes=2026-06") */
  qs: string;
  atual: string;
  opcoes: { valor: string; rotulo: string }[];
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-lg border border-contorno"
      role="group"
      aria-label="Tipo de gráfico"
    >
      {opcoes.map((o) => {
        const ativo = o.valor === atual;
        return (
          <Link
            key={o.valor}
            href={`${base}?${qs}${qs ? "&" : ""}g=${o.valor}`}
            aria-current={ativo ? "true" : undefined}
            className={`border-r border-contorno px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] transition-colors last:border-r-0 ${
              ativo
                ? "bg-tinta text-papel"
                : "text-tinta-suave hover:bg-[#efeee9] hover:text-tinta"
            }`}
          >
            {o.rotulo}
          </Link>
        );
      })}
    </div>
  );
}

/** Link de aprofundamento no canto do card. */
export function LinkCard({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap text-[12px] font-bold text-oliva-escura hover:underline"
    >
      {children} →
    </Link>
  );
}

/**
 * Navegação de mês por querystring (?mes=YYYY-MM), server-friendly (links).
 * Uso: <SeletorMes base="/recebimentos" mes="2026-06" />
 */
export function SeletorMes({ base, mes }: { base: string; mes: string }) {
  const { ano, mes: m } = parseCompetencia(mes);
  const anterior =
    m === 1 ? fmtCompetencia(ano - 1, 12) : fmtCompetencia(ano, m - 1);
  const proximo =
    m === 12 ? fmtCompetencia(ano + 1, 1) : fmtCompetencia(ano, m + 1);
  const seta =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-contorno bg-carta text-tinta-suave transition-colors hover:border-tinta hover:text-tinta";
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Link href={`${base}?mes=${anterior}`} className={seta} aria-label="Mês anterior">
        ‹
      </Link>
      <span className="min-w-24 rounded-lg border border-contorno bg-carta px-3 py-1.5 text-center font-mono text-[13px] font-bold uppercase tracking-wider">
        {formatarCompetencia(mes)}
      </span>
      <Link href={`${base}?mes=${proximo}`} className={seta} aria-label="Próximo mês">
        ›
      </Link>
    </div>
  );
}

/**
 * Seletor de período com calendário — sem JavaScript no cliente.
 *
 * Um <details> abre o painel; dentro, um formulário GET com dois
 * <input type="date"> (o calendário é o nativo do navegador) navega com
 * ?de=YYYY-MM-DD&ate=YYYY-MM-DD. Presets viram links prontos. Quando um
 * período está ativo, o rótulo dele substitui o seletor de mês/ano da página
 * e um "×" limpa a seleção.
 *
 * Coloque ao lado do SeletorMes/SeletorAno:
 *   <SeletorPeriodo base="/executivo" periodo={periodo} />
 * `extras` preserva outros parâmetros no formulário (ex.: { id: "..." }).
 */
export function SeletorPeriodo({
  base,
  periodo,
  extras,
}: {
  base: string;
  periodo: Periodo | null;
  extras?: Record<string, string>;
}) {
  const presets = presetsPeriodo();
  const qsExtras = Object.entries(extras ?? {})
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join("");
  // o "×" limpa SÓ o período — extras (filtros da página) sobrevivem
  const hrefLimpar = qsExtras ? `${base}?${qsExtras.slice(1)}` : base;

  return (
    <div className="flex items-center gap-1.5">
      {periodo ? (
        <span className="flex items-center gap-2 rounded-lg border border-tinta bg-carta px-3 py-1.5 font-mono text-[12px] font-bold">
          <CalendarioIcone />
          {periodo.rotulo}
          <Link
            href={hrefLimpar}
            aria-label="Limpar período e voltar ao mês"
            title="Limpar período e voltar ao mês"
            className="ml-1 rounded px-1 text-tinta-suave hover:bg-[#efeee9] hover:text-tinta"
          >
            ×
          </Link>
        </span>
      ) : null}
      <details className="relative">
        <summary
          className="flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg border border-contorno bg-carta px-2.5 text-[12px] font-bold text-tinta-suave transition-colors hover:border-tinta hover:text-tinta [&::-webkit-details-marker]:hidden"
          aria-label="Escolher período no calendário"
        >
          <CalendarioIcone />
          {periodo ? "Alterar" : "Período"}
        </summary>
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-tinta bg-carta p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-tinta-suave">
            Analisar por período
            <Ajuda dica="Escolha as datas de início e fim no calendário. O sistema apura tudo por mês (competência), então o período considera os meses inteiros entre as duas datas — de 15/03 a 10/05 analisa MAR, ABR e MAI. Para voltar à visão de um mês só, use o ×." />
          </div>
          <form method="get" action={base} className="flex flex-col gap-2.5">
            {Object.entries(extras ?? {}).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <label className="flex items-center justify-between gap-2 text-[12px] font-semibold text-tinta">
              Início
              <input
                type="date"
                name="de"
                defaultValue={periodo?.de}
                className={`${inputBase} w-40`}
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-[12px] font-semibold text-tinta">
              Fim
              <input
                type="date"
                name="ate"
                defaultValue={periodo?.ate}
                className={`${inputBase} w-40`}
              />
            </label>
            <button type="submit" className={`${btnPrimario} justify-center`}>
              Aplicar período
            </button>
          </form>
          <div className="mt-3 border-t border-contorno pt-2.5">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-tinta-suave/80">
              Atalhos
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <Link
                  key={p.rotulo}
                  href={`${base}?de=${p.de}&ate=${p.ate}${qsExtras}`}
                  className="rounded-full border border-contorno px-2.5 py-1 text-[11px] font-semibold text-tinta-suave transition-colors hover:border-tinta hover:text-tinta"
                >
                  {p.rotulo}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

function CalendarioIcone() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M3 10h18M8 3v4M16 3v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const btnPrimario =
  "inline-flex items-center gap-1.5 rounded-lg bg-oliva px-3 py-1.5 text-sm font-semibold text-white hover:bg-oliva-escura disabled:opacity-50";
export const btnSecundario =
  "inline-flex items-center gap-1.5 rounded-lg border border-tinta bg-transparent px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-[#efeee9] disabled:opacity-50";
export const inputBase =
  "rounded-lg border border-contorno bg-carta px-2.5 py-1.5 font-mono text-sm text-tinta focus:outline-none focus:border-tinta focus:ring-1 focus:ring-tinta";
