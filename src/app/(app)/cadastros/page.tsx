import Link from "next/link";
import { Card, Kpi, PageHeader, btnSecundario } from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  CartaoModulo,
  NavegacaoCadastros,
} from "./_components";

export const metadata = { title: "Cadastros — Brisa" };

export default async function PaginaCadastros() {
  const [
    empreendimentos,
    empreendimentosAtivos,
    unidades,
    unidadesAtivas,
    locatarios,
    locatariosSemContato,
    contratosAtivos,
    unidadesSemContrato,
  ] = await Promise.all([
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
        descricao="A base única de imóveis e inquilinos que alimenta contratos, cobranças e relatórios."
        acoes={
          <Link href="/contratos" className={btnSecundario}>
            Ver contratos
          </Link>
        }
      />

      <NavegacaoCadastros atual="inicio" />

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

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
              atualizam as telas operacionais sem duplicar cadastros.
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
