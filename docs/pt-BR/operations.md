# Configuração, testes e operação

[README](../../README-pt-BR.md) · [English](../operations.md) · Português (Brasil)

Execute os comandos na raiz do repositório. Conclua a [configuração inicial](setup.md) antes dos procedimentos que usam contêineres. O [guia de arquitetura](architecture.md) explica a relação entre resultado do build, sugestões da IA e decisões de implantação.

## Configuração

O Compose lê o `.env` no diretório do projeto. Os scripts Node não o carregam automaticamente; ao executá-los diretamente, exporte as variáveis ou use a opção `--env-file` do Node. Variáveis já definidas no shell têm precedência sobre os valores do `.env`.

| Variável               | Padrão e uso                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOCKER_GID`           | O Compose usa `0` como padrão; ajuste para o grupo do socket Docker do host antes de iniciar o Jenkins.                                                           |
| `OLLAMA_MODEL`         | `qwen2.5-coder:1.5b`; o Compose repassa o valor ao Jenkins e à aplicação. Revisão e API usam o mesmo modelo.                                                      |
| `APP_PORT`             | `3000`; altera a porta do host publicada em `127.0.0.1`. Dentro do contêiner, a aplicação sempre escuta na porta `3000`.                                          |
| `COMPOSE_PROJECT_NAME` | `jenkins-ai-pipeline`; o script de implantação espera a rede `<project>_default` desse projeto. Use o mesmo nome na infraestrutura e na implantação.              |
| `OLLAMA_URL`           | `http://ollama:11434`; fixado no Compose para Jenkins e aplicação e usado como padrão nos scripts Node. Alterar apenas o `.env` não substitui o valor do Compose. |
| `APP_IMAGE`            | Definido pelo Jenkins a cada build. O padrão do Compose é `jenkins-ai-pipeline:local`, que precisa existir para uso manual.                                       |
| `APP_COMMIT`           | Gravado na imagem pelo argumento de build do Docker; assume `development` quando a imagem é construída sem esse argumento. Retornado por `/health`.               |
| `DISCORD_WEBHOOK_URL`  | Sem padrão; fornecido pela credencial Jenkins `discord-webhook-url` durante a notificação.                                                                        |

O Jenkins também fornece `GIT_COMMIT`, `GIT_PREVIOUS_SUCCESSFUL_COMMIT`, `BUILD_NUMBER` e `BUILD_URL`. A esteira calcula `TEST_EXIT`, `TEST_SUMMARY` e `BUILD_RESULT`. A implantação passa `EXPECTED_COMMIT` ao teste de fumaça; esses valores são metadados de execução, não configurações para copiar ao `.env`.

Depois de alterar `OLLAMA_MODEL` ou `APP_PORT` no `.env`, atualize o contêiner Jenkins e execute um novo build:

```sh
docker compose up -d jenkins
```

A aplicação recebe os novos valores durante a implantação. Mantenha o nome do projeto consistente; mudá-lo aponta para outra stack e outra rede Compose. A configuração do modelo e a capacidade de inferência compartilhada estão descritas em [revisão por IA](ai-review.md#modelo-e-inferência).

### Limites de tempo

A esteira tem limite total de 45 minutos. Cada operação também tem seus próprios limites:

| Operação             | Limite do script ou cliente  | Limite do Jenkins                                     |
| -------------------- | ---------------------------- | ----------------------------------------------------- |
| Preparação do modelo | 20 minutos para download     | 25 minutos, incluindo verificações de disponibilidade |
| Revisão por IA       | Cinco minutos por inferência | Seis minutos                                          |
| Inferência da API    | 120 segundos                 | —                                                     |
| Notificação          | Dez segundos por requisição  | Dois minutos                                          |

Falhas de preparação e revisão nos scripts são tratadas como `UNSTABLE`. Timeouts do Jenkins e cancelamentos manuais se propagam por `catchInterruptions: false` e interrompem a execução. Consulte o [tratamento de erros do Jenkins](https://www.jenkins.io/doc/pipeline/steps/workflow-basic-steps/#catcherror-catch-error-and-set-build-result-to-failure).

## API

Os exemplos abaixo usam a porta padrão do host. A implementação está no [servidor HTTP](../../src/server.js) e no [cliente Ollama](../../src/ollama.js).

```sh
curl http://localhost:3000/health
# {"status":"ok","commit":"<full-commit-sha>"}

curl http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Explique integração contínua em uma frase."}'
# {"reply":"...","model":"qwen2.5-coder:1.5b"}
```

`GET /health` verifica o processo HTTP e informa o commit configurado. Não consulta o Ollama. `POST /chat` aceita um objeto JSON com uma string `message` não vazia, envia uma única mensagem de usuário ao Ollama e retorna `reply` e `model`. As requisições são independentes, sem histórico de conversa armazenado e sem resposta em streaming.

Os erros da aplicação usam `{"error":"..."}`, com mensagens atualmente em português.

| Status HTTP | Condição                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------- |
| `400`       | JSON inválido, `message` inválida ou vazia, ou interrupção no recebimento do corpo.           |
| `404`       | Rota desconhecida.                                                                            |
| `405`       | Método não aceito em `/health` ou `/chat`; `Allow` informa o método permitido.                |
| `413`       | Corpo acima de 16.384 bytes, medido em bytes, não em caracteres de texto.                     |
| `415`       | Tipo de conteúdo diferente de `application/json`.                                             |
| `500`       | Erro inesperado da aplicação.                                                                 |
| `502`       | Resposta do modelo inválida, incompleta ou vazia.                                             |
| `503`       | Ollama inacessível ou resposta HTTP sem sucesso, inclusive quando o modelo está indisponível. |
| `504`       | Inferência excede o timeout de 120 segundos do cliente.                                       |

`npm start` executa a API diretamente em `0.0.0.0:3000`. Para executá-la no host, `OLLAMA_URL` precisa apontar para uma instância Ollama acessível por ele; o hostname `ollama` do Compose e sua porta não publicada não oferecem essa conexão pelo host. A implantação via Compose evita essa diferença ao executar a API na rede compartilhada.

## Testes automatizados

Com Node.js 24 e Git disponíveis, os testes dispensam serviço Docker em execução, modelo Ollama, credencial Discord e acesso à rede externa:

```sh
npm test
npm run test:ci
docker compose config --quiet
docker compose --profile app config --quiet
```

Os dois comandos de teste executam a mesma suíte. `test:ci` também produz `reports/tests.xml` e `reports/tests.json`. Os testes usam servidores HTTP locais, repositórios Git temporários e comandos Docker simulados. Cobrem validação da API e erros do serviço de inferência, preparação do modelo, seleção e truncamento da revisão, validação da saída estruturada, limites e repetição das notificações e recuperação da implantação.

Não é necessário instalar dependências para executar a aplicação ou os testes. O Prettier é a única dependência de desenvolvimento. Se precisar dele localmente, `npm ci` instala a ferramenta conforme o lockfile; `npm run format` reescreve o repositório inteiro, então selecione arquivos específicos ao trabalhar apenas na documentação.

Passar nesses testes não verifica a instalação Jenkins, a construção real da imagem, a resposta de um modelo real ou a entrega no Discord. Uma verificação de integração exige executar o job configurado, conferir a API implantada e os relatórios arquivados e confirmar o recebimento no canal.

## Consulta e preparação do modelo

Consulte os modelos que o Jenkins consegue acessar:

```sh
docker compose exec jenkins node -e 'fetch("http://ollama:11434/api/tags").then(r=>r.json()).then(console.log)'
```

Para baixar o modelo padrão manualmente:

```sh
docker compose exec ollama ollama pull qwen2.5-coder:1.5b
```

Se `OLLAMA_MODEL` tiver outro valor, use esse nome. Normalmente, a esteira prepara o modelo automaticamente. O volume do Ollama preserva os modelos baixados; trocar o modelo selecionado não apaga os anteriores.

## Implantação e recuperação

[O script de implantação](../../scripts/deploy.js) registra o ID da imagem e o commit gravado quando encontra uma aplicação em execução. Se não conseguir identificar esse commit, interrompe o processo antes de substituir a aplicação. Em seguida, inicia um candidato na rede Compose existente e executa o [teste de fumaça](../../scripts/smoke.js) dentro dele.

O teste consulta `/health` até 30 vezes e exige `status: "ok"` e o commit esperado. Depois, faz uma chamada real a `/chat` e exige uma resposta não vazia e o nome do modelo configurado. O prompt pede `OK`, mas a verificação não exige esse texto exato nem avalia a qualidade da resposta.

Só um candidato aprovado permite substituir a aplicação. O Compose atualiza `app` com `--no-deps --wait --wait-timeout 60`, e o script repete o teste no contêiner implantado. O health check Docker da imagem verifica apenas o sucesso HTTP de `/health`; ele é menos abrangente que a validação completa da implantação.

| Estado em `deployment.json` | Significado                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `checking_candidate`        | A validação do candidato está prestes a começar; esse estado pode permanecer após uma interrupção.                |
| `candidate_failed`          | A inicialização ou validação do candidato falhou antes da substituição da aplicação.                              |
| `deploying`                 | A substituição da aplicação está prestes a começar; o resultado final ainda não foi registrado.                   |
| `deployed`                  | A aplicação implantada passou no teste de fumaça completo.                                                        |
| `rolled_back`               | A implantação falhou e a imagem anterior passou nas verificações de recuperação. O script ainda termina com erro. |
| `rollback_failed`           | A implantação e a recuperação falharam; é necessária intervenção manual.                                          |
| `failed_first_deploy`       | Não havia aplicação anterior em execução; o script tentou remover a aplicação que falhou.                         |

O script tenta remover o candidato após a validação. Falhas na limpeza são registradas, portanto um candidato pode permanecer no host. Erros iniciais de configuração ou inspeção podem ocorrer antes da gravação de qualquer relatório de implantação.

A recuperação restaura o ID da imagem anterior com a configuração Compose atual; não restaura variáveis antigas nem o volume do Ollama. Assim, um problema de modelo ou configuração pode afetar as duas versões. Uma interrupção forçada pode deixar o último relatório incompleto e exigir recuperação manual.

### Implantar manualmente

Use este procedimento apenas depois de iniciar Jenkins e Ollama e disponibilizar o modelo escolhido. Use código versionado correspondente a `HEAD`: o Docker constrói o diretório de trabalho, então alterações locais podem identificar incorretamente outro código com esse commit. Evite executar o procedimento ao mesmo tempo que uma implantação do Jenkins.

O subshell evita deixar as variáveis temporárias no seu shell e interrompe a sequência em caso de falha:

```sh
(
  set -e
  export GIT_COMMIT="$(git rev-parse HEAD)"
  export APP_IMAGE="jenkins-ai-pipeline:manual-$GIT_COMMIT"
  npm test
  docker build --build-arg APP_COMMIT="$GIT_COMMIT" --tag "$APP_IMAGE" .
  node --env-file=.env scripts/deploy.js
)
```

O carregamento explícito do `.env` mantém o modelo e o nome do projeto usados pelo candidato alinhados ao Compose. Esse procedimento executa testes, construção e implantação; não realiza a revisão do Jenkins, não arquiva relatórios no Jenkins e não envia notificações ao Discord.

### Restaurar uma imagem manualmente

Em caso de `rollback_failed`, consulte `previousImage` no `deployment.json` do build afetado. Se o valor for `null`, não há imagem registrada para restaurar. Substitua o marcador abaixo pelo ID completo da imagem registrada e use o mesmo projeto Compose e a mesma configuração de modelo:

```sh
APP_IMAGE='sha256:<previous-image-id>' docker compose up -d --no-deps --wait --wait-timeout 60 app
docker compose exec app node scripts/smoke.js
docker compose logs --tail=100 app ollama
```

O teste manual usa o `APP_COMMIT` gravado na imagem restaurada. Confira também se `/health` corresponde ao commit anterior pretendido. Se a inferência falhar, investigue o Ollama e a configuração ativa antes de considerar a recuperação concluída.

## Artefatos do build

Os relatórios são gravados em `reports/` no diretório de trabalho. O Jenkins limpa o workspace no checkout e arquiva os relatórios disponíveis no pós-processamento; comandos locais deixam seus relatórios no diretório local.

| Artefato                   | Conteúdo                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests.xml`, `tests.json`  | Resultados JUnit e estado e código de saída do executor de testes.                                                                                      |
| `model.json`               | `ready` com modelo e informação de download, ou `unavailable`.                                                                                          |
| `review.json`, `review.md` | Resultado da revisão, resumo e sugestões; o JSON também registra modelo, arquivos, modo, commit base e truncamento quando a coleta termina com sucesso. |
| `deployment.json`          | Imagem solicitada, commit, ID da imagem anterior e último estado de implantação registrado.                                                             |
| `notification.json`        | `sent` ou `failed` quando o script de notificação alcança a gravação do relatório.                                                                      |

Quando houver relatórios incompletos, consulte também o console do build para identificar onde a execução parou.

### Envio de notificações

O [script de notificação](../../scripts/notify.js) envia ao Discord com `wait=true` e no máximo três tentativas. Erros de rede, HTTP 429 e erros de servidor podem ser repetidos; outros erros de cliente encerram o envio imediatamente. O script espera um segundo entre tentativas, ou o valor de `retry_after` do Discord em caso de HTTP 429, e para se a espera solicitada ultrapassar 30 segundos. Os limites da requisição e da etapa estão em [limites de tempo](#limites-de-tempo).

Se o checkout não disponibilizou o script, o Jenkins tenta uma mensagem mínima com uma única requisição de dez segundos. Essa alternativa não cria `notification.json`; a ausência de uma credencial Jenkins também impede o início do script normal. Um pós-processamento abortado pode deixar relatórios ou o envio incompletos.

O Discord informa o estado do build no momento da notificação; o Jenkins mostra o resultado final.

## Diagnóstico e manutenção

**O Jenkins não consegue acessar o Docker.** Compare o grupo do socket com `DOCKER_GID` e recrie o Jenkins com `docker compose up -d jenkins`. Verifique o acesso pelo contêiner com `docker compose exec jenkins docker version`. Evite liberar escrita no socket para todos os usuários.

**Health funciona, mas chat ou implantação falha.** Consulte os logs do Ollama e a lista de modelos, confira `OLLAMA_MODEL` e diferencie um modelo ausente de um timeout. O console do Jenkins mostra a causa da verificação reprovada, incluindo o status HTTP e a mensagem de erro da API (`Modelo não encontrado.` para modelo ausente, `Tempo limite do modelo excedido.` para timeout). Revisão e requisições dos usuários compartilham a capacidade de inferência. `/health` não diagnostica essa dependência.

**O build ficou instável após implantar.** Consulte os relatórios de modelo, revisão e notificação e o console do Jenkins. Uma resposta de revisão inválida ou a falta da credencial Discord pode explicar esse resultado sem exigir recuperação. **A ausência de notificação** também pode decorrer de falha de rede, rejeição do webhook, limitação de requisições ou interrupção do pós-processamento; a URL completa do webhook deve permanecer nas credenciais do Jenkins.

Consulte os logs recentes dos serviços com:

```sh
docker compose logs --tail=100 jenkins ollama app
```

As imagens continuam disponíveis para recuperação até serem removidas. A retenção de builds do Jenkins não as limpa; confira os contêineres em execução e a necessidade de recuperação antes de apagar imagens antigas. A imagem do Ollama é fixada por digest, enquanto as imagens base Jenkins LTS, Node.js 24 e Docker CLI 29 acompanham suas tags. Reconstrua e valide após alterar ou atualizar essas imagens.

Para parar e remover os contêineres e a rede deste projeto, preservando os volumes nomeados:

```sh
docker compose --profile app down
```

Não acrescente `--volumes` se precisar manter os dados do Jenkins e os modelos baixados. Um candidato que tenha permanecido após uma implantação interrompida foi criado fora do Compose e pode exigir limpeza separada, após inspeção.

Volte para [configuração](setup.md), [arquitetura](architecture.md) ou [revisão por IA](ai-review.md).
