# Central de comunicação de cobrança

Rota: `/financeiro/automacoes`, restrita a **ADMINISTRADOR** no servidor e nas ações. Não basta ocultar valores no navegador. A central não acessa/exporta comissão, observações internas, CPF/CNPJ ou snapshots brutos nas mensagens.

## O que está implementado

- Configuração de remetente e resposta por e-mail (API **Resend**) e número empresarial por WhatsApp (**Meta Cloud API**).
- Tokens inseridos no painel são cifrados com AES-256-GCM; nunca retornam ao navegador. A chave de cifra fica somente no ambiente do servidor, separada do banco e do Git.
- Textos com `{nome}`, `{documento}` (referência da cobrança, não CPF), `{vencimento}`, `{valor}` (saldo aberto) e `{empresa}`; prévia usa o mesmo renderizador do envio.
- Contato verificado com evidência de autorização e revogação. Importar telefone/e-mail do Widesys **não autoriza disparos**.
- Preparação manual e régua por dias relativos ao vencimento. Janela em America/Sao_Paulo, dias úteis opcionais, limite móvel de 24 horas e intervalo mínimo de 24h por destinatário/canal.
- Outbox persistente, reserva atômica, chave de deduplicação por título/canal/etapa e origem. Apenas títulos ativos da base unificada, não duplicatas, pendências, agregados ou quarentena.
- Saldo, identidade, versão da configuração, autorização e perfil são conferidos novamente antes da reserva do envio. Pagamento/mudança de saldo cancela a prévia antiga.
- Capturas exclusivamente Widesys com mais de 24h são excluídas. A importação não é uma consulta bancária em tempo real: manter conciliação e origem atualizadas é obrigatório.
- Histórico e callbacks WhatsApp assinados; `SAIR`, `PARAR` e `CANCELAR` revogam o canal. Demais mensagens recebidas não são armazenadas nem respondidas automaticamente.

## Configuração segura do servidor

No `.env` privado do servidor, adicione as variáveis (sem aspas/placeholders literais como senha):

```dotenv
AUTOMACOES_ENVIO_HABILITADO=0
AUTOMACOES_CHAVE=
WHATSAPP_API_VERSION=
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
```

Gere **uma vez** a chave de cifra de 32 bytes em Base64 (`openssl rand -base64 32`) e um verify token longo (`openssl rand -hex 32`). Guarde-os em cofre/backup separado; perder ou trocar AUTOMACOES_CHAVE sem recifrar os tokens torna-os ilegíveis. Não use AUTH_SECRET como chave de cifra. Não envie segredos pelo chat nem os publique no Git.

### E-mail

1. Crie/configure sua conta Resend; eventuais custos/contratação são externos ao Brisa.
2. Verifique o domínio remetente com os registros DNS exigidos pelo provedor e valide SPF/DKIM/DMARC.
3. Cadastre o endereço de envio, endereço monitorado para respostas e a API key no painel.
4. Revise assunto/corpo e autorize o canal. Resposta de aceitação da API **não prova entrega**; esta versão não recebe callbacks de e-mail. Bounces/entrega são acompanhados no provedor. Pedidos de interrupção por e-mail devem ser atendidos pela equipe usando Revogar.

### WhatsApp oficial

Digitar somente o telefone não conecta WhatsApp pessoal nem WhatsApp Web. É necessário número empresarial habilitado no Meta Business, Phone Number ID, token com permissões da Cloud API, App Secret e modelo aprovado.

1. Configure o número e sua conta no Meta Business. Não há scraping, sessão QR ou automação de WhatsApp Web.
2. Selecione uma versão suportada pela aplicação Meta em `WHATSAPP_API_VERSION` (formato `vNN.0`; não há versão presumida).
3. Cadastre modelo de cobrança utilitário em `pt_BR`, somente corpo nesta versão. Use cinco parâmetros posicionais: `{{1}}` nome, `{{2}}` documento, `{{3}}` vencimento, `{{4}}` saldo, `{{5}}` empresa.
4. No painel Brisa, preencha exatamente o nome do modelo e seu corpo, substituindo os parâmetros por `{nome}`, `{documento}`, `{vencimento}`, `{valor}`, `{empresa}`, nessa ordem. Confirme que o modelo está aprovado. O texto efetivamente enviado é o modelo hospedado na Meta, não texto livre do editor.
5. Cadastre o callback `https://brisa.tescod.com/api/integracoes/whatsapp/webhook`, use o verify token privado e assine o campo `messages`. O POST exige `X-Hub-Signature-256`, calculado com o App Secret. Um token de verificação não substitui a assinatura HMAC.
6. O número visível no cadastro deve corresponder ao Phone Number ID. A conexão, aprovação do modelo e entrega precisam ser homologadas com destinatários internos autorizados.

## Ativação e execução

Salvar configuração, autorizar contato e preparar mensagem são operações diferentes. Não existe envio automático durante deploy, navegação de página ou `GET`.

Antes de ativar: teste com destinatários internos autorizados, confira destinatário, saldo, modelo, remetente e retorno. No painel, confirme explicitamente os canais; para gerar a fila automaticamente, habilite também a régua. No servidor, altere `AUTOMACOES_ENVIO_HABILITADO=1` e recrie o container para carregar o ambiente.

```bash
# Sem --executar: simulação, nunca envia.
docker compose exec -T brisa npm run comunicacoes:processar

# Processa até 10 itens elegíveis; respeita todas as travas/configurações.
docker compose exec -T brisa npm run comunicacoes:processar -- --executar
```

Para execução recorrente, **após homologar e autorizar**, use `crontab -e` no servidor:

```cron
*/5 * * * * cd /srv/stack/acamargo && docker compose exec -T brisa npm run comunicacoes:processar -- --executar >> /var/log/brisa-comunicacoes.log 2>&1
```

O worker registra apenas códigos e contagens no stdout. Não há endpoint público para disparo. Pausa imediata operacional: desabilitar canais/régua no painel; pausa global persistente: ambiente `AUTOMACOES_ENVIO_HABILITADO=0` e recriar container. Uma transmissão já reservada/em andamento não pode ser recolhida.

## Falhas e limites desta entrega

- `AGENDADA`: ainda não enviada. `ENVIADA`: API aceitou (não significa entregue). `ENTREGUE`/`LIDA`: confirmação WhatsApp. `INCERTA`: conferir provedor, sem reenvio cego. `FALHOU`: erro definitivo desta tentativa. `CANCELADA`: envio interrompido antes da transmissão.
- WhatsApp não oferece garantia de idempotência de envio equivalente à outbox local: timeout/5xx ficam incertos. Queda após pedido remoto também fica incerta. Não criar outra mensagem para contornar esse estado; conferir no provedor.
- E-mail usa Idempotency-Key do Resend, válido por 24h. A fila mantém a identidade permanentemente e limita repetição segura a quatro tentativas e janela conservadora de 23h. Configuração/corpo não mudam durante repetição.
- Intervalo por destinatário pode adiar títulos adicionais para o dia seguinte. Não há consolidação automática de várias cobranças em uma mensagem nesta versão.
- Não há pagamento ou baixa financeira por confirmação de entrega/leitura. Apenas conciliação financeira pode confirmar pagamento.
- Não há envio de boletos, anexos ou links de pagamento ainda: o primeiro modelo é um lembrete com saldo e contato para conferência, evitando URLs/boletos inferidos.
- Modelo fiscal é independente: preparar cobrança não emite NFS-e; renda de aluguel não vira automaticamente valor de serviço tributável.

## Documentação oficial consultada

- [Resend — envio de e-mail](https://resend.com/docs/api-reference/emails/send-email)
- [Resend — idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Meta — coleção oficial WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api)
- [Meta — exemplos oficiais](https://github.com/fbsamples/whatsapp-api-examples)

Credenciais e homologação externa não estão incluídas no deploy do código. Nada nesta implementação disparou cobranças reais.
