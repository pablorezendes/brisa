import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sessaoAtual } from "@/lib/auth";
import { btnPrimario, inputBase } from "@/components/ui";
import { criarPrimeiroUsuario, entrar } from "./actions";

export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  credenciais: "Usuário ou senha incorretos.",
  vazio: "Preencha todos os campos.",
  senha_curta: "A senha precisa de pelo menos 8 caracteres.",
  senhas_diferentes: "As senhas digitadas não conferem.",
};

function CampoRotulo({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
      {children}
    </span>
  );
}

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  if (await sessaoAtual()) redirect("/");

  const { erro } = await searchParams;
  const primeiroAcesso = (await prisma.usuario.count()) === 0;
  const hoje = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
  }).format(new Date());

  return (
    <div className="flex min-h-screen items-center justify-center bg-papel px-6">
      <div className="w-full max-w-sm">
        {/* data editorial acima do cartão */}
        <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-widest text-tinta-suave">
          {hoje}
        </p>

        <div className="border border-contorno bg-carta">
          {/* régua de tinta no topo, marca editorial */}
          <div className="h-1 bg-tinta" />
          <div className="px-8 pb-8 pt-7">
            <div className="mb-6 border-b border-contorno pb-5 text-center">
              <div className="font-serif text-4xl font-bold tracking-tight text-tinta">
                Brisa
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-tinta-suave">
                Gestão de Imóveis
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-oliva-escura">
                grupo Brisa · A.Camargo
              </div>
            </div>

            {erro && MENSAGENS[erro] ? (
              <p className="mb-4 flex items-center gap-2 text-sm text-erro">
                <span className="inline-block h-2 w-2 rounded-full bg-erro" />
                {MENSAGENS[erro]}
              </p>
            ) : null}

            {primeiroAcesso ? (
              <>
                <h1 className="mb-1 font-serif text-lg font-semibold text-tinta">
                  Primeiro acesso
                </h1>
                <p className="mb-5 text-sm leading-relaxed text-tinta-suave">
                  O sistema ainda não tem usuários. Crie a conta do
                  administrador para começar.
                </p>
                <form action={criarPrimeiroUsuario} className="space-y-4">
                  <label className="block">
                    <CampoRotulo>Seu nome</CampoRotulo>
                    <input
                      name="nome"
                      type="text"
                      required
                      autoFocus
                      className={`${inputBase} w-full`}
                      placeholder="Antonio Camargo"
                    />
                  </label>
                  <label className="block">
                    <CampoRotulo>Usuário</CampoRotulo>
                    <input
                      name="usuario"
                      type="text"
                      required
                      autoCapitalize="none"
                      className={`${inputBase} w-full`}
                      placeholder="antonio"
                    />
                  </label>
                  <label className="block">
                    <CampoRotulo>Senha (mín. 8 caracteres)</CampoRotulo>
                    <input
                      name="senha"
                      type="password"
                      required
                      minLength={8}
                      className={`${inputBase} w-full`}
                    />
                  </label>
                  <label className="block">
                    <CampoRotulo>Confirme a senha</CampoRotulo>
                    <input
                      name="confirma"
                      type="password"
                      required
                      className={`${inputBase} w-full`}
                    />
                  </label>
                  <button type="submit" className={`${btnPrimario} w-full justify-center`}>
                    Criar conta e entrar
                  </button>
                </form>
              </>
            ) : (
              <form action={entrar} className="space-y-4">
                <label className="block">
                  <CampoRotulo>Usuário</CampoRotulo>
                  <input
                    name="usuario"
                    type="text"
                    required
                    autoFocus
                    autoCapitalize="none"
                    className={`${inputBase} w-full`}
                  />
                </label>
                <label className="block">
                  <CampoRotulo>Senha</CampoRotulo>
                  <input
                    name="senha"
                    type="password"
                    required
                    className={`${inputBase} w-full`}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-tinta-suave">
                  <input
                    name="lembrar"
                    type="checkbox"
                    className="h-4 w-4 rounded-sm border-contorno accent-[#5e6e52]"
                  />
                  Continuar conectado por 30 dias
                </label>
                <button type="submit" className={`${btnPrimario} w-full justify-center`}>
                  Entrar
                </button>
              </form>
            )}
          </div>
        </div>

        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-widest text-tinta-suave">
          o diário financeiro da família — do aluguel ao caixa
        </p>
      </div>
    </div>
  );
}
