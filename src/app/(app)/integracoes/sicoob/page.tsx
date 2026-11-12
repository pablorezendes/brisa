import "server-only";

import Link from "next/link";
import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { Card, PageHeader, Selo, btnSecundario } from "@/components/ui";
import { SicoobContas } from "@/components/painel-contas-sicoob";
import { obterEstadoConfiguracaoSicoob } from "@/lib/integracoes/sicoob";
import { CertificadoSicoob } from "./certificado";
import { TesteAutenticacaoSicoob } from "./teste-autenticacao";

export const metadata = { title: "Sicoob — Integrações — Brisa" };
export const dynamic = "force-dynamic";

function Etapa({ numero, titulo, children }: { numero: string; titulo: string; children: React.ReactNode }) {
  return <div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-oliva/20 bg-oliva/5 font-mono text-[13px] font-bold text-oliva">{numero}</span><div className="min-w-0"><h2 className="text-[16px] font-bold tracking-tight text-tinta">{titulo}</h2><p className="mt-1 text-[12px] leading-relaxed text-tinta-suave">{children}</p></div></div>;
}

export default async function PaginaIntegracaoSicoob({ searchParams }: {
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  await exigirPaginaAcesso("/integracoes/sicoob");
  await exigirPermissaoAcesso("boletos.configurar", { global: true });
  await exigirPermissaoAcesso("contas.editar", { global: true });
  const sp = await searchParams;
  // Inspeção local: renderizar esta página nunca faz chamadas ao banco.
  const estado = obterEstadoConfiguracaoSicoob();
  const retornoProtegido = /^[A-Za-z0-9_-]{43,128}$/.test(process.env.SICOOB_SYNC_SECRET?.trim() ?? "");

  return <div className="space-y-5">
    <PageHeader titulo="Conexão com o Sicoob" descricao="Envie o certificado A1 para conectar a aplicação autorizada pelo banco."
      acoes={<><Link href="/integracoes" className={btnSecundario}>Todas as integrações</Link><Link href="/financeiro/boletos" className={btnSecundario}>Ir para boletos</Link></>} />
    {sp.erro && <p role="alert" className="break-words rounded-lg border border-erro/25 bg-erro/5 p-4 text-[13px] text-erro">{sp.erro.slice(0, 500)}</p>}
    {sp.ok && <p role="status" className="break-words rounded-lg border border-oliva/25 bg-oliva/5 p-4 text-[13px] text-tinta">{sp.ok.slice(0, 500)}</p>}

    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold text-tinta">Preparação para operar</h2><Selo nivel={estado.ambiente === "producao" ? "info" : "neutro"}>{estado.ambiente === "producao" ? "Ambiente de produção" : "Ambiente de testes"}</Selo></div>
      <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-tinta-suave">A integração usa uma conta autorizada pelo Sicoob por vez.</p>
      <nav aria-label="Etapas da integração Sicoob" className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[['#credenciais', 'Certificado'], ['#autenticacao', 'Teste de autenticação'], ['#convenio', 'Convênio'], ['#retornos', 'Retorno de pagamentos']].map(([href, texto]) => <a key={href} href={href} className="rounded-lg border border-contorno px-3 py-3 text-[12px] font-semibold text-tinta transition hover:border-oliva hover:bg-oliva/5">{texto}</a>)}
      </nav>
    </Card>

    <section id="credenciais" className="scroll-mt-24"><Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Etapa numero="01" titulo={estado.certificadoPainel ? "Substituir certificado A1" : "Enviar certificado A1"}>
          Use o arquivo .pfx ou .p12 e a senha do certificado. O Brisa valida a conexão com o Sicoob antes de salvar a credencial criptografada.
        </Etapa>
        <Selo nivel={estado.configurado ? "info" : "atencao"}>
          {estado.certificadoPainel && estado.configurado ? "Certificado salvo no Brisa" : estado.configurado ? "Configuração local disponível" : "Instalação pendente"}
        </Selo>
      </div>
      {!estado.clientIdConfigurado && <p className="mt-4 text-[13px] leading-relaxed text-tinta">
        No primeiro cadastro, use o Client ID da aplicação autorizada no{" "}
        <a href="https://developers.sicoob.com.br/portal/apis" target="_blank" rel="noopener noreferrer" className="font-semibold text-petroleo underline">Portal Developers Sicoob</a>.
      </p>}
      <CertificadoSicoob pedirClientId={!estado.clientIdConfigurado} />
    </Card></section>

    <section id="autenticacao" className="scroll-mt-24"><Card className="space-y-4 p-5 sm:p-6">
      <Etapa numero="02" titulo="Teste a autenticação, sem movimentar dinheiro">Valida a configuração local e solicita somente um token OAuth ao Sicoob. Não consulta CPF, não emite boleto e não altera títulos.</Etapa>
      <TesteAutenticacaoSicoob ambiente={estado.ambiente} />
    </Card></section>

    <section id="convenio" className="scroll-mt-24 space-y-4">
      <Card className="p-5 sm:p-6"><Etapa numero="03" titulo="Confira o convênio e as regras de novos boletos">Revise os dados da conta principal e confirme a modalidade com o banco. Não habilite as outras contas com as mesmas credenciais.</Etapa>
        <p className="mt-4 text-[13px] leading-relaxed text-tinta">A leitura do layout Widesys em 21/10/2026 confirmou conta API, cliente Sisbr, espécie e tolerância já preservados na referência legada. A modalidade estava vazia: <strong>carteira 1 não comprova modalidade 1</strong>. Contadores do legado são históricos; não reinicie ou copie nosso número para uma nova emissão.</p>
        <p className="mt-2 text-[12px] leading-relaxed text-tinta-suave">Nenhum parâmetro do Widesys foi alterado nesta conferência. Ao salvar aqui, as mudanças se aplicam ao Brisa; não cancelam ou reemitem títulos antigos. Credenciais válidas não substituem a confirmação do convênio.</p>
      </Card>
      <SicoobContas />
    </section>

    <section id="retornos" className="scroll-mt-24"><Card className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><Etapa numero="04" titulo="Prepare a confirmação dos pagamentos">O retorno financeiro usa o arquivo de liquidações tipo 5 / LIQUI. O webhook tipo 7 é um aviso opcional, não uma quitação.</Etapa><Selo nivel={retornoProtegido ? "info" : "atencao"}>{retornoProtegido ? "Chave de retorno instalada" : "Chave de retorno pendente"}</Selo></div>
      <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-tinta">
        <li>Configure <code>SICOOB_SYNC_SECRET</code> no servidor com uma chave exclusiva forte (43 a 128 caracteres Base64URL/hex). Não reutilize a senha do certificado.</li>
        <li>Após validar acesso e convênio, use <strong>Financeiro &gt; Boletos &gt; Atualizar e buscar LIQUI</strong>. O arquivo é assíncrono; pode exigir execuções posteriores até ficar disponível.</li>
        <li>Para retorno automático, o responsável pelo servidor deve instalar e acompanhar o agendamento protegido documentado em <code>DEPLOY.md</code>. Ter a chave instalada não comprova que o agendador está funcionando.</li>
        <li>Confira divergências em <strong>Conferir pagamentos</strong>. O Brisa valida identidade, conta, data e valor antes da baixa, sem repetir pagamentos já processados.</li>
      </ol>
      <p className="rounded-lg border border-ambar/25 bg-ambar/5 p-3 text-[12px] leading-relaxed text-tinta">Não substitua o callback do Widesys sem planejar a virada. O cadastro de webhook é uma alteração externa e exige escopos específicos. A captura do layout e o teste de autenticação não registram nem trocam webhooks.</p>
      <div className="flex flex-wrap gap-2"><Link href="/financeiro/boletos" className={btnSecundario}>Operar boletos</Link><Link href="/financeiro/conciliacao" className={btnSecundario}>Conferir pagamentos</Link><Link href="/financeiro/contas-bancarias" className={btnSecundario}>Cadastro de contas</Link></div>
    </Card></section>
  </div>;
}
