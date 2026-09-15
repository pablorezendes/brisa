import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Badge, Card, PageHeader, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { prisma } from "@/lib/db";
import { normalizar, normalizarCpfCnpj } from "@/lib/dominio/normalizacao";
import {
  AvisosCadastro,
  EstadoVazio,
  NavegacaoCadastros,
  PaginacaoCadastros,
} from "../_components";
import { atualizarLocatario, criarLocatario } from "../actions";

export const metadata = { title: "Inquilinos — Cadastros — Brisa" };

type SearchParams = Promise<{
  q?: string;
  vinculo?: string;
  pagina?: string;
  editar?: string;
  ok?: string;
  erro?: string;
}>;

function formatarDocumento(valor: string | null): string {
  if (!valor) return "—";
  if (valor.length === 11) {
    return valor.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (valor.length === 14) {
    return valor.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return valor;
}

function urlLista({
  q,
  vinculo,
  pagina,
  editar,
}: {
  q?: string;
  vinculo?: string;
  pagina?: string;
  editar?: string;
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (vinculo && vinculo !== "todos") params.set("vinculo", vinculo);
  if (pagina && pagina !== "1") params.set("pagina", pagina);
  if (editar) params.set("editar", editar);
  const query = params.toString();
  return query ? `/cadastros/locatarios?${query}` : "/cadastros/locatarios";
}

export default async function PaginaLocatarios({ searchParams }: { searchParams: SearchParams }) {
  const porPagina = 40;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const vinculo = sp.vinculo === "com-contrato"
    ? "com-contrato"
    : sp.vinculo === "sem-contrato"
      ? "sem-contrato"
      : "todos";

  const where: Prisma.LocatarioWhereInput = {};
  if (q) {
    const termo = normalizar(q);
    const documento = normalizarCpfCnpj(q);
    where.OR = [
      { nomeNorm: { contains: termo } },
      { contato: { contains: q } },
      { email: { contains: q } },
      { telefone: { contains: q } },
      ...(documento ? [{ cpfCnpj: { contains: documento } }] : []),
    ];
  }
  const contratoAberto: Prisma.ContratoWhereInput = { status: { not: "encerrado" } };
  if (vinculo === "com-contrato") where.contratos = { some: contratoAberto };
  if (vinculo === "sem-contrato") where.contratos = { none: contratoAberto };

  const totalResultados = await prisma.locatario.count({ where });
  const totalPaginas = Math.max(1, Math.ceil(totalResultados / porPagina));
  const paginaPedida = Number.parseInt(sp.pagina ?? "1", 10);
  const pagina = Math.min(
    Number.isInteger(paginaPedida) && paginaPedida > 0 ? paginaPedida : 1,
    totalPaginas,
  );

  const [locatarios, editando] = await Promise.all([
    prisma.locatario.findMany({
      where,
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      include: {
        contratos: {
          where: { status: { not: "encerrado" } },
          select: {
            id: true,
            status: true,
            unidade: {
              select: {
                identificacao: true,
                empreendimento: { select: { nome: true } },
              },
            },
          },
          orderBy: [{ status: "desc" }, { id: "asc" }],
        },
        _count: { select: { contratos: true } },
      },
      orderBy: { nomeNorm: "asc" },
    }),
    sp.editar ? prisma.locatario.findUnique({ where: { id: sp.editar } }) : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        titulo="Inquilinos"
        descricao="Pessoas e empresas locatárias, com seus vínculos e dados para contato."
        acoes={
          <Link href="/contratos/novo" className={btnSecundario}>
            Vincular em contrato
          </Link>
        }
      />
      <NavegacaoCadastros atual="locatarios" />
      <AvisosCadastro ok={sp.ok} erro={sp.erro} />

      <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(280px,0.38fr)_minmax(0,1fr)]">
        <Card className="p-5 2xl:sticky 2xl:top-20">
          <div className="mb-4">
            <h2 className="text-base font-bold tracking-tight text-tinta">
              {editando ? "Editar inquilino" : "Novo inquilino"}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-tinta-suave">
              CPF/CNPJ e endereço completo são necessários para registrar boletos no Sicoob.
            </p>
          </div>
          <form
            action={editando ? atualizarLocatario : criarLocatario}
            className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_auto] 2xl:block 2xl:space-y-3.5"
          >
            {editando ? <input type="hidden" name="id" value={editando.id} /> : null}
            <label htmlFor="nome-locatario" className="block text-[12px] font-semibold text-tinta">
              Nome ou razão social
              <input
                id="nome-locatario"
                name="nome"
                required
                maxLength={160}
                autoComplete="name"
                defaultValue={editando?.nome ?? ""}
                placeholder="Nome completo ou empresa"
                className={`${inputBase} mt-1.5 block w-full`}
              />
            </label>
            <label htmlFor="documento-locatario" className="block text-[12px] font-semibold text-tinta">
              CPF ou CNPJ
              <input
                id="documento-locatario"
                name="cpfCnpj"
                inputMode="numeric"
                maxLength={18}
                autoComplete="off"
                defaultValue={editando?.cpfCnpj ?? ""}
                placeholder="Somente números ou formatado"
                aria-describedby="documento-ajuda"
                className={`${inputBase} mt-1.5 block w-full`}
              />
              <span id="documento-ajuda" className="mt-1 block text-[10px] font-normal text-tinta-suave">
                O sistema remove pontos, traços e barras ao salvar.
              </span>
            </label>
            <label htmlFor="contato-locatario" className="block text-[12px] font-semibold text-tinta">
              Contato
              <input
                id="contato-locatario"
                name="contato"
                maxLength={200}
                autoComplete="tel"
                defaultValue={editando?.contato ?? ""}
                placeholder="Telefone, e-mail ou ambos"
                className={`${inputBase} mt-1.5 block w-full`}
              />
            </label>
            <div className="flex flex-wrap gap-2 pt-0.5 xl:self-end 2xl:mt-3.5">
              <button type="submit" className={btnPrimario}>
                {editando ? "Salvar alterações" : "Cadastrar"}
              </button>
              {editando ? (
                <Link
                  href={urlLista({ q, vinculo, pagina: String(pagina) })}
                  className={btnSecundario}
                >
                  Cancelar
                </Link>
              ) : null}
            </div>
            <details className="rounded-lg border border-contorno bg-[#f8fafb] p-3 md:col-span-2 xl:col-span-4 2xl:mt-4" open={Boolean(editando)}>
              <summary className="cursor-pointer text-[12px] font-bold text-tinta">
                Dados para cobrança bancária
                <span className="ml-2 font-normal text-tinta-suave">endereço e contato do pagador</span>
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-2">
                <label className="text-[12px] font-semibold text-tinta">
                  E-mail
                  <input name="email" type="email" maxLength={254} autoComplete="email" defaultValue={editando?.email ?? ""} className={`${inputBase} mt-1.5 block w-full`} />
                </label>
                <label className="text-[12px] font-semibold text-tinta">
                  Telefone
                  <input name="telefone" maxLength={30} autoComplete="tel" defaultValue={editando?.telefone ?? ""} className={`${inputBase} mt-1.5 block w-full`} />
                </label>
                <label className="text-[12px] font-semibold text-tinta">
                  CEP
                  <input name="cep" inputMode="numeric" maxLength={9} autoComplete="postal-code" defaultValue={editando?.cep ?? ""} placeholder="00000-000" className={`${inputBase} mt-1.5 block w-full`} />
                </label>
                <label className="text-[12px] font-semibold text-tinta">
                  UF
                  <input name="uf" maxLength={2} autoComplete="address-level1" defaultValue={editando?.uf ?? ""} placeholder="BA" className={`${inputBase} mt-1.5 block w-full uppercase`} />
                </label>
                <label className="text-[12px] font-semibold text-tinta sm:col-span-2">
                  Endereço
                  <input name="endereco" maxLength={180} autoComplete="street-address" defaultValue={editando?.endereco ?? ""} placeholder="Rua, avenida ou praça" className={`${inputBase} mt-1.5 block w-full`} />
                </label>
                <label className="text-[12px] font-semibold text-tinta">
                  Número
                  <input name="numeroEndereco" maxLength={30} defaultValue={editando?.numeroEndereco ?? ""} className={`${inputBase} mt-1.5 block w-full`} />
                </label>
                <label className="text-[12px] font-semibold text-tinta">
                  Complemento
                  <input name="complementoEndereco" maxLength={80} defaultValue={editando?.complementoEndereco ?? ""} className={`${inputBase} mt-1.5 block w-full`} />
                </label>
                <label className="text-[12px] font-semibold text-tinta">
                  Bairro
                  <input name="bairro" maxLength={100} autoComplete="address-level3" defaultValue={editando?.bairro ?? ""} className={`${inputBase} mt-1.5 block w-full`} />
                </label>
                <label className="text-[12px] font-semibold text-tinta">
                  Cidade
                  <input name="cidade" maxLength={100} autoComplete="address-level2" defaultValue={editando?.cidade ?? ""} className={`${inputBase} mt-1.5 block w-full`} />
                </label>
              </div>
            </details>
          </form>
        </Card>

        <Card>
          <div className="flex flex-col gap-3 border-b border-contorno px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-tinta">Base de inquilinos</h2>
              <p className="mt-0.5 text-[11px] text-tinta-suave">{totalResultados} resultado(s)</p>
            </div>
            <form method="get" action="/cadastros/locatarios" className="flex flex-wrap items-end gap-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                Buscar
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Nome, documento ou contato"
                  className={`${inputBase} mt-1 block w-56 py-1.5`}
                />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
                Vínculo
                <select name="vinculo" defaultValue={vinculo} className={`${inputBase} mt-1 block py-1.5`}>
                  <option value="todos">Todos</option>
                  <option value="com-contrato">Com contrato aberto</option>
                  <option value="sem-contrato">Sem contrato aberto</option>
                </select>
              </label>
              <button type="submit" className={btnSecundario}>Filtrar</button>
              {q || vinculo !== "todos" ? (
                <Link href="/cadastros/locatarios" className="pb-2 text-[11px] font-bold text-tinta-suave hover:text-tinta">
                  Limpar
                </Link>
              ) : null}
            </form>
          </div>

          {locatarios.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum inquilino encontrado"
              texto="Revise a busca ou cadastre um novo inquilino no formulário ao lado."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela min-w-[880px]">
                <caption className="sr-only">Inquilinos cadastrados</caption>
                <thead>
                  <tr>
                    <th>Inquilino</th>
                    <th>CPF/CNPJ</th>
                    <th>Contato</th>
                    <th>Boletos</th>
                    <th>Vínculo atual</th>
                    <th className="text-right">Contratos</th>
                    <th className="text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {locatarios.map((locatario) => {
                    const abertos = locatario.contratos;
                    const principal = abertos[0];
                    const completo = Boolean(
                      locatario.cpfCnpj &&
                      locatario.cep &&
                      locatario.endereco &&
                      locatario.numeroEndereco &&
                      locatario.bairro &&
                      locatario.cidade &&
                      locatario.uf,
                    );
                    return (
                      <tr key={locatario.id}>
                        <td className="font-semibold text-tinta">{locatario.nome}</td>
                        <td className="font-mono text-[11px] tabular-nums">
                          <Sigilo>{formatarDocumento(locatario.cpfCnpj)}</Sigilo>
                        </td>
                        <td>
                          {locatario.contato ? (
                            <Sigilo>{locatario.contato}</Sigilo>
                          ) : (
                            <span className="text-tinta-suave">Não informado</span>
                          )}
                        </td>
                        <td>
                          <Badge cor={completo ? "verde" : "ambar"}>{completo ? "Pronto" : "Dados pendentes"}</Badge>
                        </td>
                        <td>
                          {principal ? (
                            <div>
                              <Link href={`/contratos/${principal.id}`} className="font-semibold text-tinta hover:underline">
                                {principal.unidade.empreendimento.nome} · {principal.unidade.identificacao}
                              </Link>
                              {abertos.length > 1 ? (
                                <div className="text-[10px] text-tinta-suave">+ {abertos.length - 1} vínculo(s) aberto(s)</div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-tinta-suave">Sem contrato aberto</span>
                          )}
                        </td>
                        <td className="text-right font-mono tabular-nums">{locatario._count.contratos}</td>
                        <td className="text-right">
                          <Link
                            href={urlLista({
                              q,
                              vinculo,
                              pagina: String(pagina),
                              editar: locatario.id,
                            })}
                            className={`${btnSecundario} min-h-8 px-2.5 py-1 text-[11px]`}
                          >
                            Editar
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <PaginacaoCadastros
            base="/cadastros/locatarios"
            pagina={pagina}
            total={totalResultados}
            porPagina={porPagina}
            parametros={{ q, vinculo }}
          />
          <div className="border-t border-contorno px-4 py-3 text-[11px] leading-relaxed text-tinta-suave">
            Inquilinos não são excluídos ou desativados: seus dados permanecem vinculados ao histórico dos contratos e recebimentos.
          </div>
        </Card>
      </div>
    </div>
  );
}
