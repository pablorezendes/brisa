import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { podeExibirAcao } from "@/components/acao-autorizada";
import { filtroGovernanca } from "@/lib/governanca/filtros";
import Link from "next/link";
import { ExcluirRegistroLink } from "@/components/excluir-registro-link";
import { LinkGovernanca } from "@/components/link-governanca";
import { Card, PageHeader, btnSecundario, inputBase } from "@/components/ui";
import { EditorEmpreendimento } from "@/components/editor-empreendimento";
import { OpcoesEmpreendimento } from "@/components/opcoes-empreendimento";
import { IconeMenu } from "@/components/icones-menu";
import styles from "./empreendimentos.module.css";
import { prisma } from "@/lib/db";
import { normalizar } from "@/lib/dominio/normalizacao";
import {
  AvisosCadastro,
  EstadoVazio,
  StatusCadastro,
} from "../_components";
import {
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
  await exigirPaginaAcesso("/cadastros/empreendimentos");
  const acesso = await acessoAtual();
  const podeEditar = podeExibirAcao(acesso, { permissao: "cadastros.editar" });
  const podeRevisar = podeExibirAcao(acesso, { permissao: "governanca.editar" });
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status === "inativos" ? "inativos" : sp.status === "ativos" ? "ativos" : "todos";

  const [empreendimentosVisiveis, unidadesVisiveis, contratosVisiveis] = await Promise.all([
    filtroGovernanca(prisma, "EMPREENDIMENTO"), filtroGovernanca(prisma, "UNIDADE"), filtroGovernanca(prisma, "CONTRATO"),
  ]);
  const where = {
    ...empreendimentosVisiveis,
    ...(q ? { nome: { contains: normalizar(q) } } : {}),
    ...(status === "ativos" ? { ativo: true } : status === "inativos" ? { ativo: false } : {}),
  };

  const [empreendimentos, editando] = await Promise.all([
    prisma.empreendimento.findMany({
      where,
      include: {
        unidades: {
          where: unidadesVisiveis,
          select: {
            ativo: true,
            contratos: {
              where: { ...contratosVisiveis, status: { not: "encerrado" } },
              select: { id: true },
            },
          },
        },
      },
      orderBy: { nome: "asc" },
    }),
    podeEditar && sp.editar
      ? prisma.empreendimento.findFirst({ where: { AND: [{ id: sp.editar }, empreendimentosVisiveis] } })
      : Promise.resolve(null),
  ]);

  const retorno = urlLista({ q, status });
  const itens = empreendimentos.map(e => ({
    id: e.id, nome: e.nome, ativo: e.ativo,
    imoveis: e.unidades.length, unidadesAtivas: e.unidades.filter(u => u.ativo).length,
    contratos: e.unidades.reduce((total, u) => total + u.contratos.length, 0),
  }));
  const totalImoveis = itens.reduce((s, e) => s + e.imoveis, 0);
  const totalContratos = itens.reduce((s, e) => s + e.contratos, 0);
  return (
    <div className={styles.pagina}>
      <PageHeader titulo="Empreendimentos" descricao="Organize seus prédios e grupos de imóveis em um só lugar."
        acoes={<><Link href="/cadastros/unidades" className={btnSecundario}>Ver todos os imóveis</Link>{podeEditar && <EditorEmpreendimento retorno={retorno} />}</>} />
      <AvisosCadastro ok={sp.ok} erro={sp.erro} />
      {editando && <EditorEmpreendimento key={editando.id} abrirInicial retorno={retorno} item={itens.find(e => e.id === editando.id) ?? editando} />}
      <Card className={styles.painel}>
        <div className={styles.cabecalho}>
          <div><h2 className="text-base font-bold text-tinta">Seus empreendimentos</h2><p className="mt-1 text-xs text-tinta-suave">Encontre um cadastro, edite o nome ou acesse seus imóveis.</p></div>
          <form method="get" action="/cadastros/empreendimentos" className={styles.filtros}>
            <label className={styles.busca}><span className="mb-1.5 block text-xs font-semibold">Buscar empreendimento</span><input type="search" name="q" defaultValue={q} placeholder="Digite o nome para buscar" className={`${inputBase} w-full`} /></label>
            <label><span className="mb-1.5 block text-xs font-semibold">Situação</span><select name="status" defaultValue={status} className={`${inputBase} w-full`}><option value="todos">Todos</option><option value="ativos">Ativos</option><option value="inativos">Inativos</option></select></label>
            <button type="submit" className={btnSecundario}>Filtrar</button>
            {(q || status !== "todos") && <Link href="/cadastros/empreendimentos" className="py-2 text-xs font-semibold text-oliva-escura underline underline-offset-4">Limpar filtros</Link>}
          </form>
        </div>
        <div className={styles.resumo} aria-label="Resumo dos resultados filtrados">
          <span><strong>{itens.length}</strong> empreendimentos{q || status !== "todos" ? " encontrados" : " cadastrados"}</span><span><strong>{totalImoveis}</strong> imóveis</span><span><strong>{totalContratos}</strong> contratos abertos</span>
        </div>
        {itens.length === 0 ? <EstadoVazio titulo="Nenhum empreendimento encontrado" texto={q || status !== "todos" ? "Tente outro nome ou limpe os filtros para ver todos os cadastros." : podeEditar ? "Clique em Novo empreendimento para começar a organizar seus imóveis." : "Nenhum empreendimento disponível para consulta."} /> :
          <ul className={styles.lista} aria-label="Empreendimentos cadastrados">
            {itens.map(item => <li key={item.id} className={styles.linha}>
              <div className={styles.identidade}><span className={styles.icone}><IconeMenu nome="empreendimentos" tamanho={23} /></span><div className="min-w-0"><h3 className="break-words text-sm font-bold leading-snug text-tinta">{item.nome}</h3><p className="mt-1 text-xs text-tinta-suave">{item.unidadesAtivas ? `${item.unidadesAtivas} ${item.unidadesAtivas === 1 ? "imóvel ativo" : "imóveis ativos"}` : "Sem imóveis ativos"}</p></div></div>
              <div className={styles.situacao}><StatusCadastro ativo={item.ativo} /></div>
              <dl className={styles.numeros}><div><dt>Imóveis</dt><dd>{item.imoveis}</dd></div><div><dt>Contratos abertos</dt><dd>{item.contratos}</dd></div></dl>
              <div className={styles.acoes}>
                <Link href={`/cadastros/unidades?${new URLSearchParams({ empreendimento: item.id })}`} className="rounded-lg px-2 py-2 text-xs font-semibold text-oliva-escura hover:bg-oliva/5" aria-label={`Ver imóveis de ${item.nome}`}>Ver imóveis <span aria-hidden="true">↗</span></Link>
                {podeEditar && <EditorEmpreendimento item={item} retorno={retorno} />}
                {(podeEditar || podeRevisar) && <OpcoesEmpreendimento nome={item.nome}>
                  <LinkGovernanca tipo="EMPREENDIMENTO" id={item.id}>Revisar cadastro</LinkGovernanca>
                  {podeEditar && (item.ativo && item.unidadesAtivas > 0 ? <p className="px-3 py-2 text-xs leading-relaxed text-tinta-suave">Para desativar, desative primeiro os imóveis deste empreendimento.</p> :
                    <form action={definirStatusEmpreendimento}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="ativo" value={item.ativo ? "0" : "1"} /><button type="submit" className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold hover:bg-papel">{item.ativo ? "Desativar empreendimento" : "Reativar empreendimento"}</button></form>)}
                  <div className="mt-1 border-t border-contorno pt-1"><ExcluirRegistroLink tipo="EMPREENDIMENTO" origemId={item.id} /></div>
                </OpcoesEmpreendimento>}
              </div>
            </li>)}
          </ul>}
        <p className="border-t border-contorno px-5 py-4 text-xs leading-relaxed text-tinta-suave">{podeEditar ? <>Use <strong>Editar</strong> para ajustar o nome e <strong>Ver imóveis</strong> para gerenciar as unidades. As demais ações ficam em <strong>Mais opções (•••)</strong>.</> : <>Use <strong>Ver imóveis</strong> para consultar as unidades de cada empreendimento.</>}</p>
      </Card>
    </div>
  );
}
