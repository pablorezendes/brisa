"use client";

/**
 * Formulário de lançamento (novo e edição).
 *
 * Decisão documentada: as categorias dos DOIS centros (AL e CH) são
 * carregadas no servidor e passadas como props; a alternância dos campos
 * (centro/categoria para SAIDA, cliente/local para RECEB_DINHEIRO) acontece
 * no cliente com useState — evita etapa extra server-side e mantém o form
 * numa tela só. O select de categoria usa key={centro} para remontar com as
 * opções do centro escolhido.
 */
import Link from "next/link";
import { useActionState, useState } from "react";
import { btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import type { EstadoFormLancamento } from "./actions";

export type LancamentoInicial = {
  id: string;
  mesReferencia: string;
  centroCusto: string;
  tipo: string;
  categoria: string | null;
  data: string | null;
  valor: number; // centavos
  descricao: string | null;
  cliente: string | null;
  local: string | null;
};

const ROTULO_TIPO: Record<string, string> = {
  SAIDA: "Saída",
  ENTRADA: "Entrada",
  RECEB_DINHEIRO: "Recebimento em dinheiro",
};

/** centavos → "1.234,56" (formato aceito por parseBRL no servidor). */
function centavosParaTexto(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {rotulo}
      </span>
      {children}
    </label>
  );
}

export function FormLancamento({
  acao,
  categoriasAL,
  categoriasCH,
  mes,
  inicial,
}: {
  acao: (prev: EstadoFormLancamento, fd: FormData) => Promise<EstadoFormLancamento>;
  categoriasAL: string[];
  categoriasCH: string[];
  /** Mês em foco (volta do "Cancelar" e default do mês de referência). */
  mes: string;
  inicial?: LancamentoInicial;
}) {
  const [estado, dispatch, pendente] = useActionState(acao, { erro: null });
  const [tipo, setTipo] = useState(inicial?.tipo ?? "SAIDA");
  const [centro, setCentro] = useState(inicial?.centroCusto === "CH" ? "CH" : "AL");

  const categorias = centro === "CH" ? categoriasCH : categoriasAL;
  const opcoesCategoria =
    inicial?.categoria && !categorias.includes(inicial.categoria)
      ? [inicial.categoria, ...categorias]
      : categorias;

  return (
    <form action={dispatch} className="flex flex-col gap-4">
      {inicial ? <input type="hidden" name="id" value={inicial.id} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo">
          <select
            name="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className={inputBase}
          >
            {Object.entries(ROTULO_TIPO).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Mês de referência">
          <input
            type="month"
            name="mesReferencia"
            defaultValue={inicial?.mesReferencia ?? mes}
            required
            className={inputBase}
          />
        </Campo>

        {tipo === "SAIDA" ? (
          <>
            <Campo rotulo="Centro de custo">
              <select
                name="centro"
                value={centro}
                onChange={(e) => setCentro(e.target.value)}
                className={inputBase}
              >
                <option value="AL">Antonio/Laura (AL)</option>
                <option value="CH">Chácara Brisa (CH)</option>
              </select>
            </Campo>

            <Campo rotulo="Categoria">
              <select
                key={centro}
                name="categoria"
                defaultValue={
                  inicial && inicial.centroCusto === centro ? (inicial.categoria ?? "") : ""
                }
                required
                className={inputBase}
              >
                <option value="">Selecione…</option>
                {opcoesCategoria.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Campo>
          </>
        ) : null}

        <Campo rotulo="Data">
          <input
            type="date"
            name="data"
            defaultValue={inicial?.data ?? ""}
            className={inputBase}
          />
        </Campo>

        <Campo rotulo="Valor (R$)">
          <input
            type="text"
            name="valor"
            inputMode="decimal"
            placeholder="1.234,56"
            defaultValue={inicial ? centavosParaTexto(inicial.valor) : ""}
            required
            className={inputBase}
          />
        </Campo>

        {tipo === "RECEB_DINHEIRO" ? (
          <>
            <Campo rotulo="Cliente">
              <input
                type="text"
                name="cliente"
                defaultValue={inicial?.cliente ?? ""}
                className={inputBase}
              />
            </Campo>
            <Campo rotulo="Local">
              <input
                type="text"
                name="local"
                defaultValue={inicial?.local ?? ""}
                className={inputBase}
              />
            </Campo>
          </>
        ) : null}

        <div className="sm:col-span-2">
          <Campo rotulo="Descrição">
            <input
              type="text"
              name="descricao"
              defaultValue={inicial?.descricao ?? ""}
              className={inputBase}
            />
          </Campo>
        </div>
      </div>

      {tipo === "RECEB_DINHEIRO" ? (
        <p className="text-xs text-amber-700">
          Recebimento em dinheiro é registro paralelo de espécie — não entra no saldo do mês.
        </p>
      ) : null}

      {estado.erro ? <p className="text-sm text-red-600">{estado.erro}</p> : null}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={pendente} className={btnPrimario}>
          {pendente ? "Salvando…" : inicial ? "Salvar alterações" : "Adicionar lançamento"}
        </button>
        <Link href={`/caixa?mes=${mes}`} className={btnSecundario}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
