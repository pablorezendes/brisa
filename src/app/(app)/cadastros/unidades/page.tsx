import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Badge, Card, PageHeader, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { prisma } from "@/lib/db";
import { normalizar } from "@/lib/dominio/normalizacao";
import { TIPOS_UNIDADE } from "@/lib/consultas/locacao";
import {
  AvisosCadastro,
  EstadoVazio,
  NavegacaoCadastros,
  PaginacaoCadastros,
  StatusCadastro,
} from "../_components";
import { atualizarUnidade, criarUnidade, definirStatusUnidade } from "../actions";

export const metadata = { title: "Imóveis — Cadastros — Brisa" };

type SearchParams = Promise<{
  q?: string;
  empreendimento?: string;
  tipo?: string;
  status?: string;
  pagina?: string;
  editar?: string;
  ok?: string;
  erro?: string;
}>;

function rotuloTipo(tipo: string): string {
  if (tipo === "temporada") return "Temporada";
  if (tipo === "residencial") return "Residencial";
  return "Comercial";
}

function urlLista(filtros: {
  q?: string;
  empreendimento?: string;
  tipo?: string;
  status?: string;
  pagina?: string;
  editar?: string;
}) {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor && valor !== "todos") params.set(chave, valor);
  }
  const query = params.toString();
  return query ? `/cadastros/unidades?${query}` : "/cadastros/unidades";
}

export default async function PaginaUnidades({ searchParams }: { searchParams: SearchParams }) {
  const porPagina = 40;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const empreendimentoId = sp.empreendimento ?? "todos";
  const tipo = (TIPOS_UNIDADE as readonly string[]).includes(sp.tipo ?? "")
    ? sp.tipo!
    : "todos";
  const status = sp.status === "inativos" ? "inativos" : sp.status === "ativos" ? "ativos" : "todos";

  const where: Prisma.UnidadeWhereInput = {};
  if (q) {
    const termo = normalizar(q);
    where.OR = [
      { identificacao: { contains: termo } },
      { empreendimento: { nome: { contains: termo } } },
      { contratos: { some: { locatario: { nomeNorm: { contains: termo } } } } },
    ];
  }
  if (empreendimentoId !== "todos") where.empreendimentoId = empreendimentoId;
  if (tipo !== "todos") where.tipo = tipo;
  if (status === "ativos") where.ativo = true;
  if (status === "inativos") where.ativo = false;

  const totalResultados = await prisma.unidade.count({ where });
  const totalPaginas = Math.max(1, Math.ceil(totalResultados / porPagina));
  const paginaPedida = Number.parseInt(sp.pagina ?? "1", 10);
  const pagina = Math.min(
    Number.isInteger(paginaPedida) && paginaPedida > 0 ? paginaPedida : 1,
    totalPaginas,
  );

  const [unidades, empreendimentos, editando] = await Promise.all([
    prisma.unidade.findMany({
      where,
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      include: {
        empreendimento: true,
        contratos: {
          where: { status: { not: "encerrado" } },
          select: {
            id: true,
            status: true,
            locatario: { select: { nome: true } },
          },
          orderBy: [{ status: "desc" }, { id: "asc" }],
        },
        _count: { select: { contratos: true } },
      },
      orderBy: [
        { empreendimento: { nome: "asc" } },
        { identificacao: "asc" },
      ],
    }),
    prisma.empreendimento.findMany({ orderBy: { nome: "asc" } }),
    sp.editar
      ? prisma.unidade.findUnique({ where: { id: sp.editar }, include: { empreendimento: true } })
      : Promise.resolve(null),
  ]);

  const filtrosAtivos = Boolean(
    q || empreendimentoId !== "todos" || tipo !== "todos" || status !== "todos",
  );
  const filtros = {
    q,
    empreendimento: empreendimentoId,
    tipo,
    status,
    pagina: pagina > 1 ? String(pagina) : undefined,
  };

  return (
    <div>
      <PageHeader
        titulo="Imóveis"
        descricao="Unidades físicas usadas nos contratos de locação e na operação de temporada."
        acoes={
          <Link href="/contratos/novo" className={btnSecundario}>
            Novo contrato
          </Link>
        }
      />
      <NavegacaoCadastros atual="unidades" />
      <AvisosCadastro ok={sp.ok} erro={sp.erro} />

      <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(270px,0.36fr)_minmax(0,1fr)]">
        <Card className="p-5 2xl:sticky 2xl:top-20">
          <div className="mb-4">
            <h2 className="text-base font-bold tracking-tight text-tinta">
              {editando ? "Editar imóvel" : "Novo imóvel"}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-tinta-suave">
              A identificação deve ser única dentro do empreendimento.
            </p>
          </div>
          <form
            action={editando ? atualizarUnidade : criarUnidade}
            className="grid gap-3.5 md:grid-cols-3 xl:grid-cols-[1.2fr_1fr_0.8fr_auto] 2xl:block 2xl:space-y-3.5"
          >
            {editando ? <input type="hidden" name="id" value={editando.id} /> : null}
            <label htmlFor="empreendimento-unidade" className="block text-[12px] font-semibold text-tinta">
              Empreendimento
              <select
                id="empreendimento-unidade"
                name="empreendimentoId"
                required
                defaultValue={editando?.empreendimentoId ?? ""}
                className={`${inputBase} mt-1.5 block w-full`}
              >
                <option value="">— selecione —</option>
                {empreendimentos
                  .filter(
                    (empreendimento) =>
                      empreendimento.ativo || empreendimento.id === editando?.empreendimentoId,
                  )
                  .map((empreendimento) => (
                  <option key={empreendimento.id} value={empreendimento.id}>
                    {empreendimento.nome}{empreendimento.ativo ? "" : " (inativo)"}
                  </option>
                  ))}
              </select>
            </label>
            <label htmlFor="identificacao-unidade" className="block text-[12px] font-semibold text-tinta">
              Identificação
              <input
                id="identificacao-unidade"
                name="identificacao"
                required
                maxLength={120}
                defaultValue={editando?.identificacao ?? ""}
                placeholder="Ex.: Sala 101"
                className={`${inputBase} mt-1.5 block w-full`}
              />
            </label>
            <label htmlFor="tipo-unidade" className="block text-[12px] font-semibold text-tinta">
              Tipo do imóvel
              <select
                id="tipo-unidade"
                name="tipo"
                required
                defaultValue={editando?.tipo ?? "comercial"}
                className={`${inputBase} mt-1.5 block w-full`}
              >
                {TIPOS_UNIDADE.map((opcao) => (
                  <option key={opcao} value={opcao}>{rotuloTipo(opcao)}</option>
                ))}
              </select>
            </label>
            {editando ? (
              <p className="rounded-lg bg-[#f5f7f7] px-3 py-2 text-[11px] leading-relaxed text-tinta-suave md:col-span-full 2xl:mt-3.5">
                Imóveis com contratos podem mudar de nome e tipo, mas não de empreendimento. Isso preserva o histórico financeiro.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-0.5 xl:self-end 2xl:mt-3.5">
              <button type="submit" className={btnPrimario}>
                {editando ? "Salvar alterações" : "Cadastrar"}
              </button>
              {editando ? (
                <Link href={urlLista(filtros)} className={btnSecundario}>Cancelar</Link>
              ) : null}
            </div>
          </form>
        </Card>

        <Card>
          <div className="border-b border-contorno px-4 py-4">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-tinta">Base de imóveis</h2>
                <p className="mt-0.5 text-[11px] text-tinta-suave">{totalResultados} resultado(s)</p>
              </div>
              {filtrosAtivos ? (
                <Link href="/cadastros/unidades" className="text-[11px] font-bold text-tinta-suave hover:text-tinta">
                  Limpar filtros
                </Link>
              ) : null}
            </div>
            <form method="get" action="/cadastros/unidades" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1.35fr_1fr_0.7fr_0.7fr_auto]">
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                Buscar
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Imóvel, prédio ou inquilino"
                  className={`${inputBase} mt-1 block w-full py-1.5`}
                />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                Empreendimento
                <select name="empreendimento" defaultValue={empreendimentoId} className={`${inputBase} mt-1 block w-full py-1.5`}>
                  <option value="todos">Todos</option>
                  {empreendimentos.map((empreendimento) => (
                    <option key={empreendimento.id} value={empreendimento.id}>{empreendimento.nome}</option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                Tipo
                <select name="tipo" defaultValue={tipo} className={`${inputBase} mt-1 block w-full py-1.5`}>
                  <option value="todos">Todos</option>
                  {TIPOS_UNIDADE.map((opcao) => (
                    <option key={opcao} value={opcao}>{rotuloTipo(opcao)}</option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                Status
                <select name="status" defaultValue={status} className={`${inputBase} mt-1 block w-full py-1.5`}>
                  <option value="todos">Todos</option>
                  <option value="ativos">Ativos</option>
                  <option value="inativos">Inativos</option>
                </select>
              </label>
              <button type="submit" className={`${btnSecundario} self-end`}>Filtrar</button>
            </form>
          </div>

          {unidades.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum imóvel encontrado"
              texto="Revise os filtros ou cadastre uma nova unidade no formulário ao lado."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela min-w-[900px]">
                <caption className="sr-only">Imóveis cadastrados</caption>
                <thead>
                  <tr>
                    <th>Imóvel</th>
                    <th>Empreendimento</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Ocupação atual</th>
                    <th className="text-right">Histórico</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {unidades.map((unidade) => {
                    const contratosComLocatario = unidade.contratos.filter((c) => c.locatario);
                    const principal = contratosComLocatario[0];
                    return (
                      <tr key={unidade.id}>
                        <td className="font-semibold text-tinta">{unidade.identificacao}</td>
                        <td>{unidade.empreendimento.nome}</td>
                        <td><Badge cor="azul">{rotuloTipo(unidade.tipo)}</Badge></td>
                        <td><StatusCadastro ativo={unidade.ativo} /></td>
                        <td>
                          {principal ? (
                            <div>
                              <Link href={`/contratos/${principal.id}`} className="font-semibold text-tinta hover:underline">
                                {principal.locatario!.nome}
                              </Link>
                              {contratosComLocatario.length > 1 ? (
                                <div className="text-[10px] text-ambar">{contratosComLocatario.length} contratos abertos</div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-tinta-suave">Desocupado</span>
                          )}
                        </td>
                        <td className="text-right font-mono tabular-nums">{unidade._count.contratos}</td>
                        <td>
                          <div className="flex justify-end gap-1.5">
                            <Link
                              href={urlLista({ ...filtros, editar: unidade.id })}
                              className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[11px]`}
                            >
                              Editar
                            </Link>
                            {unidade.ativo && unidade._count.contratos > 0 ? (
                              <button
                                type="button"
                                disabled
                                title="Imóveis com histórico de contratos permanecem ativos para que os vínculos possam ser consultados e editados."
                                className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[11px]`}
                                aria-label={`${unidade.identificacao} não pode ser desativado porque possui contratos`}
                              >
                                Em uso
                              </button>
                            ) : (
                              <form action={definirStatusUnidade}>
                                <input type="hidden" name="id" value={unidade.id} />
                                <input type="hidden" name="ativo" value={unidade.ativo ? "0" : "1"} />
                                <button
                                  type="submit"
                                  className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[11px]`}
                                  aria-label={`${unidade.ativo ? "Desativar" : "Reativar"} ${unidade.identificacao}`}
                                >
                                  {unidade.ativo ? "Desativar" : "Reativar"}
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
          <PaginacaoCadastros
            base="/cadastros/unidades"
            pagina={pagina}
            total={totalResultados}
            porPagina={porPagina}
            parametros={{ q, empreendimento: empreendimentoId, tipo, status }}
          />
          <div className="border-t border-contorno px-4 py-3 text-[11px] leading-relaxed text-tinta-suave">
            Somente imóveis sem contratos podem ser desativados. Assim, vínculos existentes continuam disponíveis para consulta e edição.
          </div>
        </Card>
      </div>
    </div>
  );
}
