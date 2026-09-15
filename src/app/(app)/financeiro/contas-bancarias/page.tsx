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
import {
  atualizarContaBancaria,
  atualizarPoliticaCobrancaSicoob,
} from "./actions";
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
  configuracaoCobrancaSicoob: {
    layoutLegadoId: number | null;
    nomeLayoutLegado: string | null;
    contaLiquidacaoLegadoId: number | null;
    bancoLegadoId: number | null;
    ativaLegado: boolean | null;
    padraoLegado: boolean | null;
    sistemaOrigem: string;
    capturadoEm: Date;
    agenciaRemessa: string;
    numeroContaPixLegado: string | null;
    numeroContaRemessaLegado: string | null;
    numeroContaCorrenteApi: string;
    carteiraLegada: string;
    convenioLegado: string | null;
    modalidadeCobrancaLegada: string | null;
    numeroCliente: string;
    codigoEspecieDocumento: string;
    aceite: string;
    moeda: string;
    protestoAutomaticoLegado: string | null;
    diasProtesto: number;
    ultimoNossoNumeroLegado: number | null;
    loteLegado: number | null;
    escopos: string;
    toleranciaPagamentoDias: number;
    protestoEmDiasUteis: boolean;
    correspondente: string;
    bancoNumera: boolean;
    bancoEmite: boolean | null;
    bancoDespacha: boolean | null;
    mensagens: string;
    exibirServicos: boolean;
    usoAutorizado: boolean;
    mostrarIptu: boolean;
    avisoDeposito: boolean;
    lancarTarifa: boolean;
    planoContaLegadoId: number | null;
  } | null;
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
  const usaPfx = preenchida(process.env.SICOOB_PFX_PATH);
  const senhaPfx = preenchida(process.env.SICOOB_PFX_PASSPHRASE);
  const protecaoWebhook =
    /^[A-Za-z0-9_-]{43,128}$/.test(segredoWebhook) &&
    urlHttps(process.env.APP_PUBLIC_URL);

  return {
    ambiente: estado.ambiente,
    clientId: preenchida(process.env.SICOOB_CLIENT_ID),
    tokenEstatico,
    usaTokenEstaticoSandbox,
    certificado: estado.mtlsConfigurado,
    usaPfx,
    senhaPfx,
    mtlsExigido,
    oauth,
    api: estado.configurado && (usaTokenEstaticoSandbox || oauth),
    escoposWebhook: estado.escoposWebhookConfigurados,
    protecaoWebhook,
    webhook: estado.escoposWebhookConfigurados && protecaoWebhook,
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

function mensagensParaFormulario(valor: string): string {
  try {
    const mensagens = JSON.parse(valor);
    if (!Array.isArray(mensagens)) return "";
    return mensagens
      .filter((mensagem): mensagem is string => typeof mensagem === "string")
      .slice(0, 5)
      .join("\n");
  } catch {
    return "";
  }
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
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-oliva">
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
            <span className="mt-0.5 block text-[10px] leading-snug text-tinta-suave">
              Necessário somente ao habilitar a API em produção; boletos emitidos têm efeito bancário real.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-between gap-3 border-t border-contorno pt-3">
          <span className="text-[10px] leading-snug text-tinta-suave">
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

function DadoImportado({
  rotulo,
  valor,
  sigiloso = false,
}: {
  rotulo: string;
  valor: React.ReactNode;
  sigiloso?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#dce6e4] bg-white/80 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-tinta-suave">
        {rotulo}
      </div>
      <div className="numero-card mt-1 font-mono text-[12px] font-semibold text-tinta">
        {sigiloso ? <Sigilo>{valor}</Sigilo> : valor}
      </div>
    </div>
  );
}

function PainelConfiguracaoCobranca({
  conta,
  podeGerenciar,
  usaPfx,
  senhaPfx,
}: {
  conta: ContaVisao;
  podeGerenciar: boolean;
  usaPfx: boolean;
  senhaPfx: boolean;
}) {
  const configuracao = conta.configuracaoCobrancaSicoob;
  if (!configuracao) return null;
  const escopos = configuracao.escopos.split(/\s+/).filter(Boolean);
  const sinalizadoresLegados = [
    ["Exibir serviços", configuracao.exibirServicos],
    ["Uso autorizado", configuracao.usoAutorizado],
    ["Mostrar IPTU", configuracao.mostrarIptu],
    ["Aviso de depósito", configuracao.avisoDeposito],
    ["Lançar tarifa", configuracao.lancarTarifa],
  ] as const;
  const sinalizadoresBancarios = [
    ["Banco numera", configuracao.bancoNumera ? "sim" : "não"],
    [
      "Banco emite",
      configuracao.bancoEmite === null
        ? "não informado"
        : configuracao.bancoEmite
          ? "sim"
          : "não",
    ],
    [
      "Banco despacha",
      configuracao.bancoDespacha === null
        ? "não informado"
        : configuracao.bancoDespacha
          ? "sim"
          : "não",
    ],
    ["Protesto automático", configuracao.protestoAutomaticoLegado ?? "não informado"],
  ] as const;

  return (
    <Card className="mb-5 overflow-hidden">
      <div className="relative border-b border-contorno bg-[linear-gradient(115deg,#f4f8f7_0%,#fbfcfc_55%,#f7f5ed_100%)] px-5 py-4">
        <span className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full border border-oliva/10" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge cor="verde">configuração importada</Badge>
              <Badge cor="slate">
                {configuracao.sistemaOrigem} · layout {configuracao.layoutLegadoId ?? "—"}
              </Badge>
              <Selo nivel={senhaPfx ? "otimo" : "atencao"}>
                {senhaPfx ? "senha do PFX configurada" : "falta a senha do PFX"}
              </Selo>
            </div>
            <h2 className="mt-2 text-[17px] font-bold tracking-[-0.025em] text-tinta">
              Política de cobrança · {configuracao.nomeLayoutLegado ?? conta.apelido}
            </h2>
            <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-tinta-suave">
              Parâmetros não secretos conferidos na tela original. Mudanças abaixo valem somente para novos boletos; contadores legados nunca são usados para gerar identificadores.
            </p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-tinta-suave">
              capturado em
            </div>
            <div className="mt-1 font-mono text-[11px] font-semibold text-tinta">
              {new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "short",
                timeZone: "America/Sao_Paulo",
              }).format(configuracao.capturadoEm)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <section className="border-b border-contorno bg-[#f7faf9] p-5 xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-bold text-tinta">Mapa do legado</h3>
            <span className="text-[10px] text-tinta-suave">somente leitura</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
            <DadoImportado rotulo="Agência remessa" valor={configuracao.agenciaRemessa} sigiloso />
            <DadoImportado rotulo="Conta Pix legado" valor={configuracao.numeroContaPixLegado ?? "—"} sigiloso />
            <DadoImportado rotulo="Conta remessa" valor={configuracao.numeroContaRemessaLegado ?? "—"} sigiloso />
            <DadoImportado rotulo="Conta Sicoob/API" valor={configuracao.numeroContaCorrenteApi} sigiloso />
            <DadoImportado rotulo="Código do cliente" valor={configuracao.numeroCliente} sigiloso />
            <DadoImportado rotulo="Carteira legada" valor={configuracao.carteiraLegada} />
            <DadoImportado rotulo="Espécie DOC" valor={configuracao.codigoEspecieDocumento} />
            <DadoImportado rotulo="Moeda" valor={configuracao.moeda} />
            <DadoImportado rotulo="Correspondente" valor={configuracao.correspondente} />
          </div>

          <div className="mt-3 rounded-lg border border-ambar/25 bg-ambar/5 px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-tinta">Modalidade da API</span>
              <Selo nivel="atencao">confirmar no convênio</Selo>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-tinta-suave">
              O legado tinha carteira 1, mas deixou “Modalidade cobrança” vazia. Para segurança, o Brisa não transformou um campo no outro automaticamente.
            </p>
          </div>

          <details className="mt-3 rounded-lg border border-contorno bg-white/70 px-3.5 py-3">
            <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.1em] text-tinta">
              Rastreabilidade completa do layout
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] text-tinta-suave">
              <span>Conta liquidação ID: <strong className="text-tinta">{configuracao.contaLiquidacaoLegadoId ?? "—"}</strong></span>
              <span>Banco ID: <strong className="text-tinta">{configuracao.bancoLegadoId ?? "—"}</strong></span>
              <span>Ativa: <strong className="text-tinta">{configuracao.ativaLegado === null ? "não informado" : configuracao.ativaLegado ? "sim" : "não"}</strong></span>
              <span>Padrão: <strong className="text-tinta">{configuracao.padraoLegado === null ? "não informado" : configuracao.padraoLegado ? "sim" : "não"}</strong></span>
              <span>Convênio: <strong className="text-tinta">{configuracao.convenioLegado ?? "não informado"}</strong></span>
              {sinalizadoresBancarios.map(([rotulo, valor]) => (
                <span key={rotulo}>{rotulo}: <strong className="text-tinta">{valor}</strong></span>
              ))}
            </div>
          </details>

          <div className="mt-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-tinta-suave">
              Escopos encontrados
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {escopos.map((escopo) => (
                <Badge key={escopo} cor="slate">{escopo}</Badge>
              ))}
            </div>
          </div>

          <div className="mt-4 border-t border-contorno pt-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-tinta-suave">
              Sinalizadores de impressão do legado
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
              {sinalizadoresLegados.map(([rotulo, ativo]) => (
                <span key={rotulo} className="inline-flex items-center gap-1.5 text-[10px] text-tinta-suave">
                  <span className={`h-1.5 w-1.5 rounded-full ${ativo ? "bg-oliva" : "bg-[#aab3b5]"}`} />
                  {rotulo}: <strong className="text-tinta">{ativo ? "sim" : "não"}</strong>
                </span>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-tinta-suave">
              Preservados para auditoria. Não produzem efeito na API nem lançamentos financeiros do Brisa.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-contorno pt-3 text-center">
            <div>
              <div className="numero-card font-mono text-[12px] font-bold text-tinta">
                <Sigilo>{configuracao.ultimoNossoNumeroLegado ?? "—"}</Sigilo>
              </div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-tinta-suave">último nº</div>
            </div>
            <div>
              <div className="numero-card font-mono text-[12px] font-bold text-tinta">{configuracao.loteLegado ?? "—"}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-tinta-suave">lote antigo</div>
            </div>
            <div>
              <div className="numero-card font-mono text-[12px] font-bold text-tinta">{configuracao.planoContaLegadoId ?? "—"}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-tinta-suave">plano tarifa</div>
            </div>
          </div>
        </section>

        <form action={atualizarPoliticaCobrancaSicoob} className="p-5">
          <input type="hidden" name="contaBancariaId" value={conta.id} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-[12px] font-bold text-tinta">Regras para novos boletos</h3>
              <p className="mt-0.5 text-[10px] leading-relaxed text-tinta-suave">
                Valores atuais importados do Widesys e validados novamente no servidor ao salvar.
              </p>
            </div>
            {!podeGerenciar ? <Selo nivel="neutro">modo consulta</Selo> : null}
          </div>

          <fieldset disabled={!podeGerenciar} className="mt-4 space-y-4 disabled:opacity-70">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-[10px] font-semibold text-tinta">
                Aceite
                <select name="aceite" defaultValue={configuracao.aceite} className={`${inputBase} mt-1.5 block w-full`}>
                  <option value="N">Não</option>
                  <option value="S">Sim</option>
                </select>
              </label>
              <label className="block text-[10px] font-semibold text-tinta">
                Tolerância após vencimento
                <div className="relative mt-1.5">
                  <input
                    name="toleranciaPagamentoDias"
                    type="number"
                    min={0}
                    max={180}
                    required
                    defaultValue={configuracao.toleranciaPagamentoDias}
                    className={`${inputBase} block w-full pr-12`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-tinta-suave">dias</span>
                </div>
              </label>
              <label className="block text-[10px] font-semibold text-tinta">
                Enviar a protesto após
                <div className="relative mt-1.5">
                  <input
                    name="diasProtesto"
                    type="number"
                    min={0}
                    max={99}
                    required
                    defaultValue={configuracao.diasProtesto}
                    className={`${inputBase} block w-full pr-12`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-tinta-suave">dias</span>
                </div>
              </label>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-contorno bg-[#f8faf9] p-3">
              <input
                type="checkbox"
                name="protestoEmDiasUteis"
                defaultChecked={configuracao.protestoEmDiasUteis}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#315f56]"
              />
              <span>
                <span className="block text-[10px] font-bold text-tinta">Contar protesto em dias úteis</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-tinta-suave">
                  Com prazo zero, a API recebe “não protestar” independentemente desta opção.
                </span>
              </span>
            </label>

            <label className="block text-[10px] font-semibold text-tinta">
              Instruções impressas no boleto
              <textarea
                name="mensagensCobranca"
                rows={3}
                maxLength={1_000}
                defaultValue={mensagensParaFormulario(configuracao.mensagens)}
                placeholder="Uma instrução por linha · até 5 linhas de 40 caracteres"
                className={`${inputBase} mt-1.5 block w-full resize-y leading-relaxed`}
              />
            </label>

            <div className="rounded-lg border border-[#cfdedb] bg-[#f2f7f6] px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-bold text-tinta">Senha do certificado PFX</div>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-tinta-suave">
                    Único segredo que ficou para preenchimento manual no cofre do servidor.
                  </p>
                </div>
                <Selo nivel={senhaPfx ? "otimo" : "atencao"}>
                  {senhaPfx ? "preenchida" : "pendente"}
                </Selo>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-contorno bg-white px-3 py-2 font-mono text-[10px] text-tinta-suave">
                <span>SICOOB_PFX_PASSPHRASE</span>
                <span aria-hidden="true">=</span>
                <span>{senhaPfx ? "••••••••••••" : "digite no .env privado do servidor"}</span>
                <span className="ml-auto text-[10px] font-sans font-semibold uppercase tracking-[0.1em] text-tinta-suave">
                  PFX {usaPfx ? "referenciado" : "não referenciado"}
                </span>
              </div>
            </div>

            {podeGerenciar ? (
              <div className="flex items-center justify-between gap-3 border-t border-contorno pt-3">
                <span className="text-[10px] leading-relaxed text-tinta-suave">
                  Não altera títulos já emitidos nem ativa a integração.
                </span>
                <button type="submit" className={`${btnPrimario} shrink-0`}>
                  Salvar política
                </button>
              </div>
            ) : null}
          </fieldset>
        </form>
      </div>
    </Card>
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
        configuracaoCobrancaSicoob: true,
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
  const contaComLayout = contas.find(
    (conta) => conta.configuracaoCobrancaSicoob !== null,
  );

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

      <div className="mb-5 grid items-start gap-4 xl:grid-cols-2">
        <Card className="relative overflow-hidden p-5">
          <span className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full border border-oliva/10" />
          <div className="relative flex flex-col gap-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
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
            <div className="grid w-full shrink-0 grid-cols-3 gap-2 text-center 2xl:w-auto">
              <div className="rounded-lg border border-contorno bg-[#f8faf9] px-3 py-2">
                <div className="numero-card numero-card--compacto font-mono font-bold text-tinta">{ativas}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-tinta-suave">ativas</div>
              </div>
              <div className="rounded-lg border border-contorno bg-[#f8faf9] px-3 py-2">
                <div className="numero-card numero-card--compacto font-mono font-bold text-tinta">{integradas}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-tinta-suave">na API</div>
              </div>
              <div className="rounded-lg border border-contorno bg-[#f8faf9] px-3 py-2">
                <div className="numero-card numero-card--compacto font-mono font-bold text-tinta">{comBoletos}</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-tinta-suave">boletos</div>
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
          <ul className="grid gap-2 sm:grid-cols-2">
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
              titulo="Webhook tipo 7 · opcional"
              descricao={infraestrutura.escoposWebhook
                ? "Os três escopos webhooks_* foram informados. URL pública HTTPS e segredo forte ainda protegem os avisos operacionais."
                : "Não exigido para emitir ou confirmar pagamentos. Só é liberado quando inclusão, consulta e alteração de webhooks constam explicitamente em SICOOB_SCOPES; o LIQUI continua sendo a confirmação financeira."}
              pronto={infraestrutura.webhook}
              dispensado={!infraestrutura.escoposWebhook}
            />
          </ul>
        </Card>
      </div>

      {contaComLayout ? (
        <PainelConfiguracaoCobranca
          conta={contaComLayout}
          podeGerenciar={podeGerenciar}
          usaPfx={infraestrutura.usaPfx}
          senhaPfx={infraestrutura.senhaPfx}
        />
      ) : null}

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
                          <span className="mt-0.5 block max-w-[230px] truncate text-[10px] text-tinta-suave/80" title={conta.nomeBanco}>
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
                        <span className="mt-1.5 block max-w-52 text-[10px] leading-snug text-erro">
                          {conta.mensagemIntegracao.slice(0, 160)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <StatusBoletos conta={conta} servidorPronto={servidorPronto} />
                      {conta.webhookStatus ? (
                        <span className="mt-1 block text-[10px] text-tinta-suave">
                          webhook: {infraestrutura.webhook
                            ? conta.webhookStatus.toLowerCase().replaceAll("_", " ")
                            : "opcional · infraestrutura incompleta"}
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
                      <span className="mt-1 block max-w-48 text-[10px] text-tinta-suave">
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
