import Link from "next/link";
import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { IconeMenu, type IconeMenuNome } from "@/components/icones-menu";
import { Badge, Card, PageHeader, btnPrimario, btnSecundario } from "@/components/ui";

export const metadata = { title: "Integrações — Brisa" };
export const dynamic = "force-dynamic";

const CONECTORES: {
  titulo: string;
  tipo: string;
  descricao: string;
  detalhe: string;
  href: string;
  acao: string;
  icone: IconeMenuNome;
}[] = [
  {
    titulo: "Capturas do Widesys",
    tipo: "Origem dos dados",
    descricao: "Confira os lotes trazidos do sistema anterior e o que ainda precisa de revisão.",
    detalhe: "O histórico é uma fotografia da última captura importada. Abrir esta tela não busca dados novos nem comprova uma conexão em tempo real.",
    href: "/financeiro/migracao-widesys",
    acao: "Conferir capturas e pendências",
    icone: "historico",
  },
  {
    titulo: "E-mail e WhatsApp",
    tipo: "Comunicação",
    descricao: "Configure os canais de cobrança, os destinatários autorizados e as mensagens.",
    detalhe: "O painel reúne configuração e operação: modelos, autorizações, fila e histórico de envios. Nenhuma mensagem é enviada ao abrir.",
    href: "/financeiro/automacoes",
    acao: "Abrir configuração e envios",
    icone: "mensagens",
  },
  {
    titulo: "Notas de serviço · NFS-e",
    tipo: "Conexão fiscal",
    descricao: "Revise o emitente, o provedor e os parâmetros fiscais com sua contabilidade.",
    detalhe: "Configuração e homologação são etapas anteriores à emissão. A consulta e a operação das notas continuam no Financeiro.",
    href: "/financeiro/notas-fiscais/configuracao",
    acao: "Revisar configuração fiscal",
    icone: "notas-fiscais",
  },
];

export default async function PaginaIntegracoes() {
  await exigirPaginaAcesso("/integracoes");

  return (
    <div>
      <PageHeader
        titulo="Integrações"
        descricao="Um lugar para preparar as conexões do Brisa. A movimentação do dia a dia continua no Financeiro."
        acoes={<Link href="/financeiro" className={btnSecundario}>Ir para o financeiro</Link>}
      />

      <section aria-labelledby="sicoob-titulo" className="mb-6 overflow-hidden rounded-2xl border border-[#24464a] bg-[#123136] p-5 text-white sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8cdbca]">Integração bancária</p>
            <h2 id="sicoob-titulo" className="mt-2 text-2xl font-bold tracking-tight">Sicoob: da configuração ao retorno</h2>
            <p className="mt-3 text-sm leading-relaxed text-[#d0e2e1]">
              Confira a conta do convênio, os parâmetros trazidos do Widesys e os requisitos de conexão antes de liberar novos boletos.
            </p>
          </div>
          <Link href="/integracoes/sicoob" className={`${btnPrimario} shrink-0 self-start lg:self-center`}>
            Configurar e validar Sicoob <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ol className="mt-6 grid gap-4 border-t border-white/15 pt-5 text-sm leading-relaxed sm:grid-cols-3">
          <li><strong className="block text-white">1. Conferir o convênio</strong><span className="text-[#bed5d3]">A conta e as regras precisam corresponder ao cadastro autorizado pelo banco.</span></li>
          <li><strong className="block text-white">2. Validar a conexão</strong><span className="text-[#bed5d3]">Credenciais e certificado configurados não substituem um teste com o Sicoob.</span></li>
          <li><strong className="block text-white">3. Liberar a operação</strong><span className="text-[#bed5d3]">A emissão exige ativação consciente. Pagamento só é baixado após confirmação financeira.</span></li>
        </ol>
      </section>

      <div className="mb-6 grid gap-4 xl:grid-cols-3">
        {CONECTORES.map((conector) => (
          <Card key={conector.href} className="flex min-w-0 flex-col p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf1ef] text-oliva-escura"><IconeMenu nome={conector.icone} tamanho={21} /></span>
              <Badge cor="slate">{conector.tipo}</Badge>
            </div>
            <h2 className="text-base font-bold text-tinta">{conector.titulo}</h2>
            <p className="mt-2 text-sm leading-relaxed text-tinta-suave">{conector.descricao}</p>
            <p className="mt-3 flex-1 text-xs leading-relaxed text-tinta-suave">{conector.detalhe}</p>
            <Link href={conector.href} className={`${btnSecundario} mt-5 w-full whitespace-normal text-center`}>{conector.acao}</Link>
          </Card>
        ))}
      </div>

      <Card className="p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-bold text-tinta">Configurar aqui. Trabalhar no Financeiro.</h2>
            <p className="mt-2 text-xs leading-relaxed text-tinta-suave">Depois de conferir a integração, use as telas da operação para emitir boletos, acompanhar pagamentos e consultar contas.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/financeiro/boletos" className={btnSecundario}>Boletos</Link>
              <Link href="/financeiro/conciliacao" className={btnSecundario}>Conferir pagamentos</Link>
              <Link href="/financeiro/contas-bancarias" className={btnSecundario}>Contas bancárias</Link>
            </div>
          </div>
          <div className="border-t border-contorno pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <h2 className="text-sm font-bold text-tinta">Como interpretar esta central</h2>
            <p className="mt-2 text-xs leading-relaxed text-tinta-suave">Os cartões organizam os destinos; não são um teste de disponibilidade dos serviços. Consulte as verificações e pendências dentro de cada integração. Abrir esta página não importa dados, não transmite notas e não emite cobranças.</p>
            <p className="mt-3 text-xs leading-relaxed text-tinta-suave">Credenciais e certificados ficam no ambiente seguro do servidor ou do provedor. Não os envie em observações, mensagens ou capturas de tela.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
