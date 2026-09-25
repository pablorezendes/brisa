/** Regras puras, compartilháveis com a prévia. Nunca recebe dados de comissão. */
export type ConfigCobranca = {
  empresa: string;
  emailAtivo: boolean;
  whatsappAtivo: boolean;
  emailRemetente: string;
  emailResposta: string;
  emailAssunto: string;
  emailCorpo: string;
  whatsappNumero: string;
  whatsappPhoneNumberId: string;
  whatsappTemplate: string;
  /** Declaração do administrador, não substitui a aprovação concedida pela Meta. */
  whatsappTemplateAprovado: boolean;
  whatsappIdioma: "pt_BR";
  /** Espelho do corpo APROVADO na Meta; não é texto livre enviado pela API. */
  whatsappCorpo: string;
  automacaoAtiva: boolean;
  /** Dias em relação ao vencimento; negativo = antes. */
  diasRelativos: number[];
  horaInicio: number;
  horaFim: number;
  apenasDiasUteis: boolean;
  limiteDiario: number;
};

export const VARIAVEIS_COBRANCA = ["nome", "documento", "vencimento", "valor", "empresa"] as const;

export const CONFIG_COBRANCA_PADRAO: ConfigCobranca = {
  empresa: "Brisa",
  emailAtivo: false,
  whatsappAtivo: false,
  emailRemetente: "",
  emailResposta: "",
  emailAssunto: "Lembrete de pagamento · {documento}",
  emailCorpo: "Olá, {nome}!\n\nO documento {documento}, com vencimento em {vencimento}, tem saldo de {valor}.\n\nSe já realizou o pagamento, responda a esta mensagem para conferência. Para dúvidas ou negociação, fale com nossa equipe.\n\n{empresa}",
  whatsappNumero: "",
  whatsappPhoneNumberId: "",
  whatsappTemplate: "",
  whatsappTemplateAprovado: false,
  whatsappIdioma: "pt_BR",
  whatsappCorpo: "Olá, {nome}! O documento {documento}, com vencimento em {vencimento}, tem saldo de {valor}. Se já pagou, fale com nossa equipe para conferência. {empresa}. Para não receber lembretes por WhatsApp, responda SAIR.",
  automacaoAtiva: false,
  diasRelativos: [-3, 0, 3, 7],
  horaInicio: 9,
  horaFim: 18,
  apenasDiasUteis: true,
  limiteDiario: 50,
};

export type DadosMensagemCobranca = {
  nome: string;
  /** Referência do título, nunca CPF/CNPJ. */
  documento: string;
  vencimento: string;
  valorCentavos: number;
  empresa: string;
};

function texto(valor: unknown, campo: string, max: number, vazio = false): string {
  if (typeof valor !== "string" || valor.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(valor)) {
    throw new Error(`${campo}: texto inválido ou acima do limite de ${max} caracteres.`);
  }
  const limpo = valor.trim();
  if (!vazio && !limpo) throw new Error(`${campo}: preenchimento obrigatório.`);
  return limpo;
}

export function normalizarEmail(valor: string): string {
  const email = texto(valor, "E-mail", 254).toLowerCase();
  const partes = email.split("@");
  if (partes.length !== 2) throw new Error("Informe um único e-mail válido.");
  const [local, dominio] = partes;
  const labels = dominio.split(".");
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..") || labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/^[a-z]{2,63}$/.test(labels.at(-1)!)) {
    throw new Error("Informe um único e-mail válido, sem nome, lista ou cabeçalhos.");
  }
  return email;
}

const DDDS = new Set("11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(" "));

/** Retorna E.164 brasileiro sem '+', como exigido pela Cloud API. */
export function normalizarTelefoneBR(valor: string): string {
  const entrada = texto(valor, "Telefone", 32);
  if (!/^\+?[\d()\s.-]+$/.test(entrada)) throw new Error("Informe um telefone brasileiro com DDD, sem ramal ou lista.");
  let numero = entrada.replace(/\D/g, "");
  if ((numero.length === 12 || numero.length === 13) && numero.startsWith("55")) numero = numero.slice(2);
  else if (entrada.startsWith("+")) throw new Error("O telefone deve ter o código do Brasil +55.");
  if (!DDDS.has(numero.slice(0, 2)) || !/^(?:\d{2}[2-5]\d{7}|\d{2}9\d{8})$/.test(numero)) {
    throw new Error("Informe telefone brasileiro válido com DDD e 8 ou 9 dígitos.");
  }
  return `55${numero}`;
}

export function validarDataCobranca(data: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Vencimento inválido; use AAAA-MM-DD.");
  const instante = new Date(`${data}T12:00:00Z`);
  if (!Number.isFinite(instante.getTime()) || instante.toISOString().slice(0, 10) !== data || Number(data.slice(0, 4)) < 1900 || Number(data.slice(0, 4)) > 2199) {
    throw new Error("Vencimento inválido.");
  }
  return data;
}

export function validarTemplateCobranca(template: string, max = 4000): string {
  const modelo = texto(template, "Mensagem", max);
  const semVariaveis = modelo.replace(/\{(nome|documento|vencimento|valor|empresa)\}/g, "");
  if (/[{}]/.test(semVariaveis)) throw new Error("Use apenas {nome}, {documento}, {vencimento}, {valor} e {empresa}.");
  return modelo;
}

export function validarTemplateWhatsApp(template: string): string {
  const modelo = validarTemplateCobranca(template, 1024);
  const variaveis = [...modelo.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (variaveis.join(",") !== VARIAVEIS_COBRANCA.join(",")) throw new Error("O modelo WhatsApp precisa das cinco variáveis uma vez, na ordem: nome, documento, vencimento, valor, empresa.");
  return modelo;
}

export function validarConfigCobranca(valor: unknown): ConfigCobranca {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new Error("Configuração inválida.");
  const entrada = valor as Record<string, unknown>;
  const base = { ...CONFIG_COBRANCA_PADRAO, ...entrada };
  for (const campo of ["emailAtivo", "whatsappAtivo", "automacaoAtiva", "apenasDiasUteis", "whatsappTemplateAprovado"] as const) {
    if (typeof base[campo] !== "boolean") throw new Error(`${campo}: escolha inválida.`);
  }
  for (const campo of ["horaInicio", "horaFim", "limiteDiario"] as const) {
    if (!Number.isSafeInteger(base[campo])) throw new Error(`${campo}: informe um inteiro.`);
  }
  if (base.horaInicio < 8 || base.horaFim > 20 || base.horaFim <= base.horaInicio) throw new Error("Defina a janela entre 08h e 20h, com início anterior ao fim (São Paulo).");
  if (base.limiteDiario < 1 || base.limiteDiario > 500) throw new Error("O limite diário deve ficar entre 1 e 500 mensagens.");
  if (!Array.isArray(base.diasRelativos) || base.diasRelativos.length < 1 || base.diasRelativos.length > 12 || base.diasRelativos.some((n) => !Number.isSafeInteger(n) || n < -30 || n > 90)) throw new Error("Informe de 1 a 12 etapas, entre 30 dias antes e 90 dias após o vencimento.");
  if (base.whatsappIdioma !== "pt_BR") throw new Error("O idioma do modelo deve ser pt_BR.");
  const config: ConfigCobranca = {
    empresa: texto(base.empresa, "Empresa", 120),
    emailAtivo: base.emailAtivo,
    whatsappAtivo: base.whatsappAtivo,
    emailRemetente: texto(base.emailRemetente, "Remetente", 254, true),
    emailResposta: texto(base.emailResposta, "Resposta", 254, true),
    emailAssunto: validarTemplateCobranca(base.emailAssunto, 180),
    emailCorpo: validarTemplateCobranca(base.emailCorpo),
    whatsappNumero: texto(base.whatsappNumero, "Número WhatsApp", 32, true),
    whatsappPhoneNumberId: texto(base.whatsappPhoneNumberId, "Phone Number ID", 30, true),
    whatsappTemplate: texto(base.whatsappTemplate, "Modelo Meta", 512, true),
    whatsappTemplateAprovado: base.whatsappTemplateAprovado,
    whatsappIdioma: "pt_BR",
    whatsappCorpo: validarTemplateWhatsApp(base.whatsappCorpo),
    automacaoAtiva: base.automacaoAtiva,
    diasRelativos: [...new Set(base.diasRelativos)].sort((a, b) => a - b),
    horaInicio: base.horaInicio,
    horaFim: base.horaFim,
    apenasDiasUteis: base.apenasDiasUteis,
    limiteDiario: base.limiteDiario,
  };
  if (/[\r\n]/.test(config.emailAssunto)) throw new Error("O assunto não aceita quebras de linha.");
  if (config.emailRemetente) config.emailRemetente = normalizarEmail(config.emailRemetente);
  if (config.emailResposta) config.emailResposta = normalizarEmail(config.emailResposta);
  if (config.whatsappNumero) config.whatsappNumero = normalizarTelefoneBR(config.whatsappNumero);
  if (config.whatsappPhoneNumberId && !/^\d{5,30}$/.test(config.whatsappPhoneNumberId)) throw new Error("Phone Number ID inválido.");
  if (config.whatsappTemplate && !/^[a-z0-9_]{1,512}$/.test(config.whatsappTemplate)) throw new Error("Nome de modelo Meta inválido.");
  if (config.emailAtivo && !config.emailRemetente) throw new Error("Cadastre o remetente antes de habilitar e-mail.");
  if (config.whatsappAtivo && (!config.whatsappNumero || !config.whatsappPhoneNumberId || !config.whatsappTemplate)) throw new Error("Cadastre número, Phone Number ID e modelo aprovado antes de habilitar WhatsApp.");
  if (config.whatsappAtivo && !config.whatsappTemplateAprovado) throw new Error("Confirme que o modelo e o corpo estão aprovados na Meta antes de habilitar WhatsApp.");
  if (config.automacaoAtiva && !config.emailAtivo && !config.whatsappAtivo) throw new Error("Habilite ao menos um canal antes da automação.");
  return config;
}

export function valoresMensagem(dados: DadosMensagemCobranca): Record<(typeof VARIAVEIS_COBRANCA)[number], string> {
  if (!Number.isSafeInteger(dados.valorCentavos) || dados.valorCentavos <= 0) throw new Error("O saldo da cobrança deve ser positivo em centavos.");
  const vencimento = validarDataCobranca(dados.vencimento);
  return {
    nome: texto(dados.nome, "Nome", 180).replace(/[\r\n\t]/g, " "),
    documento: texto(dados.documento, "Documento", 120).replace(/[\r\n\t]/g, " "),
    vencimento: `${vencimento.slice(8, 10)}/${vencimento.slice(5, 7)}/${vencimento.slice(0, 4)}`,
    valor: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(dados.valorCentavos / 100),
    empresa: texto(dados.empresa, "Empresa", 120).replace(/[\r\n\t]/g, " "),
  };
}

export function renderizarMensagem(template: string, dados: DadosMensagemCobranca): string {
  const modelo = validarTemplateCobranca(template);
  const valores = valoresMensagem(dados);
  // Replace de passagem única: placeholders contidos no nome/documento nunca viram código.
  return modelo.replace(/\{(nome|documento|vencimento|valor|empresa)\}/g, (_, chave: keyof typeof valores) => valores[chave]);
}

export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderizarEmail(assunto: string, corpo: string, dados: DadosMensagemCobranca): { assunto: string; texto: string; html: string } {
  const titulo = renderizarMensagem(validarTemplateCobranca(assunto, 180), dados);
  if (/[\r\n]/.test(titulo) || titulo.length > 400) throw new Error("Assunto final inválido.");
  const mensagem = renderizarMensagem(corpo, dados);
  return { assunto: titulo, texto: mensagem, html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#193139">${escaparHtml(mensagem).replace(/\r?\n/g, "<br>")}</div>` };
}

export function dataLocalCobranca(agora: Date): string {
  if (!Number.isFinite(agora.getTime())) throw new Error("Data de processamento inválida.");
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const p = Object.fromEntries(partes.map((v) => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function diasDesdeVencimento(vencimento: string, agora: Date): number {
  return Math.round((Date.parse(`${dataLocalCobranca(agora)}T12:00:00Z`) - Date.parse(`${validarDataCobranca(vencimento)}T12:00:00Z`)) / 86_400_000);
}

export function dentroJanelaEnvio(config: Pick<ConfigCobranca, "horaInicio" | "horaFim" | "apenasDiasUteis">, agora: Date): boolean {
  const dia = new Date(`${dataLocalCobranca(agora)}T12:00:00Z`).getUTCDay();
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(agora));
  return (!config.apenasDiasUteis || (dia !== 0 && dia !== 6)) && hora >= config.horaInicio && hora < config.horaFim;
}
