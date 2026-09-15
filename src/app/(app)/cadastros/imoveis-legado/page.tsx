import Link from "next/link";
import { Badge, Card, Dinheiro, Kpi, PageHeader, Sigilo, btnSecundario, inputBase } from "@/components/ui";
import { IconeMenu } from "@/components/icones-menu";
import { listarImoveisLegado } from "@/lib/consultas/cadastros-widesys";
import { EstadoVazio, NavegacaoCadastros, PaginacaoCadastros } from "../_components";

export const metadata = { title: "Imóveis do legado — Cadastros — Brisa" };

const ESTADOS = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "disponivel", rotulo: "Disponíveis" },
  { valor: "alugado", rotulo: "Alugados" },
  { valor: "publicado", rotulo: "Publicados" },
  { valor: "nao-publicado", rotulo: "Não publicados" },
] as const;

const FINALIDADES = ["todos", "Residencial", "Comercial"] as const;

type EstadoFiltro = (typeof ESTADOS)[number]["valor"];
type FinalidadeFiltro = (typeof FINALIDADES)[number];

function primeiro(valor: string | string[] | undefined) {
  return Array.isArray(valor) ? valor[0] : valor;
}

function paginaValida(valor: string | undefined) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : 1;
}

function estadoValido(valor: string | undefined): EstadoFiltro {
  return ESTADOS.some((estado) => estado.valor === valor)
    ? (valor as EstadoFiltro)
    : "todos";
}

function finalidadeValida(valor: string | undefined): FinalidadeFiltro {
  return FINALIDADES.includes(valor as FinalidadeFiltro)
    ? (valor as FinalidadeFiltro)
    : "todos";
}

function mapaDeTotais(valor: unknown): Record<string, number> {
  if (!valor || typeof valor !== "object") return {};
  return Object.fromEntries(
    Object.entries(valor).filter((entrada): entrada is [string, number] =>
      typeof entrada[1] === "number",
    ),
  );
}

function rotuloImovel(item: { nome: string | null; referencia: string | null }) {
  return item.nome || (item.referencia ? `Imóvel ${item.referencia}` : "Imóvel sem nome");
}

function situacaoImovel(item: {
  disponivel: boolean | null;
  publicado: boolean;
  status: string | null;
}) {
  if (item.disponivel === true) {
    return { rotulo: "Disponível", cor: "verde" as const };
  }
  if (item.disponivel === false) {
    return { rotulo: "Alugado", cor: "azul" as const };
  }
  if (item.status) {
    return { rotulo: item.status, cor: "ambar" as const };
  }
  return { rotulo: "A confirmar", cor: "ambar" as const };
}

function qualidadeImovel(item: {
  referencia: string | null;
  nome: string | null;
  cidade: string | null;
  proprietarioPrincipal: { id: string; nome: string } | null;
}) {
  const pontos = [item.referencia, item.nome, item.cidade, item.proprietarioPrincipal].filter(Boolean).length;
  if (pontos === 4) return { rotulo: "Completo", cor: "verde" as const };
  if (pontos >= 2) return { rotulo: "Parcial", cor: "ambar" as const };
  return { rotulo: "Revisar", cor: "vermelho" as const };
}

function hrefEstado(q: string, estado: EstadoFiltro, finalidade: FinalidadeFiltro) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (estado !== "todos") params.set("estado", estado);
  if (finalidade !== "todos") params.set("finalidade", finalidade);
  const query = params.toString();
  return query ? `/cadastros/imoveis-legado?${query}` : "/cadastros/imoveis-legado";
}

export default async function PaginaImoveisLegado({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = (primeiro(sp.q) ?? "").trim().slice(0, 120);
  const estado = estadoValido(primeiro(sp.estado));
  const finalidade = finalidadeValida(primeiro(sp.finalidade));
  const pagina = paginaValida(primeiro(sp.pagina));
  const resultado = await listarImoveisLegado({
    q: q || undefined,
    estado,
    finalidade: finalidade === "todos" ? undefined : finalidade,
    pagina,
  });

  const totaisEstado = mapaDeTotais(resultado.totaisEstado);
  const totaisFinalidade = mapaDeTotais(resultado.totaisFinalidade);
  const totalDisponiveis = totaisEstado.disponivel ?? 0;
  const totalAlugados = totaisEstado.alugado ?? 0;
  const totalPublicados = totaisEstado.publicado ?? 0;

  return (
    <div>
      <PageHeader
        titulo="Imóveis do sistema anterior"
        descricao="Uma leitura organizada da carteira importada, com a situação registrada na origem e sem misturar dados ainda não reconciliados à operação atual."
        acoes={
          <Link href="/cadastros/unidades" className={btnSecundario}>
            Ver imóveis operacionais
          </Link>
        }
      />

      <NavegacaoCadastros atual="imoveis-legado" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Carteira importada"
          valor={resultado.total}
          detalhe="imóveis únicos identificados no Widesys"
          ajuda="Total de imóveis trazidos da API do sistema anterior, identificados pelo código da origem."
        />
        <Kpi
          rotulo="Disponíveis"
          valor={totalDisponiveis}
          detalhe="marcados como disponíveis na origem"
          ajuda="A disponibilidade representa a situação informada no Widesys e ainda pode precisar de conciliação com contratos atuais."
          nivel={totalDisponiveis > 0 ? "info" : "neutro"}
        />
        <Kpi
          rotulo="Alugados"
          valor={totalAlugados}
          detalhe="ocupados segundo o cadastro legado"
          ajuda="Imóveis que não estavam disponíveis no momento da última captura da origem."
        />
        <Kpi
          rotulo="Publicados"
          valor={totalPublicados}
          detalhe="anunciados no sistema anterior"
          ajuda="A publicação é um estado da vitrine do sistema anterior; ela não publica nada automaticamente no Brisa."
        />
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="border-b border-contorno p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e8f1ee] text-oliva-escura">
                <IconeMenu nome="imoveis-legado" tamanho={17} />
              </span>
              <div>
                <h2 className="text-sm font-bold text-tinta">Carteira legada</h2>
                <p className="text-[11px] text-tinta-suave">
                  {resultado.total} resultado(s) nos filtros atuais
                </p>
              </div>
            </div>

            <form method="get" action="/cadastros/imoveis-legado" className="grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] xl:w-auto">
              {estado !== "todos" ? <input type="hidden" name="estado" value={estado} /> : null}
              <label className="sr-only" htmlFor="busca-imovel-legado">Buscar imóvel</label>
              <input
                id="busca-imovel-legado"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Referência, nome ou endereço"
                className={`${inputBase} min-w-0 xl:w-72`}
              />
              <label className="sr-only" htmlFor="finalidade-imovel-legado">Finalidade</label>
              <select
                id="finalidade-imovel-legado"
                name="finalidade"
                defaultValue={finalidade}
                className={inputBase}
              >
                <option value="todos">Toda finalidade</option>
                <option value="Residencial">Residencial ({totaisFinalidade.Residencial ?? totaisFinalidade.residencial ?? 0})</option>
                <option value="Comercial">Comercial ({totaisFinalidade.Comercial ?? totaisFinalidade.comercial ?? 0})</option>
              </select>
              <button type="submit" className={btnSecundario}>Filtrar</button>
            </form>
          </div>

          <nav aria-label="Filtrar imóveis por situação" className="mt-4 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-1.5">
              {ESTADOS.map((opcao) => {
                const ativo = opcao.valor === estado;
                const total = opcao.valor === "todos"
                  ? resultado.total
                  : totaisEstado[opcao.valor] ?? totaisEstado[opcao.valor.replace("-", "")] ?? 0;
                return (
                  <Link
                    key={opcao.valor}
                    href={hrefEstado(q, opcao.valor, finalidade)}
                    aria-current={ativo ? "page" : undefined}
                    className={`inline-flex min-h-8 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                      ativo
                        ? "border-oliva/35 bg-[#e8f1ee] text-oliva-escura"
                        : "border-contorno bg-carta text-tinta-suave hover:border-[#aebabc] hover:text-tinta"
                    }`}
                  >
                    {opcao.rotulo}
                    <span className="font-mono text-[10px] tabular-nums opacity-70">{total}</span>
                  </Link>
                );
              })}
              {(q || finalidade !== "todos") ? (
                <Link href={hrefEstado("", estado, "todos")} className="inline-flex min-h-8 items-center px-2 text-[11px] font-bold text-tinta-suave hover:text-tinta">
                  Limpar busca e finalidade
                </Link>
              ) : null}
            </div>
          </nav>
        </div>

        {resultado.itens.length === 0 ? (
          <EstadoVazio
            icone="imoveis-legado"
            titulo="Nenhum imóvel encontrado"
            texto="Revise a busca, a finalidade ou a situação. Os filtros usam somente os dados importados da origem."
          />
        ) : (
          <>
            <div className="grid gap-3 p-3 md:hidden">
              {resultado.itens.map((item) => {
                const situacao = situacaoImovel(item);
                const qualidade = qualidadeImovel(item);
                return (
                  <article key={item.id} className="rounded-xl border border-contorno bg-carta p-4 shadow-[0_1px_2px_rgba(16,35,38,0.03)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/cadastros/imoveis-legado/${item.id}`} className="font-bold text-tinta hover:text-oliva-escura hover:underline">
                          {rotuloImovel(item)}
                        </Link>
                        <div className="mt-1 font-mono text-[10px] text-tinta-suave">
                          {item.referencia ?? "Sem referência"}
                        </div>
                      </div>
                      <Badge cor={situacao.cor}>{situacao.rotulo}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.tipo ? <Badge>{item.tipo}</Badge> : null}
                      {item.finalidade ? <Badge cor="azul">{item.finalidade}</Badge> : null}
                      <Badge cor={item.publicado ? "verde" : "slate"}>{item.publicado ? "Publicado" : "Não publicado"}</Badge>
                      <Badge cor={qualidade.cor}>Cadastro {qualidade.rotulo.toLocaleLowerCase("pt-BR")}</Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-contorno/70 pt-3 text-[11px]">
                      <div>
                        <dt className="text-tinta-suave">Localidade</dt>
                        <dd className="mt-0.5 font-semibold text-tinta">{[item.bairro, item.cidade].filter(Boolean).join(" · ") || "Não informada"}</dd>
                      </div>
                      <div>
                        <dt className="text-tinta-suave">Valor principal</dt>
                        <dd className="mt-0.5 font-semibold text-tinta"><Sigilo><Dinheiro centavos={item.valorLocacao || item.valorVenda} /></Sigilo></dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex items-center justify-between border-t border-contorno/70 pt-3">
                      <Badge cor="azul">Widesys</Badge>
                      <Link href={`/cadastros/imoveis-legado/${item.id}`} className="text-[11px] font-bold text-oliva-escura hover:underline">Ver imóvel →</Link>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="tabela">
                <caption className="sr-only">Imóveis importados do sistema anterior</caption>
                <thead>
                  <tr>
                    <th>Imóvel</th>
                    <th>Situação</th>
                    <th>Perfil</th>
                    <th>Localidade</th>
                    <th>Qualidade</th>
                    <th className="text-right">Locação</th>
                    <th className="text-right">Venda</th>
                    <th>Origem</th>
                    <th><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.itens.map((item) => {
                    const situacao = situacaoImovel(item);
                    const qualidade = qualidadeImovel(item);
                    return (
                      <tr key={item.id}>
                        <td>
                          <Link href={`/cadastros/imoveis-legado/${item.id}`} className="font-semibold text-tinta hover:text-oliva-escura hover:underline">
                            {rotuloImovel(item)}
                          </Link>
                          <div className="mt-0.5 font-mono text-[10px] text-tinta-suave">{item.referencia ?? "Sem referência"}</div>
                        </td>
                        <td><Badge cor={situacao.cor}>{situacao.rotulo}</Badge></td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {item.tipo ? <Badge>{item.tipo}</Badge> : null}
                            {item.finalidade ? <Badge cor="azul">{item.finalidade}</Badge> : null}
                          </div>
                        </td>
                        <td>{[item.bairro, item.cidade].filter(Boolean).join(" · ") || "—"}</td>
                        <td><Badge cor={qualidade.cor}>{qualidade.rotulo}</Badge></td>
                        <td className="text-right"><Sigilo><Dinheiro centavos={item.valorLocacao} /></Sigilo></td>
                        <td className="text-right"><Sigilo><Dinheiro centavos={item.valorVenda} /></Sigilo></td>
                        <td><Badge cor="azul">Widesys</Badge></td>
                        <td className="text-right">
                          <Link href={`/cadastros/imoveis-legado/${item.id}`} className="text-[11px] font-bold text-oliva-escura hover:underline">Detalhes →</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <PaginacaoCadastros
          base="/cadastros/imoveis-legado"
          pagina={resultado.pagina}
          total={resultado.total}
          porPagina={resultado.porPagina}
          parametros={{
            q: q || undefined,
            estado: estado === "todos" ? undefined : estado,
            finalidade: finalidade === "todos" ? undefined : finalidade,
          }}
        />
      </Card>

      <p className="mt-3 text-[10px] leading-relaxed text-tinta-suave">
        Disponibilidade e publicação são retratos da última captura do Widesys. Nenhuma alteração feita nesta visão é enviada ao sistema anterior.
      </p>
    </div>
  );
}
