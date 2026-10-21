import "server-only";
import Link from "next/link";
import { Badge, Card, Selo, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { filtroGovernanca } from "@/lib/governanca/filtros";
import { prisma } from "@/lib/db";
import { obterEstadoConfiguracaoSicoob } from "@/lib/integracoes/sicoob";
import { atualizarContaBancaria, atualizarPoliticaCobrancaSicoob } from "@/app/(app)/financeiro/contas-bancarias/actions";
import { registrarWebhook } from "@/app/(app)/financeiro/boletos/actions";

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

function FormularioConvenio({
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
    <details className="group">
      <summary
        className={`${btnSecundario} min-h-8 cursor-pointer list-none justify-center px-2.5 py-1 text-[11px] [&::-webkit-details-marker]:hidden`}
      >
        Editar convênio e ativação
        <span className="transition-transform group-open:rotate-180" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <form
        action={atualizarContaBancaria}
        className="mt-3 space-y-3 rounded-xl border border-contorno bg-[#fbfcfc] p-4 text-left shadow-[0_12px_30px_rgba(16,35,38,0.08)]"
      >
        <input type="hidden" name="id" value={conta.id} />
        <input type="hidden" name="retorno" value="/integracoes/sicoob" />
        <input type="hidden" name="apelido" value={conta.apelido} />
        <input type="hidden" name="finalidade" value={conta.finalidade ?? "OUTRA"} />
        <input type="hidden" name="padrao" value={conta.padrao ? "on" : ""} />
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-oliva">
            Configuração operacional
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-tinta-suave">
            Aqui não são solicitados token, client secret, senha ou certificado.
          </p>
        </div>

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
          <input type="hidden" name="ativa" value={conta.ativa ? "on" : ""} />
          <p className="rounded-lg border border-linha p-3 text-xs text-tinta-suave">Conta {conta.ativa ? "ativa" : "inativa"}. A situação cadastral é preservada neste formulário; ações de exclusão ficam em Contas bancárias.</p>
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
}: {
  conta: ContaVisao;
  podeGerenciar: boolean;
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
              Carteira e modalidade são campos diferentes. A modalidade encontrada no legado foi {configuracao.modalidadeCobrancaLegada || "não informada"}; confira o valor da API no convênio do banco antes de ativar.
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
          <input type="hidden" name="retorno" value="/integracoes/sicoob" />
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

            <p className="rounded-lg border border-contorno bg-[#f8faf9] p-3 text-[11px] leading-relaxed text-tinta-suave">
              O layout contém somente parâmetros de cobrança. Certificado, Client ID e demais
              requisitos de autenticação precisam ser instalados e validados no servidor;
              ter os dados do Widesys não comprova conexão com o banco.
            </p>

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


/** Configuração administrativa da cobrança; nunca efetua chamadas ao banco ao renderizar. */
export async function SicoobContas() {
  await exigirPermissaoAcesso("contas.editar", { global: true });
  await exigirPermissaoAcesso("integracoes.gerenciar", { global: true });
  await exigirPermissaoAcesso("boletos.configurar", { global: true });
  await exigirPermissaoFinanceira("GERENCIAR_CONTAS");
  const contas: ContaVisao[] = await prisma.contaBancaria.findMany({
    where: { AND: [await filtroGovernanca(prisma, "CONTA"), { codigoBanco: "756" }] },
    include: {
      atualizadoPor: { select: { nome: true } },
      _count: { select: { boletos: true } },
      configuracaoCobrancaSicoob: true,
    },
    orderBy: [{ padrao: "desc" }, { ativa: "desc" }, { apelido: "asc" }],
  });
  const infraestrutura = configuracaoServidor();

  return (
    <section className="space-y-4" aria-labelledby="titulo-contas-sicoob">
      <div>
        <h2 id="titulo-contas-sicoob" className="text-lg font-bold text-tinta">Convênio e regras por conta</h2>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-tinta-suave">
          Confira os dados importados, confirme o convênio e só então autorize a ativação.
          Este servidor opera um único perfil de credencial Sicoob por vez; as demais contas continuam disponíveis no cadastro financeiro.
        </p>
      </div>
      {contas.length === 0 ? (
        <Card className="p-5">
          <p className="font-semibold text-tinta">Nenhuma conta Sicoob disponível.</p>
          <Link href="/financeiro/contas-bancarias" className={btnSecundario}>Ver contas bancárias</Link>
        </Card>
      ) : contas.map((conta) => (
        <article key={conta.id} id={`conta-${conta.id}`} className="scroll-mt-24 overflow-hidden rounded-xl border border-contorno bg-white">
          <header className="flex flex-col gap-4 border-b border-contorno p-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-tinta">{conta.apelido}</h3>
                {conta.padrao ? <Selo nivel="info">conta padrão</Selo> : null}
                {!conta.ativa ? <Selo nivel="neutro">inativa</Selo> : null}
              </div>
              <p className="mt-1 text-[12px] text-tinta-suave">
                Banco {conta.codigoBanco} · Agência <Sigilo>{conta.agencia}</Sigilo> · Conta <Sigilo>{conta.numero}</Sigilo>
              </p>
              <p className="mt-1 text-[11px] text-tinta-suave">
                Última sincronização: {dataHora(conta.ultimaSincronizacaoEm)} · Ambiente {conta.ambiente === "PRODUCAO" ? "produção" : "sandbox"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-tinta-suave">
              <span className="flex items-center gap-1.5">API <StatusApi conta={conta} servidorPronto={infraestrutura.api} /></span>
              <span className="flex items-center gap-1.5">Boletos <StatusBoletos conta={conta} servidorPronto={infraestrutura.api} /></span>
            </div>
          </header>
          <div className="space-y-4 p-4 sm:p-5">
            <FormularioConvenio conta={conta} podeGerenciar />
            {conta.configuracaoCobrancaSicoob ? (
              <details className="group rounded-lg border border-contorno">
                <summary className="cursor-pointer p-4 text-[13px] font-semibold text-tinta">
                  Conferir parâmetros do Widesys e regras dos novos boletos
                </summary>
                <div className="px-3 pb-1 sm:px-4">
                  <PainelConfiguracaoCobranca conta={conta} podeGerenciar />
                </div>
              </details>
            ) : (
              <p className="rounded-lg bg-[#f7faf9] p-3 text-[12px] text-tinta-suave">
                Esta conta não possui layout Widesys vinculado. Não copie o convênio de outra conta sem confirmação do banco.
              </p>
            )}
            <div className="flex flex-col gap-3 rounded-lg border border-contorno bg-[#f7faf9] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h4 className="text-[12px] font-bold text-tinta">Aviso de pagamento e confirmação financeira</h4>
                <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-tinta-suave">
                  O webhook tipo 7 é opcional e apenas avisa. A confirmação do pagamento vem do retorno LIQUI (tipo 5), conferido por título, conta, data e valor.
                </p>
                <p className="mt-1 text-[11px] text-tinta-suave">
                  Webhook: {conta.webhookStatus === "VALIDADO" ? "validado" : conta.webhookId ? "cadastrado; aguarda validação" : "não cadastrado"}.
                  {!infraestrutura.webhook ? " A instalação de URL pública, segredo e escopos do webhook ainda precisa ser conferida." : ""}
                </p>
              </div>
              {conta.integracaoHabilitada && infraestrutura.webhook && conta.webhookStatus !== "VALIDADO" ? (
                <form action={registrarWebhook} className="shrink-0">
                  <input type="hidden" name="contaBancariaId" value={conta.id} />
                  <input type="hidden" name="retorno" value="/integracoes/sicoob" />
                  <button type="submit" className={btnSecundario}>{conta.webhookId ? "Recadastrar aviso no banco" : "Cadastrar aviso no banco"}</button>
                </form>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
