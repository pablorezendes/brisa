import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { OperacaoUnificada, type ParametrosUnificacao } from "@/components/operacao-unificada";
export const metadata = { title: "Movimentações — Brisa" };
export const dynamic = "force-dynamic";
export default async function Pagina({ searchParams }: { searchParams: Promise<ParametrosUnificacao> }) {
  await exigirPaginaAcesso("/financeiro/movimentacoes");
  await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  return <OperacaoUnificada dominio="MOVIMENTO" titulo="Movimentações financeiras" base="/financeiro/movimentacoes" parametros={await searchParams} nativo={{ href: "/caixa?visao=livro", rotulo: "Lançamentos do livro-caixa" }} />;
}
