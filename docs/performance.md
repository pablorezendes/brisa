# Performance e diagnóstico de falhas

O código numérico da tela de erro do Next é um **digest**, não um diagnóstico.
Correlacione-o com horário, página e logs do mesmo deploy. A tela de login
responder HTTP 200 não prova que páginas autenticadas estão funcionando.

## Correção da leitura financeira

- Consultas de unificação usam campos explícitos, sem carregar snapshots brutos
  que não participam da projeção.
- A leitura das fontes e decisões mantém um snapshot transacional consistente;
  a montagem de hashes, proveniência e linhas ocorre depois de liberar a
  transação de leitura. Mutações continuam validando fontes dentro da transação.
- Listagens e filtros de apuração compartilham uma leitura por renderização.
  Não existe cache global com prazo de validade para saldos, autorizações ou
  elegibilidade de cobranças.
- A busca de candidatos compara somente o mesmo domínio, mantendo as regras
  de identificação e de bloqueio de duplicidade.
- Loading e recuperação não exibem dados fictícios nem repetem automaticamente
  operações financeiras. Uma falha ao carregar não comprova o resultado de uma
  emissão ou pagamento; confira a operação antes de tentar executá-la novamente.

## Medir em ambiente local

Use uma cópia privada do banco e um preview de produção, nunca uma carga de
teste contra o servidor dos usuários:

```powershell
npm run build
npm run start -- --hostname 127.0.0.1 --port 3100
```

Em outro terminal, com o ambiente local carregado:

```powershell
node --env-file=.env --env-file=.env.local --import tsx scripts/diagnosticar-performance.ts
```

O diagnóstico faz apenas GETs locais autenticados, duas rodadas sequenciais e
duas rodadas de quatro acessos simultâneos. Registra duração até receber todo
o conteúdo, tamanho, status e falhas, sem imprimir sessões, nomes ou valores.
Não emite notas/boletos, não envia mensagens e não altera o banco. Rode antes e
depois com a mesma base, máquina e sem testes/builds concorrentes.

### Verificação desta correção (25/09/2026)

Base local com 7.527 fontes/linhas/decisões. O SHA-256 agregado do JSON completo
da operação permaneceu idêntico antes/depois. A mediana de três leituras diretas
caiu de 666 ms para 428 ms (aproximadamente 36%).

No preview de produção local, a rodada posterior apresentou mediana de 396 ms
em 12 GETs sequenciais e máximo de 1.662 ms em oito GETs com concorrência quatro,
sem falhas. São tempos até o conteúdo HTTP completo, não uma medição da
hidratação dos gráficos nem uma promessa de latência no VPS. Rede, concorrência,
memória e CPU da máquina afetam o resultado. O digest informado pelo usuário
precisa dos logs do servidor para estabelecer a causa original.

## Se o erro reaparecer no servidor

```bash
cd /srv/stack/acamargo
git rev-parse --short HEAD
docker compose ps
docker stats --no-stream brisa
docker compose logs --since 15m --tail 200 brisa
```

Informe página, horário e código da tela junto com o trecho correspondente.
Não publique `.env`, cookies, certificados, tokens ou exportações financeiras.
Os eventos `BRISA_REQUEST_ERROR` adicionados pelo app usam rota template e
identificadores técnicos sanitizados, sem parâmetros de URL nem mensagem livre
do erro. O runtime pode registrar outros logs: confira-os antes de compartilhar.

Esta atualização não exige reimportação, seed, reanálise ou alteração manual
de saldos. Nunca rode `db:seed` para corrigir performance.
