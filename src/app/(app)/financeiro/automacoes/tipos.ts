import type { ConfigCobranca } from "@/lib/comunicacoes/dominio";

export type EstadoAcao = { ok?: string; erro?: string; versao?: number };

export interface TituloComunicacao {
  chave: string;
  nome: string;
  documento: string;
  vencimento: string;
  aberto: number;
  email?: string | null;
  telefone?: string | null;
  pessoaChave: string;
}

export interface ContatoComunicacao {
  id: string;
  pessoaChave: string;
  canal: string;
  destino: string;
  autorizado: boolean;
  evidencia: string;
}

export interface MensagemComunicacao {
  id: string;
  tituloChave: string;
  canal: string;
  destino: string;
  status: string;
  criadoEm: string;
  enviadoEm: string | null;
  erroCodigo: string | null;
  etapa: string;
  conteudo: string;
}

export interface PainelAutomacoes {
  config: ConfigCobranca;
  versao: number;
  segredos: { email: boolean; whatsapp: boolean; chave: boolean; envio: boolean };
  titulos: TituloComunicacao[];
  contatos: ContatoComunicacao[];
  mensagens: MensagemComunicacao[];
  eventos: { id: string; tipo: string; codigo: string | null; criadoEm: string }[];
}
