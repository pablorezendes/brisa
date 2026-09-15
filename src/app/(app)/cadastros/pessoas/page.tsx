import Link from "next/link";
import { Badge, Card, Kpi, PageHeader, Sigilo, btnSecundario, inputBase } from "@/components/ui";
import { IconeMenu } from "@/components/icones-menu";
import { listarPessoasWidesys } from "@/lib/consultas/cadastros-widesys";
import { EstadoVazio, NavegacaoCadastros, PaginacaoCadastros } from "../_components";

export const metadata = { title: "Pessoas e empresas — Cadastros — Brisa" };

const FILTROS_PAPEL = [
  { valor: "todos", rotulo: "Todos", curto: "Todos" },
  { valor: "INTERESSADOS", rotulo: "Interessados", curto: "Interessados" },
  { valor: "PROPRIETARIOS", rotulo: "Proprietários e beneficiários", curto: "Proprietários" },
  { valor: "INQUILINO", rotulo: "Inquilinos", curto: "Inquilinos" },
  { valor: "COMPRADOR", rotulo: "Compradores", curto: "Compradores" },
  { valor: "FIADORES", rotulo: "Fiadores e avalistas", curto: "Fiadores" },
  { valor: "CORRETORES", rotulo: "Corretores e funcionários", curto: "Corretores" },
  { valor: "FORNECEDOR", rotulo: "Fornecedores", curto: "Fornecedores" },
] as const;

type PapelFiltro = (typeof FILTROS_PAPEL)[number]["valor"];

const ROTULOS_PAPEL: Record<string, string> = {
  AVALISTA: "Avalista",
  BENEFICIARIO: "Beneficiário",
  COMPRADOR: "Comprador",
  CORRETOR: "Corretor",
  FIADOR: "Fiador",
  FORNECEDOR: "Fornecedor",
  FUNCIONARIO: "Funcionário",
  INQUILINO: "Inquilino",
  INTERESSADO: "Interessado",
  PRECADASTRO: "Interessado",
  PROPRIETARIO: "Proprietário",
};

function primeiro(valor: string | string[] | undefined) {
  return Array.isArray(valor) ? valor[0] : valor;
}

function paginaValida(valor: string | undefined) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : 1;
}

function papelValido(valor: string | undefined): PapelFiltro {
  return FILTROS_PAPEL.some((opcao) => opcao.valor === valor)
    ? (valor as PapelFiltro)
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

function rotuloPapel(papel: string) {
  return ROTULOS_PAPEL[papel] ?? papel.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function qualidadeCadastro(item: {
  cpfCnpjMascarado: string | null;
  emailPrincipal: string | null;
  telefonePrincipal: string | null;
  cidade: string | null;
  uf: string | null;
}) {
  const identificacao = Boolean(item.cpfCnpjMascarado);
  const contato = Boolean(item.emailPrincipal || item.telefonePrincipal);
  const localizacao = Boolean(item.cidade && item.uf);
  if (identificacao && contato && localizacao) {
    return { rotulo: "Completo", cor: "verde" as const, detalhe: "Identificação, contato e endereço presentes" };
  }
  if (identificacao && (contato || localizacao)) {
    return { rotulo: "Parcial", cor: "ambar" as const, detalhe: "Há dados úteis, mas o cadastro merece revisão" };
  }
  return { rotulo: "Revisar", cor: "vermelho" as const, detalhe: "Faltam dados essenciais para contato ou identificação" };
}

function hrefFiltro(q: string, papel: PapelFiltro) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (papel !== "todos") params.set("papel", papel);
  const query = params.toString();
  return query ? `/cadastros/pessoas?${query}` : "/cadastros/pessoas";
}

function totalDoFiltro(
  valor: PapelFiltro,
  total: number,
  totaisPorPapel: Record<string, number>,
  totaisPorGrupo: Record<string, number>,
) {
  if (valor === "todos") return total;
  return totaisPorGrupo[valor] ?? totaisPorPapel[valor] ?? 0;
}

export default async function PaginaPessoas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = (primeiro(sp.q) ?? "").trim().slice(0, 120);
  const papel = papelValido(primeiro(sp.papel));
  const pagina = paginaValida(primeiro(sp.pagina));
  const resultado = await listarPessoasWidesys({
    q: q || undefined,
    papel: papel === "todos" ? undefined : papel,
    pagina,
  });

  const totaisPorPapel = mapaDeTotais(resultado.totaisPorPapel);
  const totaisPorGrupo = mapaDeTotais(
    (resultado as unknown as { totaisPorGrupo?: unknown }).totaisPorGrupo,
  );
  const vinculos = Object.values(totaisPorPapel).reduce((soma, total) => soma + total, 0);

  return (
    <div>
      <PageHeader
        titulo="Pessoas e empresas"
        descricao="A base consolidada do sistema anterior, sem duplicar uma pessoa quando ela exerce mais de um papel."
        acoes={
          <Link href="/cadastros/locatarios" className={btnSecundario}>
            Ver inquilinos operacionais
          </Link>
        }
      />

      <NavegacaoCadastros atual="pessoas" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          rotulo="Cadastros únicos"
          valor={resultado.total}
          detalhe="pessoas e empresas identificadas no legado"
          ajuda="Uma mesma pessoa aparece uma única vez, mesmo quando é simultaneamente proprietária, fornecedora ou inquilina."
        />
        <Kpi
          rotulo="Vínculos de papel"
          valor={vinculos}
          detalhe="funções exercidas por esses cadastros"
          ajuda="É normal este número ser maior que o total: um cadastro pode ter mais de um papel."
        />
        <Kpi
          rotulo="Inquilinos"
          valor={totaisPorPapel.INQUILINO ?? 0}
          detalhe="identificados na origem"
          ajuda="Perfis marcados como inquilino no Widesys. O vínculo operacional com contratos continua na tela de Inquilinos."
        />
        <Kpi
          rotulo="Fornecedores"
          valor={totaisPorPapel.FORNECEDOR ?? 0}
          detalhe="prestadores e empresas de apoio"
          ajuda="Cadastros classificados como fornecedor no sistema anterior."
        />
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="border-b border-contorno p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e8f1ee] text-oliva-escura">
                  <IconeMenu nome="pessoas" tamanho={17} />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-tinta">Base de pessoas</h2>
                  <p className="text-[11px] text-tinta-suave">
                    {resultado.total} resultado(s) nos filtros atuais
                  </p>
                </div>
              </div>
            </div>
            <form method="get" action="/cadastros/pessoas" className="flex w-full gap-2 lg:w-auto">
              {papel !== "todos" ? <input type="hidden" name="papel" value={papel} /> : null}
              <label className="sr-only" htmlFor="busca-pessoa">Buscar pessoa ou empresa</label>
              <input
                id="busca-pessoa"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Nome, documento, cidade ou contato"
                className={`${inputBase} min-w-0 flex-1 lg:w-80`}
              />
              <button type="submit" className={btnSecundario}>Buscar</button>
              {q ? (
                <Link href={hrefFiltro("", papel)} className="flex min-h-10 items-center px-1 text-[11px] font-bold text-tinta-suave hover:text-tinta">
                  Limpar
                </Link>
              ) : null}
            </form>
          </div>

          <nav aria-label="Filtrar pessoas por papel" className="mt-4 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-1.5">
              {FILTROS_PAPEL.map((opcao) => {
                const ativo = opcao.valor === papel;
                const total = totalDoFiltro(opcao.valor, resultado.total, totaisPorPapel, totaisPorGrupo);
                return (
                  <Link
                    key={opcao.valor}
                    href={hrefFiltro(q, opcao.valor)}
                    aria-current={ativo ? "page" : undefined}
                    title={opcao.rotulo}
                    className={`inline-flex min-h-8 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                      ativo
                        ? "border-oliva/35 bg-[#e8f1ee] text-oliva-escura"
                        : "border-contorno bg-carta text-tinta-suave hover:border-[#aebabc] hover:text-tinta"
                    }`}
                  >
                    {opcao.curto}
                    <span className="font-mono text-[10px] tabular-nums opacity-70">{total}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>

        {resultado.itens.length === 0 ? (
          <EstadoVazio
            icone="pessoas"
            titulo="Nenhum cadastro encontrado"
            texto="Revise a busca ou escolha outro papel. A importação mantém os perfis exatamente como estavam no sistema anterior."
          />
        ) : (
          <>
            <div className="grid gap-3 p-3 md:hidden">
              {resultado.itens.map((item) => {
                const qualidade = qualidadeCadastro(item);
                return (
                  <article key={item.id} className="rounded-xl border border-contorno bg-carta p-4 shadow-[0_1px_2px_rgba(16,35,38,0.03)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/cadastros/pessoas/${item.id}`} className="font-bold text-tinta hover:text-oliva-escura hover:underline">
                          {item.nome}
                        </Link>
                        {item.nomeFantasia && item.nomeFantasia !== item.nome ? (
                          <div className="mt-0.5 truncate text-[10px] text-tinta-suave">{item.nomeFantasia}</div>
                        ) : null}
                        <div className="mt-1 font-mono text-[10px] text-tinta-suave">
                          <Sigilo>{item.cpfCnpjMascarado ?? "Documento não informado"}</Sigilo>
                        </div>
                      </div>
                      <Badge cor={qualidade.cor}>{qualidade.rotulo}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.papeis.map((itemPapel) => <Badge key={itemPapel}>{rotuloPapel(itemPapel)}</Badge>)}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-contorno/70 pt-3 text-[11px]">
                      <div>
                        <dt className="text-tinta-suave">Localidade</dt>
                        <dd className="mt-0.5 font-semibold text-tinta">{[item.cidade, item.uf].filter(Boolean).join(" · ") || "Não informada"}</dd>
                      </div>
                      <div>
                        <dt className="text-tinta-suave">Contato principal</dt>
                        <dd className="mt-0.5 truncate font-semibold text-tinta"><Sigilo>{item.emailPrincipal ?? item.telefonePrincipal ?? "Não informado"}</Sigilo></dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex items-center justify-between border-t border-contorno/70 pt-3">
                      <Badge cor="azul">Widesys</Badge>
                      <Link href={`/cadastros/pessoas/${item.id}`} className="text-[11px] font-bold text-oliva-escura hover:underline">Ver cadastro →</Link>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="tabela">
                <caption className="sr-only">Pessoas e empresas importadas do sistema anterior</caption>
                <thead>
                  <tr>
                    <th>Pessoa ou empresa</th>
                    <th>Papéis</th>
                    <th>Localidade</th>
                    <th>Contato principal</th>
                    <th>Qualidade</th>
                    <th>Origem</th>
                    <th><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.itens.map((item) => {
                    const qualidade = qualidadeCadastro(item);
                    return (
                      <tr key={item.id}>
                        <td>
                          <Link href={`/cadastros/pessoas/${item.id}`} className="font-semibold text-tinta hover:text-oliva-escura hover:underline">
                            {item.nome}
                          </Link>
                          {item.nomeFantasia && item.nomeFantasia !== item.nome ? (
                            <div className="mt-0.5 max-w-72 truncate text-[10px] text-tinta-suave">{item.nomeFantasia}</div>
                          ) : null}
                          <div className="mt-0.5 font-mono text-[10px] text-tinta-suave">
                            <Sigilo>{item.cpfCnpjMascarado ?? "Documento não informado"}</Sigilo>
                          </div>
                        </td>
                        <td>
                          <div className="flex max-w-72 flex-wrap gap-1">
                            {item.papeis.map((itemPapel) => <Badge key={itemPapel}>{rotuloPapel(itemPapel)}</Badge>)}
                          </div>
                        </td>
                        <td>{[item.cidade, item.uf].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="max-w-64 truncate"><Sigilo>{item.emailPrincipal ?? item.telefonePrincipal ?? "—"}</Sigilo></td>
                        <td><span title={qualidade.detalhe}><Badge cor={qualidade.cor}>{qualidade.rotulo}</Badge></span></td>
                        <td><Badge cor="azul">Widesys</Badge></td>
                        <td className="text-right">
                          <Link href={`/cadastros/pessoas/${item.id}`} className="text-[11px] font-bold text-oliva-escura hover:underline">Detalhes →</Link>
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
          base="/cadastros/pessoas"
          pagina={resultado.pagina}
          total={resultado.total}
          porPagina={resultado.porPagina}
          parametros={{ q: q || undefined, papel: papel === "todos" ? undefined : papel }}
        />
      </Card>

      <p className="mt-3 text-[10px] leading-relaxed text-tinta-suave">
        A interface mostra apenas dados cadastrais necessários à operação. Dados bancários, chaves PIX e o snapshot técnico da importação nunca são exibidos nesta área.
      </p>
    </div>
  );
}
