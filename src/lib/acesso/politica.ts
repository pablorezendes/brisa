/** Política pura compartilhada pela navegação e pelas guardas do servidor. */
export const PERMISSOES_ACESSO = {
  "carteira.ver": "Consultar carteira autorizada",
  "painel.ver": "Consultar visão geral e executivo",
  "cadastros.ver": "Consultar cadastros",
  "cadastros.sensiveis": "Consultar documentos e contatos pessoais",
  "cadastros.editar": "Criar e editar cadastros",
  "contratos.ver": "Consultar contratos",
  "contratos.editar": "Criar, editar e encerrar contratos",
  "financeiro.ver": "Consultar financeiro e cobranças",
  "recebimentos.editar": "Registrar e ajustar recebimentos",
  "caixa.ver": "Consultar caixa global",
  "caixa.editar": "Alterar movimentações de caixa",
  "temporada.ver": "Consultar temporada",
  "temporada.editar": "Alterar operação de temporada",
  "boletos.ver": "Consultar boletos",
  "boletos.emitir": "Emitir boletos",
  "boletos.sincronizar": "Consultar retorno bancário",
  "boletos.configurar": "Configurar integração bancária",
  "contas.ver": "Consultar contas bancárias",
  "contas.editar": "Configurar e inativar contas bancárias",
  "pagamentos.conciliar": "Conciliar pagamentos",
  "relatorios.ver": "Consultar relatórios",
  "relatorios.exportar": "Exportar dados autorizados",
  "comissoes.ver": "Consultar comissões (somente administrador)",
  "fiscal.ver": "Consultar notas fiscais",
  "fiscal.editar": "Configurar e operar notas fiscais",
  "comunicacoes.ver": "Consultar comunicações",
  "comunicacoes.editar": "Configurar e operar comunicações",
  "unificacao.ver": "Consultar reconciliação global",
  "unificacao.editar": "Resolver correspondências globais",
  "governanca.editar": "Excluir logicamente, mesclar, descartar e restaurar",
  "importacoes.ver": "Auditar importações globais",
  "acessos.gerenciar": "Administrar usuários, funções e abrangências",
} as const;
export type PermissaoAcesso = keyof typeof PERMISSOES_ACESSO;
export const PERFIS_ACESSO = ["ADMINISTRADOR", "SOCIO", "CONTABILIDADE", "FINANCEIRO", "OPERADOR", "CONSULTA"] as const;
export const TIPOS_ESCOPO = ["EMPREENDIMENTO", "UNIDADE", "LOCATARIO", "PESSOA", "IMOVEL_LEGADO"] as const;
export type TipoEscopo = typeof TIPOS_ESCOPO[number];
export type Regra = { tipo: string; recursoId: string; efeito: string };
export type DadosPolitica = {
  id: string; perfil: string; ativo: boolean; acessoGlobal: boolean;
  permissoesExtras: string; permissoesNegadas: string;
  papelAcesso?: { ativo: boolean; permissoes: string } | null;
  regrasAcesso: Regra[];
};
export type PoliticaAcesso = { usuarioId: string; perfil: string; ativo: boolean; global: boolean; permissoes: PermissaoAcesso[]; regras: Regra[] };
const leitura: PermissaoAcesso[] = ["carteira.ver", "cadastros.ver", "contratos.ver", "financeiro.ver", "relatorios.ver"];
const BASE: Record<string, PermissaoAcesso[]> = {
  SOCIO: [...leitura, "painel.ver"], CONTABILIDADE: [...leitura, "relatorios.exportar"],
  FINANCEIRO: [...leitura, "painel.ver", "boletos.ver", "contas.ver", "caixa.ver", "temporada.ver"],
  OPERADOR: ["carteira.ver", "cadastros.ver", "contratos.ver", "financeiro.ver", "boletos.ver"],
  CONSULTA: ["carteira.ver", "cadastros.ver", "contratos.ver"],
};
export function lerPermissoes(json: string): PermissaoAcesso[] {
  try { const xs: unknown = JSON.parse(json); return Array.isArray(xs) ? [...new Set(xs.filter((x): x is PermissaoAcesso => typeof x === "string" && Object.hasOwn(PERMISSOES_ACESSO, x)))] : []; } catch { return []; }
}
export function montarPolitica(u: DadosPolitica): PoliticaAcesso {
  const negada: PoliticaAcesso = { usuarioId: u.id, perfil: u.perfil, ativo: false, global: false, permissoes: [], regras: [] };
  if (!u.ativo || !(PERFIS_ACESSO as readonly string[]).includes(u.perfil)) return negada;
  // O administrador é o responsável global; nunca perde o acesso às comissões.
  if (u.perfil === "ADMINISTRADOR") return { usuarioId: u.id, perfil: u.perfil, ativo: true, global: true, permissoes: Object.keys(PERMISSOES_ACESSO) as PermissaoAcesso[], regras: [] };
  const permissoesValidas = (valor: string) => { try { const xs = JSON.parse(valor); return Array.isArray(xs) && xs.every(x => typeof x === "string" && Object.hasOwn(PERMISSOES_ACESSO, x)); } catch { return false; } };
  if (![u.permissoesExtras, u.permissoesNegadas, u.papelAcesso?.permissoes ?? "[]"].every(permissoesValidas) || u.regrasAcesso.some(r => !(TIPOS_ESCOPO as readonly string[]).includes(r.tipo) || !["PERMITIR", "BLOQUEAR"].includes(r.efeito) || typeof r.recursoId !== "string" || !r.recursoId.trim())) return negada;
  const base = u.papelAcesso ? u.papelAcesso.ativo ? lerPermissoes(u.papelAcesso.permissoes) : [] : BASE[u.perfil] ?? [];
  const negadas = new Set(lerPermissoes(u.permissoesNegadas));
  const somenteLeitura = ["SOCIO", "CONTABILIDADE", "CONSULTA"].includes(u.perfil);
  const permissoes = [...new Set([...base, ...(u.papelAcesso && !u.papelAcesso.ativo ? [] : lerPermissoes(u.permissoesExtras))])].filter(p =>
    !negadas.has(p) && !["comissoes.ver", "acessos.gerenciar"].includes(p) && (!somenteLeitura || p.endsWith(".ver") || p === "relatorios.exportar" || p === "cadastros.sensiveis"));
  return { usuarioId: u.id, perfil: u.perfil, ativo: true, global: u.acessoGlobal, permissoes, regras: u.regrasAcesso };
}
export const pode = (p: PoliticaAcesso, acao: string) => p.ativo && p.permissoes.includes(acao as PermissaoAcesso);
export const carteiraIrrestrita = (p: PoliticaAcesso) => p.ativo && p.global && !p.regras.some(r => r.efeito === "BLOQUEAR");
export const perfilSomenteLeitura = (p: Pick<PoliticaAcesso, "perfil">) => ["SOCIO", "CONTABILIDADE", "CONSULTA"].includes(p.perfil);
export function permitidoRecurso(p: PoliticaAcesso, tipo: TipoEscopo, id: string, heranca = false): boolean {
  if (!p.ativo || !id) return false;
  const regras = p.regras.filter(r => r.tipo === tipo && r.recursoId === id);
  if (regras.some(r => r.efeito === "BLOQUEAR")) return false;
  return p.global || heranca || regras.some(r => r.efeito === "PERMITIR");
}
const ROTAS: Array<[string, PermissaoAcesso]> = [
  ["/configuracoes/acessos", "acessos.gerenciar"], ["/carteira", "carteira.ver"],
  ["/financeiro/comissoes", "comissoes.ver"], ["/relatorios/comissao", "comissoes.ver"],
  ["/cadastros/governanca", "governanca.editar"], ["/cadastros/base-unificada", "unificacao.ver"],
  ["/cadastros/contratos-unificados", "contratos.ver"], ["/cadastros", "cadastros.ver"],
  ["/financeiro/importacoes", "importacoes.ver"], ["/financeiro/migracao-widesys", "importacoes.ver"],
  ["/financeiro/boletos", "boletos.ver"], ["/financeiro/contas-bancarias", "contas.ver"],
  ["/financeiro/conciliacao", "pagamentos.conciliar"], ["/financeiro/automacoes", "comunicacoes.ver"],
  ["/financeiro/notas-fiscais", "fiscal.ver"], ["/financeiro", "financeiro.ver"],
  ["/recebimentos", "financeiro.ver"], ["/contratos", "contratos.ver"], ["/unificacao", "unificacao.ver"],
  ["/caixa", "caixa.ver"], ["/temporada", "temporada.ver"], ["/relatorios", "relatorios.ver"],
  ["/paineis/cobranca", "financeiro.ver"], ["/paineis/empreendimentos", "relatorios.ver"],
  ["/paineis/caixa", "caixa.ver"], ["/paineis/temporada", "temporada.ver"], ["/executivo", "painel.ver"],
];
export function permissaoDaRota(path: string): PermissaoAcesso | null {
  if (path === "/") return "painel.ver";
  return ROTAS.find(([r]) => path === r || path.startsWith(r + "/"))?.[1] ?? null;
}
const ROTAS_SENSIVEIS = ["/cadastros/pessoas", "/cadastros/imoveis-legado", "/cadastros/base-unificada", "/cadastros/contratos-unificados", "/unificacao", "/financeiro/migracao-widesys", "/financeiro/contas-a-pagar", "/financeiro/contas-a-receber", "/financeiro/movimentacoes"];
const requerDadosSensiveis = (path: string) => ROTAS_SENSIVEIS.some(r => path === r || path.startsWith(r + "/"));
export function podeAbrirRota(p: PoliticaAcesso, path: string): boolean {
  if (path === "/ajuda") return p.ativo;
  if (requerDadosSensiveis(path) && !pode(p, "cadastros.sensiveis")) return false;
  const acao = permissaoDaRota(path);
  return !!acao && pode(p, acao) && (path === "/carteira" || path.startsWith("/carteira/") || (!perfilSomenteLeitura(p) && carteiraIrrestrita(p)));
}
/** Apenas capacidades de navegação; nunca enviar IDs das regras ao cliente. */
export type NavegacaoAcesso = { permissoes: PermissaoAcesso[]; operacional: boolean };
export function navegacaoAcesso(p: PoliticaAcesso): NavegacaoAcesso {
  return { permissoes: p.permissoes, operacional: carteiraIrrestrita(p) && !perfilSomenteLeitura(p) };
}
export function podeNavegar(p: NavegacaoAcesso, path: string) {
  if (path === "/ajuda") return true;
  if (requerDadosSensiveis(path) && !p.permissoes.includes("cadastros.sensiveis")) return false;
  const codigo = permissaoDaRota(path);
  return !!codigo && p.permissoes.includes(codigo) && (path === "/carteira" || p.operacional);
}
