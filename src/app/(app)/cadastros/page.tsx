import Link from "next/link";
import { Card, Kpi, PageHeader, btnSecundario } from "@/components/ui";
import { prisma } from "@/lib/db";
import { perfilAtual } from "@/lib/autorizacao";
import {
  CartaoModulo,
  NavegacaoCadastros,
} from "./_components";

export const metadata = { title: "Cadastros — Brisa" };

export default async function PaginaCadastros() {
  const perfil = await perfilAtual();
  const podeUnificar = perfil === "ADMINISTRADOR" || perfil === "FINANCEIRO";
  const [
    pessoasLegado,
    papeisLegado,
    imoveisLegado,
    imoveisLegadoDisponiveis,
    empreendimentos,
    empreendimentosAtivos,
    unidades,
    unidadesAtivas,
    locatarios,
    locatariosSemContato,
    contratosAtivos,
    unidadesSemContrato,
  ] = await Promise.all([
    prisma.pessoa.count(),
    prisma.pessoaPapel.count(),
    prisma.imovelLegado.count(),
    prisma.imovelLegado.count({ where: { disponivel: true } }),
    prisma.empreendimento.count(),
    prisma.empreendimento.count({ where: { ativo: true } }),
    prisma.unidade.count(),
    prisma.unidade.count({ where: { ativo: true } }),
    prisma.locatario.count(),
    prisma.locatario.count({ where: { contato: null } }),
    prisma.contrato.count({ where: { status: "ativo" } }),
    prisma.unidade.count({ where: { contratos: { none: { status: { not: "encerrado" } } } } }),
  ]);

  return (
    <div>
      <PageHeader
        titulo="Cadastros"
        descricao="Consulte a base trazida do sistema anterior e os cadastros operacionais que alimentam contratos, cobranças e relatórios."
        acoes={
          <Link href="/contratos" className={btnSecundario}>
            Ver contratos
          </Link>
        }
      />

      <NavegacaoCadastros atual="inicio" />
      {podeUnificar ? <Card nivel="info" className="mb-5 flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"><div><h2 className="text-sm font-bold">Uma base para Widesys, planilhas e operação</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-tinta-suave">Pessoas, imóveis e contratos com origem visível. Confira correspondências e resolva duplicidades mantendo as referências das duas fontes.</p></div><div className="flex shrink-0 flex-wrap gap-2"><Link href="/cadastros/base-unificada" className={btnSecundario}>Abrir base unificada</Link><Link href="/unificacao?estado=PENDENTE" className={btnSecundario}>Revisar correspondências</Link></div></Card> : null}

      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-tinta">Base consolidada do legado</h2>
          <p className="mt-0.5 text-[11px] text-tinta-suave">Cadastros preservados com identidade e proveniência da origem.</p>
        </div>
        <span className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-tinta-suave sm:block">origem · Widesys</span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CartaoModulo
          href="/cadastros/pessoas"
          icone="pessoas"
          titulo="Pessoas e empresas"
          descricao="Consulte todos os perfis sem duplicar quem exerce mais de um papel na operação."
          total={pessoasLegado}
          detalhe={`${papeisLegado} vínculos de papel`}
        />
        <CartaoModulo
          href="/cadastros/imoveis-legado"
          icone="imoveis-legado"
          titulo="Imóveis do sistema anterior"
          descricao="Revise referência, finalidade, situação e proprietários antes da conciliação operacional."
          total={imoveisLegado}
          detalhe={`${imoveisLegadoDisponiveis} disponíveis na origem`}
        />
      </div>

      <div className="mb-2 mt-6">
        <h2 className="text-sm font-bold text-tinta">Cadastros operacionais</h2>
        <p className="mt-0.5 text-[11px] text-tinta-suave">Registros usados hoje por contratos, cobranças e relatórios.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CartaoModulo
          href="/cadastros/empreendimentos"
          icone="empreendimentos"
          titulo="Empreendimentos"
          descricao="Organize os prédios e grupos patrimoniais que reúnem seus imóveis."
          total={empreendimentos}
          detalhe={`${empreendimentosAtivos} ativos`}
        />
        <CartaoModulo
          href="/cadastros/unidades"
          icone="unidades"
          titulo="Imóveis"
          descricao="Controle identificação, tipo, empreendimento e disponibilidade de cada unidade."
          total={unidades}
          detalhe={`${unidadesAtivas} ativos`}
        />
        <CartaoModulo
          href="/cadastros/locatarios"
          icone="locatarios"
          titulo="Inquilinos"
          descricao="Mantenha os dados de pessoas e empresas vinculadas aos contratos."
          total={locatarios}
          detalhe={`${locatariosSemContato} sem contato`}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          rotulo="Contratos ativos"
          valor={contratosAtivos}
          detalhe="alimentam a geração mensal de cobranças"
          ajuda="Contratos ativos são a fonte dos lançamentos criados por Gerar devidos do mês em Contas a receber."
        />
        <Kpi
          rotulo="Imóveis sem contrato"
          valor={unidadesSemContrato}
          detalhe="sem vínculo ativo ou em acordo"
          ajuda="Imóveis que não têm nenhum contrato aberto. Um imóvel desativado pode continuar aparecendo aqui porque desativar não apaga o histórico."
        />
        <Kpi
          rotulo="Cadastros incompletos"
          valor={locatariosSemContato}
          detalhe="inquilinos ainda sem contato"
          ajuda="Cadastros sem telefone ou e-mail. Complete esses dados para facilitar cobrança e atendimento."
        />
      </div>

      <Card className="mt-5 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-oliva">
              Como os dados se conectam
            </div>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-tinta-suave">
              O empreendimento agrupa os imóveis. Cada contrato conecta um imóvel a um
              inquilino e define os valores usados nas cobranças mensais. Alterações aqui
              atualizam as telas operacionais sem duplicar cadastros. A base do legado fica
              separada até cada vínculo ser conferido, preservando a rastreabilidade.
            </p>
          </div>
          <Link href="/contratos/novo" className="shrink-0 text-[12px] font-bold text-oliva-escura hover:underline">
            Criar contrato →
          </Link>
        </div>
      </Card>
    </div>
  );
}
