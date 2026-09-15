import "server-only";

import Link from "next/link";
import {
  Badge,
  Card,
  Kpi,
  PageHeader,
  Selo,
  Sigilo,
  btnPrimario,
  btnSecundario,
  inputBase,
} from "@/components/ui";
import { perfilAtual } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { obterEstadoConfiguracaoSicoob } from "@/lib/integracoes/sicoob";
import { atualizarContaBancaria } from "./actions";
import { registrarWebhook } from "../boletos/actions";

export const metadata = { title: "Contas bancárias — Financeiro — Brisa" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ ok?: string; erro?: string }>;

type ContaVisao = {
  id: string;
  codigoBanco: string;
  nomeBanco: string;
  agencia: string;
  numero: string;
  apelido: string;
  finalidade: string | null;
  ativa: boolean;
  padrao: boolean;
  integracaoHabilitada: boolean;
  boletosHabilitados: boolean;
  integracaoStatus: string;
  ambiente: string;
  numeroCliente: string | null;
  numeroContaCorrenteApi: string | null;
  codigoEspecieDocumento: string | null;
  codigoModalidade: number | null;
  numeroContratoCobranca: string | null;
  webhookId: string | null;
  webhookStatus: string | null;
  ultimaSincronizacaoEm: Date | null;
  mensagemIntegracao: string | null;
  atualizadoEm: Date;
  atualizadoPor: { nome: string } | null;
  _count: { boletos: number };
};

function configuracaoServidor() {
  const preenchida = (valor: string | undefined) => Boolean(valor?.trim());
  const urlHttps = (valor: string | undefined) => {
    try {
      return Boolean(valor?.trim()) && new URL(valor!.trim()).protocol === "https:";
    } catch {
      return false;
    }
  };
  const estado = obterEstadoConfiguracaoSicoob();
  const tokenEstatico = preenchida(process.env.SICOOB_ACCESS_TOKEN);
  const usaTokenEstaticoSandbox =
    estado.ambiente === "sandbox" &&
    estado.autenticacao === "token_estatico" &&
    tokenEstatico;
  const oauth =
    estado.autenticacao === "oauth_client_credentials" &&
    !estado.pendencias.includes("SICOOB_TOKEN_URL");
  const mtlsExigido = !usaTokenEstaticoSandbox;
  const segredoWebhook = process.env.SICOOB_WEBHOOK_SECRET?.trim() ?? "";

  return {
    ambiente: estado.ambiente,
    clientId: preenchida(process.env.SICOOB_CLIENT_ID),
    tokenEstatico,
    usaTokenEstaticoSandbox,
    certificado: estado.mtlsConfigurado,
    mtlsExigido,
    oauth,
    api: estado.configurado && (usaTokenEstaticoSandbox || oauth),
    webhook:
      /^[A-Za-z0-9_-]{43,128}$/.test(segredoWebhook) &&
      urlHttps(process.env.APP_PUBLIC_URL),
  };
}

function finalidadeLegivel(finalidade: string | null): string {
  const nomes: Record<string, string> = {
    OPERACIONAL: "Operacional",
    APLICACAO: "Aplicação",
    IPTU: "IPTU",
    OUTRA: "Outra finalidade",
  };
  return (finalidade && nomes[finalidade]) || "Não definida";
}

function dataHora(data: Date | null): string {
  if (!data) return "Nunca sincronizada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

function contaConfigurada(conta: ContaVisao): boolean {
  return Boolean(
    conta.numeroCliente &&
      conta.numeroContaCorrenteApi &&
      conta.codigoEspecieDocumento &&
      conta.codigoModalidade,
  );
}

function StatusCadastro({ conta }: { conta: ContaVisao }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Selo nivel={conta.ativa ? "otimo" : "neutro"}>
        {conta.ativa ? "ativa" : "inativa"}
      </Selo>
      {conta.padrao ? <Selo nivel="info">padrão</Selo> : null}
    </div>
  );
}

function StatusApi({
  conta,
  servidorPronto,
}: {
  conta: ContaVisao;
  servidorPronto: boolean;
}) {
  if (!conta.ativa) return <Selo nivel="neutro">indisponível</Selo>;
  if (!contaConfigurada(conta)) {
    return <Selo nivel="atencao">dados pendentes</Selo>;
  }
  if (!conta.integracaoHabilitada) {
    return <Selo nivel="neutro">desligada</Selo>;
  }
  if (conta.integracaoStatus === "ERRO") {
    return <Selo nivel="critico">com erro</Selo>;
  }
  if (!servidorPronto) {
    return <Selo nivel="atencao">servidor pendente</Selo>;
  }
  if (conta.integracaoStatus === "PRONTA") {
    return <Selo nivel="otimo">conectada</Selo>;
  }
  return <Selo nivel="info">aguarda validação</Selo>;
}

function StatusBoletos({
  conta,
  servidorPronto,
}: {
  conta: ContaVisao;
  servidorPronto: boolean;
}) {
  if (!conta.boletosHabilitados) {
    return <Selo nivel="neutro">desabilitados</Selo>;
  }
  const pronta =
    conta.ativa &&
    conta.integracaoHabilitada &&
    contaConfigurada(conta) &&
    servidorPronto &&
    conta.integracaoStatus === "PRONTA";
  return (
    <Selo nivel={pronta ? "otimo" : "atencao"}>
      {pronta ? "prontos" : "aguardando API"}
    </Selo>
  );
}

function CheckboxConfiguracao({
  name,
  titulo,
  texto,
  defaultChecked,
}: {
  name: string;
  titulo: string;
  texto: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-contorno bg-[#f8faf9] p-3 transition-colors hover:border-[#aebabc]">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#315f56]"
      />
      <span>
        <span className="block text-[12px] font-bold text-tinta">{titulo}</span>
        <span className="mt-0.5 block text-[10px] leading-snug text-tinta-suave">
          {texto}
        </span>
      </span>
    </label>
  );
}

function FormularioConta({
  conta,
  podeGerenciar,
}: {
  conta: ContaVisao;
  podeGerenciar: boolean;
}) {
  if (!podeGerenciar) {
    return (
      <span className="text-[10px] leading-snug text-tinta-suave">
        Somente administradores podem alterar.
      </span>
    );
  }

  return (
    <details className="group min-w-[310px]">
      <summary
        className={`${btnSecundario} min-h-8 cursor-pointer list-none justify-center px-2.5 py-1 text-[11px] [&::-webkit-details-marker]:hidden`}
      >
        Configurar
        <span className="transition-transform group-open:rotate-180" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <form
        action={atualizarContaBancaria}
        className="mt-3 space-y-3 rounded-xl border border-contorno bg-[#fbfcfc] p-4 text-left shadow-[0_12px_30px_rgba(16,35,38,0.08)]"
      >
        <input type="hidden" name="id" value={conta.id} />
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-oliva">
            Configuração operacional
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-tinta-suave">
            Aqui não são solicitados token, client secret, senha ou certificado.
          </p>
        </div>

        <label className="block text-[11px] font-semibold text-tinta">
          Apelido
          <input
            name="apelido"
            required
            maxLength={80}
            defaultValue={conta.apelido}
            className={`${inputBase} mt-1.5 block w-full`}
          />
        </label>

        <label className="block text-[11px] font-semibold text-tinta">
          Finalidade
          <select
            name="finalidade"
            defaultValue={conta.finalidade ?? "OUTRA"}
            className={`${inputBase} mt-1.5 block w-full`}
          >
            <option value="OPERACIONAL">Operacional</option>
            <option value="APLICACAO">Aplicação</option>
            <option value="IPTU">IPTU</option>
            <option value="OUTRA">Outra</option>
          </select>
        </label>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="block text-[11px] font-semibold text-tinta">
            Nº cliente Sicoob
            <input
              name="numeroCliente"
              inputMode="numeric"
              pattern="[0-9]{1,15}"
              maxLength={15}
              defaultValue={conta.numeroCliente ?? ""}
              placeholder="Somente dígitos"
              className={`${inputBase} mt-1.5 block w-full min-w-0`}
            />
          </label>
          <label className="block text-[11px] font-semibold text-tinta">
            Conta no convênio
            <input
              name="numeroContaCorrenteApi"
              inputMode="numeric"
              pattern="[0-9]{1,15}"
              maxLength={15}
              defaultValue={conta.numeroContaCorrenteApi ?? ""}
              placeholder="Sem o dígito"
              className={`${inputBase} mt-1.5 block w-full min-w-0`}
            />
          </label>
          <label className="block text-[11px] font-semibold text-tinta">
            Modalidade
            <select name="codigoModalidade" defaultValue={conta.codigoModalidade ?? ""} className={`${inputBase} mt-1.5 block w-full min-w-0`}>
              <option value="">Selecione</option>
              <option value="1">1 · Simples com registro</option>
              <option value="3">3 · Caucionada</option>
              <option value="4">4 · Vinculada</option>
              <option value="5">5 · Carnê de pagamentos</option>
              <option value="8">8 · Cobrança conta capital</option>
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-tinta">
            Espécie do documento
            <select name="codigoEspecieDocumento" defaultValue={conta.codigoEspecieDocumento ?? ""} className={`${inputBase} mt-1.5 block w-full min-w-0`}>
              <option value="">Selecione</option>
              <option value="RC">RC · Recibo</option>
              <option value="DM">DM · Duplicata mercantil</option>
              <option value="DS">DS · Duplicata de serviço</option>
              <option value="DMI">DMI · Duplicata mercantil indicação</option>
              <option value="DSI">DSI · Duplicata serviço indicação</option>
              <option value="OU">OU · Outros</option>
              <option value="CH">CH · Cheque</option>
              <option value="DR">DR · Duplicata rural</option>
              <option value="LC">LC · Letra de câmbio</option>
              <option value="NCC">NCC · Nota de crédito comercial</option>
              <option value="NCE">NCE · Nota de crédito exportação</option>
              <option value="NCI">NCI · Nota de crédito industrial</option>
              <option value="NCR">NCR · Nota de crédito rural</option>
              <option value="NP">NP · Nota promissória</option>
              <option value="NPR">NPR · Nota promissória rural</option>
              <option value="TM">TM · Triplicata mercantil</option>
              <option value="TS">TS · Triplicata de serviço</option>
              <option value="NS">NS · Nota de seguro</option>
              <option value="FAT">FAT · Fatura</option>
              <option value="ND">ND · Nota de débito</option>
              <option value="AP">AP · Apólice de seguro</option>
              <option value="ME">ME · Mensalidade escolar</option>
              <option value="PC">PC · Pagamento de consórcio</option>
              <option value="NF">NF · Nota fiscal</option>
              <option value="DD">DD · Documento de dívida</option>
              <option value="CC">CC · Cartão de crédito</option>
              <option value="BDP">BDP · Boleto proposta</option>
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-tinta">
            Contrato de cobrança (opcional)
            <input
              name="numeroContratoCobranca"
              inputMode="numeric"
              pattern="[0-9]{1,15}"
              maxLength={15}
              defaultValue={conta.numeroContratoCobranca ?? ""}
              placeholder="Conforme o convênio"
              className={`${inputBase} mt-1.5 block w-full min-w-0`}
            />
          </label>
          <label className="block text-[11px] font-semibold text-tinta">
            Ambiente
            <select name="ambiente" defaultValue={conta.ambiente} className={`${inputBase} mt-1.5 block w-full`}>
              <option value="SANDBOX">Sandbox</option>
              <option value="PRODUCAO">Produção</option>
            </select>
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <CheckboxConfiguracao
            name="ativa"
            titulo="Conta ativa"
            texto="Disponível na operação financeira."
            defaultChecked={conta.ativa}
          />
          <CheckboxConfiguracao
            name="padrao"
            titulo="Conta padrão"
            texto="Preferida para novas cobranças."
            defaultChecked={conta.padrao}
          />
          <CheckboxConfiguracao
            name="integracaoHabilitada"
            titulo="Integração API"
            texto="Autoriza comunicação pelo servidor."
            defaultChecked={conta.integracaoHabilitada}
          />
          <CheckboxConfiguracao
            name="boletosHabilitados"
            titulo="Emitir boletos"
            texto="Libera esta conta para novos títulos."
            defaultChecked={conta.boletosHabilitados}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-erro/25 bg-erro/5 p-3">
          <input
            type="checkbox"
            name="confirmarProducao"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#a32626]"
          />
          <span>
            <span className="block text-[11px] font-bold text-tinta">
              Confirmo ativação em produção
            </span>
            <span className="mt-0.5 block text-[9px] leading-snug text-tinta-suave">
              Necessário somente ao habilitar a API em produção; boletos emitidos têm efeito bancário real.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-between gap-3 border-t border-contorno pt-3">
          <span className="text-[9px] leading-snug text-tinta-suave">
            Alterações ficam registradas no usuário logado.
          </span>
          <button type="submit" className={`${btnPrimario} shrink-0`}>
            Salvar
          </button>
        </div>
      </form>
    </details>
  );
}

function LinhaChecklist({
  titulo,
  descricao,
  pronto,
  dispensado = false,
}: {
  titulo: string;
  descricao: string;
  pronto: boolean;
  dispensado?: boolean;
}) {
  const concluido = pronto || dispensado;
  return (
    <li className="flex items-start gap-3 rounded-lg border border-contorno bg-[#fbfcfc] px-3.5 py-3">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
          concluido
            ? "border-oliva/35 bg-oliva/10 text-oliva-escura"
            : "border-ambar/40 bg-ambar/10 text-[#8a6410]"
        }`}
        aria-hidden="true"
      >
        {concluido ? "✓" : "·"}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-tinta">
          {titulo}
          <Selo nivel={concluido ? "otimo" : "atencao"}>
            {dispensado ? "não exigido" : pronto ? "configurado" : "pendente"}
          </Selo>
        </span>
        <span className="mt-1 block text-[10px] leading-relaxed text-tinta-suave">
          {descricao}
        </span>
      </span>
    </li>
  );
}

export default async function PaginaContasBancarias({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const [contasConsulta, perfil] = await Promise.all([
    prisma.contaBancaria.findMany({
      include: {
        atualizadoPor: { select: { nome: true } },
        _count: { select: { boletos: true } },
      },
      orderBy: [{ padrao: "desc" }, { ativa: "desc" }, { apelido: "asc" }],
    }),
    perfilAtual(),
  ]);
  const contas = contasConsulta as ContaVisao[];
  const infraestrutura = configuracaoServidor();
  const servidorPronto = infraestrutura.api;
  const podeGerenciar = perfil === "ADMINISTRADOR";

  const ativas = contas.filter((conta) => conta.ativa).length;
  const configuradas = contas.filter(contaConfigurada).length;
  const integradas = contas.filter(
    (conta) => conta.ativa && conta.integracaoHabilitada,
  ).length;
  const comBoletos = contas.filter(
    (conta) => conta.ativa && conta.boletosHabilitados,
  ).length;
  const titulos = contas.reduce((total, conta) => total + conta._count.boletos, 0);

  return (
    <div>
      <PageHeader
        titulo="Contas bancárias"
        descricao="Centralize as contas Sicoob, escolha a conta padrão e acompanhe separadamente cadastro, conexão com a API e emissão de boletos."
        acoes={
          <>
            <Link href="/financeiro/boletos" className={btnPrimario}>
              Central de boletos
            </Link>
            <Link href="/financeiro" className={btnSecundario}>
              Voltar ao financeiro
            </Link>
          </>
        }
      />

      {sp.erro ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-erro/25 bg-erro/5 px-4 py-3 text-[13px] font-semibold text-erro"
        >
          {sp.erro}
        </div>
      ) : null}
      {sp.ok ? (
        <div
          role="status"
          className="mb-4 rounded-lg border border-oliva/25 bg-oliva/5 px-4 py-3 text-[13px] font-semibold text-oliva-escura"
        >
          {sp.ok}
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          rotulo="Contas cadastradas"
          valor={contas.length}
          detalhe={`${ativas} ativa(s)`}
          nivel={contas.length === 5 && ativas === 5 ? "otimo" : "atencao"}
          selo={contas.length === 5 && ativas === 5 ? "base completa" : "revisar"}
          ajuda="As cinco contas informadas pela operação. Uma delas deve permanecer ativa e marcada como padrão."
        />
        <Kpi
          rotulo="Dados de convênio"
          valor={`${configuradas}/${contas.length || 5}`}
          detalhe="cliente + conta do convênio + modalidade"
          nivel={configuradas === contas.length && contas.length > 0 ? "otimo" : "atencao"}
          selo={configuradas === contas.length && contas.length > 0 ? "completos" : "pendentes"}
          ajuda="Cada conta usada na API precisa do número de cliente Sicoob, da conta corrente sem dígito confirmada no convênio e do código de modalidade. Nunca inferimos esse número do cadastro legado."
        />
        <Kpi
          rotulo="Integração API"
          valor={integradas}
          detalhe={servidorPronto ? "infraestrutura disponível" : "servidor ainda incompleto"}
          nivel={integradas > 0 && servidorPronto ? "otimo" : "atencao"}
          selo={integradas > 0 && servidorPronto ? "habilitada" : "preparação"}
          ajuda="Conta habilitada é diferente de conexão validada. O status por conta mostra quando a validação com o banco terminou."
        />
        <Kpi
          rotulo="Emissão de boletos"
          valor={comBoletos}
          detalhe={`${titulos} título(s) no histórico`}
          nivel={comBoletos > 0 ? "info" : "neutro"}
          selo={comBoletos > 0 ? "liberada" : undefined}
          ajuda="Quantidade de contas autorizadas para emitir novos boletos. O histórico inclui todos os estados do título."
        />
      </div>

      <div className="mb-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <Card className="relative overflow-hidden p-5">
          <span className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full border border-oliva/10" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge cor="azul">Banco 756</Badge>
                <Badge cor="slate">Agência 3299</Badge>
                <Badge cor={infraestrutura.ambiente === "producao" ? "verde" : "azul"}>
                  {infraestrutura.ambiente === "producao" ? "Produção" : "Sandbox"}
                </Badge>
                <Selo nivel={servidorPronto ? "otimo" : "atencao"}>
                  {servidorPronto ? "servidor preparado" : "configuração pendente"}
                </Selo>
              </div>
              <h2 className="mt-3 text-xl font-bold tracking-[-0.03em] text-tinta">
                Sicoob · cobrança bancária
              </h2>
              <p className="mt-1.5 text-[12px] leading-relaxed text-tinta-suave">
                O cadastro das contas não ativa movimentação financeira sozinho. A emissão só fica operacional depois que os dados do convênio, o acesso seguro do servidor e a validação da conta forem concluídos.
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-contorno bg-[#f8faf9] px-3 py-2">
                <div className="font-mono text-lg font-bold text-tinta">{ativas}</div>
                <div className="text-[8px] font-bold uppercase tracking-[0.1em] text-tinta-suave">ativas</div>
              </div>
              <div className="rounded-lg border border-contorno bg-[#f8faf9] px-3 py-2">
                <div className="font-mono text-lg font-bold text-tinta">{integradas}</div>
                <div className="text-[8px] font-bold uppercase tracking-[0.1em] text-tinta-suave">na API</div>
              </div>
              <div className="rounded-lg border border-contorno bg-[#f8faf9] px-3 py-2">
                <div className="font-mono text-lg font-bold text-tinta">{comBoletos}</div>
                <div className="text-[8px] font-bold uppercase tracking-[0.1em] text-tinta-suave">boletos</div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-bold tracking-tight text-tinta">
                Cofre do servidor
              </h2>
              <p className="mt-0.5 text-[10px] leading-relaxed text-tinta-suave">
                Apenas presença verificada; nenhum valor é exibido ou enviado ao navegador.
              </p>
            </div>
            <Selo nivel={servidorPronto ? "otimo" : "atencao"}>
              {servidorPronto ? "pronto" : "pendente"}
            </Selo>
          </div>
          <ul className="space-y-2">
            <LinhaChecklist
              titulo="Client ID"
              descricao="Identificador da aplicação Sicoob no ambiente do servidor."
              pronto={infraestrutura.clientId}
            />
            <LinhaChecklist
              titulo={infraestrutura.mtlsExigido ? "Certificado mTLS" : "mTLS para produção"}
              descricao={infraestrutura.mtlsExigido
                ? "Obrigatório para OAuth e produção: certificado e chave, ou PFX, montados fora do Git."
                : "O token estático oficial permite testar no sandbox sem certificado; produção continua exigindo mTLS."}
              pronto={infraestrutura.certificado}
              dispensado={!infraestrutura.mtlsExigido}
            />
            <LinhaChecklist
              titulo={infraestrutura.usaTokenEstaticoSandbox ? "Token estático do sandbox" : "OAuth client credentials"}
              descricao={infraestrutura.usaTokenEstaticoSandbox
                ? "Credencial de teste do portal usada somente no ambiente sandbox."
                : "Endpoint de token e escopos da aplicação configurados para autenticação do servidor."}
              pronto={infraestrutura.usaTokenEstaticoSandbox ? infraestrutura.tokenEstatico : infraestrutura.oauth}
            />
            <LinhaChecklist
              titulo="Proteção do webhook tipo 7"
              descricao="URL pública HTTPS e segredo base64url de 43 a 128 caracteres para receber somente avisos operacionais."
              pronto={infraestrutura.webhook}
            />
          </ul>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-2 border-b border-contorno px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[15px] font-bold tracking-tight text-tinta">
              Contas da operação
            </h2>
            <p className="mt-0.5 text-[10px] leading-relaxed text-tinta-suave">
              Banco, agência e número são dados de identidade e não são editados nesta tela.
            </p>
          </div>
          {!podeGerenciar ? (
            <Selo nivel="neutro">modo consulta</Selo>
          ) : (
            <span className="text-[10px] text-tinta-suave">
              Perfil administrador · edição liberada
            </span>
          )}
        </div>

        {contas.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-base font-bold text-tinta">Nenhuma conta cadastrada</div>
            <p className="mx-auto mt-1 max-w-lg text-[12px] leading-relaxed text-tinta-suave">
              Execute o cadastro inicial das contas Sicoob antes de configurar a API de cobrança.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela min-w-[1180px]">
              <caption className="sr-only">
                Contas bancárias, situação cadastral, integração e boletos
              </caption>
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Finalidade</th>
                  <th>Cadastro</th>
                  <th>API Sicoob</th>
                  <th>Boletos</th>
                  <th>Ambiente</th>
                  <th>Última comunicação</th>
                  <th className="text-right">Títulos</th>
                  <th className="w-[330px] text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {contas.map((conta) => (
                  <tr key={conta.id} className="align-top">
                    <td>
                      <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#d7e3e1] bg-[#edf4f2] font-mono text-[10px] font-bold text-[#315f56]">
                          756
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-tinta">{conta.apelido}</span>
                          <span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] text-tinta-suave">
                            ag. <Sigilo>{conta.agencia}</Sigilo> · conta{" "}
                            <Sigilo>{conta.numero}</Sigilo>
                          </span>
                          <span className="mt-0.5 block max-w-[230px] truncate text-[9px] text-tinta-suave/80" title={conta.nomeBanco}>
                            {conta.nomeBanco}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>{finalidadeLegivel(conta.finalidade)}</td>
                    <td><StatusCadastro conta={conta} /></td>
                    <td>
                      <StatusApi conta={conta} servidorPronto={servidorPronto} />
                      {conta.mensagemIntegracao ? (
                        <span className="mt-1.5 block max-w-52 text-[9px] leading-snug text-erro">
                          {conta.mensagemIntegracao.slice(0, 160)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <StatusBoletos conta={conta} servidorPronto={servidorPronto} />
                      {conta.webhookStatus ? (
                        <span className="mt-1 block text-[9px] text-tinta-suave">
                          webhook: {conta.webhookStatus.toLowerCase().replaceAll("_", " ")}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <Badge cor={conta.ambiente === "PRODUCAO" ? "verde" : "azul"}>
                        {conta.ambiente === "PRODUCAO" ? "Produção" : "Sandbox"}
                      </Badge>
                    </td>
                    <td>
                      <span className="block whitespace-nowrap text-[11px] text-tinta">
                        {dataHora(conta.ultimaSincronizacaoEm)}
                      </span>
                      <span className="mt-1 block max-w-48 text-[9px] text-tinta-suave">
                        Atualizada {dataHora(conta.atualizadoEm)}
                        {conta.atualizadoPor ? ` por ${conta.atualizadoPor.nome}` : ""}
                      </span>
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      <Sigilo>{conta._count.boletos}</Sigilo>
                    </td>
                    <td className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        <FormularioConta conta={conta} podeGerenciar={podeGerenciar} />
                        {podeGerenciar &&
                        conta.integracaoHabilitada &&
                        infraestrutura.webhook &&
                        conta.webhookStatus !== "VALIDADO" ? (
                          <form action={registrarWebhook}>
                            <input type="hidden" name="contaBancariaId" value={conta.id} />
                            <button type="submit" className="text-[10px] font-semibold text-oliva-escura hover:underline">
                              {conta.webhookId ? "Recadastrar webhook tipo 7" : "Cadastrar webhook tipo 7"}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-contorno px-5 py-3 text-[10px] leading-relaxed text-tinta-suave">
          Conta padrão define a preferência para novas cobranças; ela não move saldo nem altera boletos já emitidos. O webhook tipo 7 apenas avisa, e somente o arquivo tipo 5 (LIQUI) confirma pagamento. Segredos e certificados permanecem exclusivamente no cofre do servidor.
        </div>
      </Card>
    </div>
  );
}
