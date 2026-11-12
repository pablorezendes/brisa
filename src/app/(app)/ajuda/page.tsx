import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { podeAbrirRota } from "@/lib/acesso/politica";
import { Card, PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "Como funciona — Brisa" };

const consultas = [
  { href: "/executivo", titulo: "Executivo", descricao: "Escolha o mês ou período para acompanhar o saldo, as entradas, as saídas e os recebimentos." },
  { href: "/recebimentos", titulo: "Contas a receber", descricao: "Localize cobranças por nome e competência. Use Somente vencidos para ver cobranças em atraso." },
  { href: "/financeiro/contas-a-pagar", titulo: "Contas a pagar", descricao: "Confira títulos, vencimentos e pagamentos registrados no Widesys." },
  { href: "/caixa", titulo: "Entradas e saídas", descricao: "Consulte as movimentações financeiras do Widesys." },
  { href: "/financeiro/migracao-widesys", titulo: "Capturas do Widesys", descricao: "Veja quando os dados foram capturados e se há registros com inconsistências." },
  { href: "/carteira", titulo: "Minha carteira", descricao: "Consulte os cadastros e os títulos dos imóveis liberados para você." },
  { href: "/temporada", titulo: "Temporada", descricao: "Controle limpezas, despesas e repasses de hospedagem na operação de temporada." },
];

export default async function PaginaAjuda() {
  await exigirPaginaAcesso("/ajuda");
  const acesso = await acessoAtual();
  return (
    <div className="max-w-4xl">
      <PageHeader titulo="Como funciona" descricao="Onde consultar os dados e como conferir uma cobrança ou pagamento." />
      <Card className="mb-5 p-5">
        <h2 className="text-base font-semibold">Onde registrar lançamentos</h2>
        <p className="mt-2 text-sm leading-relaxed text-tinta-suave">
          Registre cobranças, pagamentos e movimentações no Widesys. O Brisa usa a última captura importada para atualizar as consultas e os indicadores financeiros.
        </p>
      </Card>
      <section aria-label="Consultas disponíveis" className="grid gap-3 sm:grid-cols-2">
        {consultas.filter(consulta => podeAbrirRota(acesso, consulta.href)).map(consulta => (
          <Link key={consulta.href} href={consulta.href} className="group">
            <Card className="h-full p-4">
              <h2 className="text-sm font-semibold group-hover:underline">{consulta.titulo}</h2>
              <p className="mt-1 text-sm leading-relaxed text-tinta-suave">{consulta.descricao}</p>
            </Card>
          </Link>
        ))}
      </section>
      <Card className="mt-5 p-5">
        <h2 className="text-base font-semibold">Como ler a situação de um título</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">Competência</dt><dd className="text-tinta-suave">Mês ao qual a cobrança ou despesa pertence.</dd></div>
          <div><dt className="font-semibold">Em aberto</dt><dd className="text-tinta-suave">Saldo que ainda consta como pendente no Widesys.</dd></div>
          <div><dt className="font-semibold">Vencido</dt><dd className="text-tinta-suave">Título com saldo e vencimento anterior a hoje.</dd></div>
          <div><dt className="font-semibold">Inconsistência</dt><dd className="text-tinta-suave">Registro que exige correção no Widesys e uma nova captura para entrar nos totais.</dd></div>
        </dl>
      </Card>
    </div>
  );
}
