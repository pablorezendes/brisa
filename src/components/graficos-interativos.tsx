"use client";

import { useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { abreviarBRL, formatarBRL } from "@/lib/dominio/dinheiro";
import type { Nivel } from "@/lib/dominio/semaforo";

const CORES = {
  recebido: "#347c69",
  devido: "#d58b19",
  comissao: "#5475d4",
  saidaAL: "#d05160",
  saidaCH: "#8b5f91",
  grade: "#dbe4e6",
  texto: "#6f7f83",
};

const CORES_NIVEL: Record<Nivel, string> = {
  otimo: "#347c69",
  atencao: "#d58b19",
  critico: "#cb4655",
  info: "#5475d4",
  neutro: "#93a2a5",
};

function valorTooltip(valor: unknown): string {
  return typeof valor === "number" ? formatarBRL(valor) : "—";
}

function CaixaTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    color?: string;
    dataKey?: string | number;
    name?: string | number;
    value?: unknown;
  }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="min-w-44 rounded-xl border border-white/10 bg-[#12282b]/95 px-3.5 py-3 text-white shadow-[0_14px_36px_rgba(7,26,29,0.24)] backdrop-blur-md">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#91a6a8]">
        {label}
      </p>
      <div className="space-y-1.5">
        {payload.map((item) => (
          <div key={String(item.dataKey)} className="flex items-center justify-between gap-5 text-[11px]">
            <span className="flex items-center gap-2 text-[#c6d2d3]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <strong className="font-mono text-[11px] font-semibold text-white">
              {valorTooltip(item.value)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

type LinhaFinanceira = {
  rotulo: string;
  devido: number;
  recebido: number;
  comissao: number;
  pendentes?: number;
};

type SerieFinanceira = "devido" | "recebido" | "comissao";

const SERIES: Array<{ chave: SerieFinanceira; rotulo: string; cor: string }> = [
  { chave: "recebido", rotulo: "Recebido", cor: CORES.recebido },
  { chave: "devido", rotulo: "Devido", cor: CORES.devido },
  { chave: "comissao", rotulo: "Comissão", cor: CORES.comissao },
];

export function PulsoFinanceiro({
  dados,
  destaqueRotulo,
}: {
  dados: LinhaFinanceira[];
  destaqueRotulo?: string;
}) {
  const [visiveis, setVisiveis] = useState<Record<SerieFinanceira, boolean>>({
    devido: true,
    recebido: true,
    comissao: true,
  });

  function alternar(chave: SerieFinanceira) {
    const quantidade = Object.values(visiveis).filter(Boolean).length;
    if (visiveis[chave] && quantidade === 1) return;
    setVisiveis((atual) => ({ ...atual, [chave]: !atual[chave] }));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Séries exibidas no gráfico">
        {SERIES.map((serie) => (
          <button
            key={serie.chave}
            type="button"
            aria-pressed={visiveis[serie.chave]}
            onClick={() => alternar(serie.chave)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5475d4]/40 ${
              visiveis[serie.chave]
                ? "border-[#d8e1e3] bg-white text-[#34494d] shadow-sm"
                : "border-transparent bg-[#eef2f3] text-[#9aa7aa]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full transition-opacity ${visiveis[serie.chave] ? "opacity-100" : "opacity-30"}`}
              style={{ backgroundColor: serie.cor }}
            />
            {serie.rotulo}
          </button>
        ))}
        <span className="ml-auto hidden items-center gap-3 text-[10px] text-[#8a989b] sm:inline-flex">
          <span className="text-[#5475d4]">linha · escala direita</span>
          <span className="inline-flex items-center gap-2">
            <span className="h-px w-5 border-t border-dashed border-[#86a09a]" />
            período em foco
          </span>
        </span>
      </div>

      <div className="h-[300px] w-full" role="img" aria-label="Evolução mensal de devido, recebido e comissão">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 16, right: 4, bottom: 0, left: 0 }} accessibilityLayer>
            <defs>
              <linearGradient id="recebidoBarra" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4f9a86" />
                <stop offset="100%" stopColor="#2f7563" />
              </linearGradient>
              <linearGradient id="devidoBarra" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e5ae4d" />
                <stop offset="100%" stopColor="#c77a10" />
              </linearGradient>
              <linearGradient id="comissaoArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5475d4" stopOpacity="0.30" />
                <stop offset="100%" stopColor="#5475d4" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={CORES.grade} strokeDasharray="2 5" />
            <XAxis
              dataKey="rotulo"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CORES.texto, fontSize: 10, fontFamily: "var(--font-mono)" }}
              dy={10}
              minTickGap={8}
            />
            <YAxis
              yAxisId="principal"
              axisLine={false}
              tickLine={false}
              width={58}
              tickFormatter={abreviarBRL}
              tick={{ fill: CORES.texto, fontSize: 10, fontFamily: "var(--font-mono)" }}
            />
            <YAxis
              yAxisId="comissao"
              orientation="right"
              axisLine={false}
              tickLine={false}
              width={50}
              tickFormatter={abreviarBRL}
              tick={{ fill: CORES.comissao, fontSize: 9, fontFamily: "var(--font-mono)" }}
              domain={[0, "auto"]}
            />
            <Tooltip content={<CaixaTooltip />} cursor={{ fill: "rgba(76, 105, 109, 0.055)" }} />
            {destaqueRotulo ? (
              <ReferenceLine
                yAxisId="principal"
                x={destaqueRotulo}
                stroke="#76918c"
                strokeDasharray="3 5"
                strokeWidth={1}
              />
            ) : null}
            {visiveis.devido ? (
              <Bar
                yAxisId="principal"
                dataKey="devido"
                name="Devido"
                fill="url(#devidoBarra)"
                barSize={13}
                radius={[4, 4, 1, 1]}
                isAnimationActive={false}
              />
            ) : null}
            {visiveis.recebido ? (
              <Bar
                yAxisId="principal"
                dataKey="recebido"
                name="Recebido"
                fill="url(#recebidoBarra)"
                barSize={13}
                radius={[4, 4, 1, 1]}
                isAnimationActive={false}
              />
            ) : null}
            {visiveis.comissao ? (
              <Area
                yAxisId="comissao"
                type="monotone"
                dataKey="comissao"
                name="Comissão"
                stroke={CORES.comissao}
                strokeWidth={2.5}
                fill="url(#comissaoArea)"
                dot={{ r: 3, fill: "#fff", stroke: CORES.comissao, strokeWidth: 2 }}
                activeDot={{ r: 5, fill: CORES.comissao, stroke: "#fff", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function SinaisVitais({
  itens,
}: {
  itens: Array<{
    rotulo: string;
    valor: number;
    texto: string;
    nivel: Nivel;
    detalhe: string;
  }>;
}) {
  return (
    <div className="space-y-3 pt-1">
      {itens.map((item) => {
        const progresso = Math.max(0, Math.min(item.valor, 1));
        const cor = CORES_NIVEL[item.nivel];
        return (
          <div
            key={item.rotulo}
            className="group flex items-center gap-4 rounded-2xl border border-[#e1e8e9] bg-[#f9fbfb] p-3.5 transition-colors hover:border-[#cad8da] hover:bg-white"
          >
            <div
              className="relative flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full"
              style={{ background: `conic-gradient(${cor} ${progresso * 360}deg, #e8edef 0deg)` }}
              role="img"
              aria-label={`${item.rotulo}: ${item.texto}`}
            >
              <span className="absolute inset-[7px] rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(20,55,60,0.04)]" />
              <strong className="relative font-mono text-[16px] tracking-[-0.04em] text-[#203538]">
                {item.texto}
              </strong>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase leading-snug tracking-[0.09em] text-[#405458]">
                {item.rotulo}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#7a898c]">{item.detalhe}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type LinhaCaixa = {
  rotulo: string;
  receita: number;
  despesaAL: number;
  despesaCH: number;
  saldo: number;
};

export function FluxoCaixaInterativo({ dados }: { dados: LinhaCaixa[] }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#65767a]">
        {[
          [CORES.recebido, "Entradas"],
          [CORES.saidaAL, "Saídas A/L"],
          [CORES.saidaCH, "Saídas Chácara"],
          [CORES.comissao, "Saldo"],
        ].map(([cor, nome]) => (
          <span key={nome} className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cor }} />
            {nome}
          </span>
        ))}
      </div>
      <div className="h-[280px] w-full" role="img" aria-label="Entradas, despesas e saldo mensal do caixa">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 16, right: 4, bottom: 0, left: 0 }} accessibilityLayer>
            <defs>
              <linearGradient id="entradaCaixa" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5b9e8c" />
                <stop offset="100%" stopColor="#327764" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={CORES.grade} strokeDasharray="2 5" />
            <XAxis
              dataKey="rotulo"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CORES.texto, fontSize: 10, fontFamily: "var(--font-mono)" }}
              dy={10}
              minTickGap={8}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={58}
              tickFormatter={abreviarBRL}
              tick={{ fill: CORES.texto, fontSize: 10, fontFamily: "var(--font-mono)" }}
            />
            <Tooltip content={<CaixaTooltip />} cursor={{ fill: "rgba(76, 105, 109, 0.055)" }} />
            <ReferenceLine y={0} stroke="#aebbbc" />
            <Bar
              dataKey="receita"
              name="Entradas"
              fill="url(#entradaCaixa)"
              barSize={16}
              radius={[4, 4, 1, 1]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="despesaAL"
              name="Saídas A/L"
              stackId="saidas"
              fill={CORES.saidaAL}
              barSize={16}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="despesaCH"
              name="Saídas Chácara"
              stackId="saidas"
              fill={CORES.saidaCH}
              barSize={16}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="saldo"
              name="Saldo"
              stroke={CORES.comissao}
              strokeWidth={2.5}
              dot={{ r: 3, fill: "#fff", stroke: CORES.comissao, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: CORES.comissao, stroke: "#fff", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const CORES_FATIAS = ["#347c69", "#d58b19", "#5475d4", "#aebabc", "#765caa"];

export function ComposicaoComissao({
  fatias,
  total,
}: {
  fatias: Array<{ rotulo: string; valor: number }>;
  total: number;
}) {
  const [ativo, setAtivo] = useState(0);
  const fatiaAtiva = fatias[ativo] ?? fatias[0];

  if (fatias.length === 0) {
    return <p className="py-12 text-center text-sm text-tinta-suave">Sem comissão registrada nesta janela.</p>;
  }

  return (
    <div className="pt-1">
      <div className="relative mx-auto h-[220px] max-w-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart accessibilityLayer>
            <Pie
              data={fatias}
              dataKey="valor"
              nameKey="rotulo"
              cx="50%"
              cy="50%"
              innerRadius={64}
              outerRadius={91}
              paddingAngle={2}
              cornerRadius={5}
              stroke="#fff"
              strokeWidth={3}
              onMouseEnter={(_, indice) => setAtivo(indice)}
              isAnimationActive={false}
            >
              {fatias.map((fatia, indice) => (
                <Cell
                  key={fatia.rotulo}
                  fill={CORES_FATIAS[indice % CORES_FATIAS.length]}
                  opacity={indice === ativo ? 1 : 0.72}
                />
              ))}
            </Pie>
            <Tooltip content={<CaixaTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-24 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-[#829194]">
            {fatiaAtiva?.rotulo ?? "Total"}
          </span>
          <strong className="mt-1 font-mono text-[17px] tracking-[-0.04em] text-[#203538]">
            {formatarBRL(fatiaAtiva?.valor ?? total)}
          </strong>
          <span className="mt-1 text-[10px] text-[#839194]">
            {total > 0 && fatiaAtiva ? `${((fatiaAtiva.valor / total) * 100).toFixed(0)}% do total` : "total"}
          </span>
        </div>
      </div>

      <div className="mt-1 space-y-1">
        {fatias.map((fatia, indice) => (
          <button
            type="button"
            key={fatia.rotulo}
            onMouseEnter={() => setAtivo(indice)}
            onFocus={() => setAtivo(indice)}
            onClick={() => setAtivo(indice)}
            className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5475d4]/35 ${
              indice === ativo ? "bg-[#f0f5f4]" : "hover:bg-[#f7f9f9]"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2 text-[11px] font-semibold text-[#465a5e]">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: CORES_FATIAS[indice % CORES_FATIAS.length] }}
              />
              <span className="truncate">{fatia.rotulo}</span>
            </span>
            <span className="font-mono text-[10px] text-[#6f7f83]">
              {total > 0 ? `${((fatia.valor / total) * 100).toFixed(0)}%` : "—"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
