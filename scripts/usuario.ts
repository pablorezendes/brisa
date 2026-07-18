/**
 * Cria um usuário ou redefine a senha de um existente (upsert).
 * Uso: npm run usuario -- "Nome Completo" login "senha-com-8+-caracteres"
 */
import { PrismaClient } from "@prisma/client";
import { gerarHashSenha } from "../src/lib/auth";

const prisma = new PrismaClient();

async function main() {
  const [nome, usuario, senha] = process.argv.slice(2);
  if (!nome || !usuario || !senha) {
    console.error('Uso: npm run usuario -- "Nome" login "senha"');
    process.exit(1);
  }
  if (senha.length < 8) {
    console.error("A senha precisa de pelo menos 8 caracteres.");
    process.exit(1);
  }
  const login = usuario.trim().toLowerCase();
  await prisma.usuario.upsert({
    where: { usuario: login },
    create: { nome, usuario: login, senhaHash: gerarHashSenha(senha) },
    update: { nome, senhaHash: gerarHashSenha(senha) },
  });
  console.log(`OK — usuário "${login}" pronto (senha definida).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
