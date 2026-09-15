import Link from "next/link";
import { Card, PageHeader, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { prisma } from "@/lib/db";
import { normalizar } from "@/lib/dominio/normalizacao";
import {
  AvisosCadastro,
  EstadoVazio,
  NavegacaoCadastros,
  StatusCadastro,
} from "../_components";
import {
  atualizarEmpreendimento,
  criarEmpreendimento,
  definirStatusEmpreendimento,
} from "../actions";

export const metadata = { title: "Empreendimentos — Cadastros — Brisa" };

type SearchParams = Promise<{
  q?: string;
  status?: string;
  editar?: string;
  ok?: string;
  erro?: string;
}>;

function urlLista({ q, status, editar }: { q?: string; status?: string; editar?: string }) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status && status !== "todos") params.set("status", status);
  if (editar) params.set("editar", editar);
  const query = params.toString();
  return query ? `/cadastros/empreendimentos?${query}` : "/cadastros/empreendimentos";
}

export default async function PaginaEmpreendimentos({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status === "inativos" ? "inativos" : sp.status === "ativos" ? "ativos" : "todos";

  const where = {
    ...(q ? { nome: { contains: normalizar(q) } } : {}),
    ...(status === "ativos" ? { ativo: true } : status === "inativos" ? { ativo: false } : {}),
  };

  const [empreendimentos, editando] = await Promise.all([
    prisma.empreendimento.findMany({
      where,
      include: {
        unidades: {
          select: {
            ativo: true,
            contratos: {
              where: { status: { not: "encerrado" } },
              select: { id: true },
            },
          },
        },
      },
      orderBy: { nome: "asc" },
    }),
    sp.editar
      ? prisma.empreendimento.findUnique({ where: { id: sp.editar } })
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        titulo="Empreendimentos"
        descricao="Prédios e grupos patrimoniais que organizam os imóveis, contratos e resultados."
        acoes={
          <Link href="/cadastros/unidades" className={btnSecundario}>
            Ver imóveis
          </Link>
        }
      />
      <NavegacaoCadastros atual="empreendimentos" />
      <AvisosCadastro ok={sp.ok} erro={sp.erro} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(250px,0.34fr)_minmax(0,1fr)]">
        <Card className="p-5 xl:sticky xl:top-20">
          <div className="mb-4">
            <h2 className="text-base font-bold tracking-tight text-tinta">
              {editando ? "Editar empreendimento" : "Novo empreendimento"}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-tinta-suave">
              O nome será padronizado para evitar variações e cadastros duplicados.
            </p>
          </div>
          <form action={editando ? atualizarEmpreendimento : criarEmpreendimento}>
            {editando ? <input type="hidden" name="id" value={editando.id} /> : null}
            <label htmlFor="nome-empreendimento" className="block text-[12px] font-semibold text-tinta">
              Nome do empreendimento
            </label>
            <input
              id="nome-empreendimento"
              name="nome"
              required
              maxLength={120}
              autoComplete="organization"
              defaultValue={editando?.nome ?? ""}
              placeholder="Ex.: Edifício Pio XII"
              className={`${inputBase} mt-1.5 w-full`}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" className={btnPrimario}>
                {editando ? "Salvar alterações" : "Cadastrar"}
              </button>
              {editando ? (
                <Link href={urlLista({ q, status })} className={btnSecundario}>
                  Cancelar
                </Link>
              ) : null}
            </div>
          </form>
        </Card>

        <Card>
          <div className="flex flex-col gap-3 border-b border-contorno px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-tinta">Base de empreendimentos</h2>
              <p className="mt-0.5 text-[11px] text-tinta-suave">
                {empreendimentos.length} resultado(s) nos filtros atuais
              </p>
            </div>
            <form method="get" action="/cadastros/empreendimentos" className="flex flex-wrap items-end gap-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                Buscar
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Nome do empreendimento"
                  className={`${inputBase} mt-1 block w-52 py-1.5`}
                />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                Status
                <select name="status" defaultValue={status} className={`${inputBase} mt-1 block py-1.5`}>
                  <option value="todos">Todos</option>
                  <option value="ativos">Ativos</option>
                  <option value="inativos">Inativos</option>
                </select>
              </label>
              <button type="submit" className={btnSecundario}>Filtrar</button>
              {q || status !== "todos" ? (
                <Link href="/cadastros/empreendimentos" className="pb-2 text-[11px] font-bold text-tinta-suave hover:text-tinta">
                  Limpar
                </Link>
              ) : null}
            </form>
          </div>

          {empreendimentos.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum empreendimento encontrado"
              texto="Revise a busca e os filtros ou cadastre um novo empreendimento ao lado."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela min-w-[720px]">
                <caption className="sr-only">Empreendimentos cadastrados</caption>
                <thead>
                  <tr>
                    <th>Empreendimento</th>
                    <th>Status</th>
                    <th className="text-right">Imóveis</th>
                    <th className="text-right">Contratos abertos</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {empreendimentos.map((empreendimento) => {
                    const unidadesAtivas = empreendimento.unidades.filter((u) => u.ativo).length;
                    const contratosAbertos = empreendimento.unidades.reduce(
                      (total, unidade) => total + unidade.contratos.length,
                      0,
                    );
                    return (
                      <tr key={empreendimento.id}>
                        <td>
                          <div className="font-semibold text-tinta">{empreendimento.nome}</div>
                          <div className="mt-0.5 text-[10px] text-tinta-suave">
                            {unidadesAtivas} imóvel(is) ativo(s)
                          </div>
                        </td>
                        <td><StatusCadastro ativo={empreendimento.ativo} /></td>
                        <td className="text-right font-mono tabular-nums">{empreendimento.unidades.length}</td>
                        <td className="text-right font-mono tabular-nums">{contratosAbertos}</td>
                        <td>
                          <div className="flex justify-end gap-1.5">
                            <Link
                              href={urlLista({ q, status, editar: empreendimento.id })}
                              className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[11px]`}
                            >
                              Editar
                            </Link>
                            {empreendimento.ativo && unidadesAtivas > 0 ? (
                              <button
                                type="button"
                                disabled
                                title="Desative primeiro os imóveis sem uso. Empreendimentos com imóveis ativos precisam permanecer ativos."
                                className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[11px]`}
                                aria-label={`${empreendimento.nome} não pode ser desativado porque possui imóveis ativos`}
                              >
                                Em uso
                              </button>
                            ) : (
                              <form action={definirStatusEmpreendimento}>
                                <input type="hidden" name="id" value={empreendimento.id} />
                                <input type="hidden" name="ativo" value={empreendimento.ativo ? "0" : "1"} />
                                <button
                                  type="submit"
                                  className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[11px]`}
                                  aria-label={`${empreendimento.ativo ? "Desativar" : "Reativar"} ${empreendimento.nome}`}
                                >
                                  {empreendimento.ativo ? "Desativar" : "Reativar"}
                                </button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-contorno px-4 py-3 text-[11px] leading-relaxed text-tinta-suave">
            Somente empreendimentos sem imóveis ativos podem ser desativados. Nenhum contrato ou histórico financeiro é apagado.
          </div>
        </Card>
      </div>
    </div>
  );
}
