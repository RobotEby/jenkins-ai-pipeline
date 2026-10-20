# Preparação do ambiente e configuração do Jenkins

[README](../../README-pt-BR.md) · [English](../setup.md) · Português (Brasil)

Este guia configura um único job local do Jenkins para construir e implantar uma branch Git confiável no mesmo host Docker. Execute os comandos na raiz do repositório.

## Preparar o host

Use Linux ou WSL2 com Docker Engine e o plugin Docker Compose. Seu usuário precisa conseguir executar comandos Docker, e o socket do daemon deve estar disponível em `/var/run/docker.sock`. O Node.js 24 só é necessário no host para desenvolvimento e testes locais; a imagem do Jenkins já inclui Node.js, npm, Docker CLI e Compose.

A instalação inicial precisa de acesso à internet para obter imagens, plugins do Jenkins, código Git e o modelo do Ollama. As notificações também dependem de acesso ao Discord. A inferência é local; a configuração fornecida do Compose não habilita GPU. A CPU e a memória disponível influenciam se a inferência termina dentro dos limites de tempo definidos.

Crie o `.env` sem sobrescrever uma configuração existente e consulte o grupo do socket Docker:

```sh
test -f .env || cp .env.example .env
stat -c '%g' /var/run/docker.sock
```

Defina `DOCKER_GID` no `.env` com esse número. O valor `0` do exemplo precisa ser conferido; ele não funciona em todos os hosts. Para a primeira execução, mantenha o modelo e a porta padrão, salvo se houver necessidade de alterá-los.

O `.gitignore` exclui `.env`. Mantenha o arquivo local, confira o que foi preparado para commit e armazene credenciais no Jenkins, não no `.env` ou no código. Os filtros de segredos da revisão não impedem que arquivos sejam versionados.

Valide a configuração e inicie a infraestrutura:

```sh
docker compose config --quiet
docker compose up -d --build jenkins ollama
docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Se o Jenkins ainda estiver inicializando, aguarde antes de consultar a senha. Ele é publicado em `127.0.0.1:8080`. O Ollama não publica porta no host. Volumes nomeados preservam os dados do Jenkins e os modelos baixados quando os contêineres são recriados. O serviço `app` usa um perfil separado e é iniciado pela implantação após a validação.

## Configurar o Jenkins

Abra [http://localhost:8080](http://localhost:8080), desbloqueie o Jenkins com a senha inicial e crie a conta de administrador. A [imagem do Jenkins](../../jenkins/Dockerfile) instala os [plugins de Pipeline, Git, Credentials Binding e JUnit](../../jenkins/plugins.txt).

Em **Gerenciar Jenkins → Nós → Built-In Node → Configurar**, defina **Número de executores** como **1**. Na configuração do sistema, preencha a **URL do Jenkins** com `http://localhost:8080/`. Esse endereço aparece nas notificações; links com `localhost` só funcionam na máquina que hospeda o Jenkins.

Nesta configuração, os builds executam no nó integrado. A esteira usa `agent any`; outros agentes precisam ter as mesmas ferramentas e acesso ao host de implantação. Mantenha um único job de implantação para este projeto Compose: a execução sequencial vale para builds desse job, não para jobs diferentes ou implantações manuais.

### Conectar o repositório Git

Antes de configurar o job, confira se a branch remota contém `Jenkinsfile`, aplicação, testes, scripts e configuração dos contêineres. O Jenkins busca o código no Git; arquivos locais sem commit não ficam disponíveis para ele.

1. Crie um item do tipo **Pipeline**, por exemplo `jenkins-ai-pipeline`.
2. Selecione **Pipeline script from SCM** e depois **Git**.
3. Informe `https://github.com/RobotEby/jenkins-ai-pipeline.git` ou a URL do seu repositório com esses arquivos.
4. Defina **Branch Specifier** como `*/main` e **Script Path** como `Jenkinsfile`.
5. Para um repositório privado via HTTPS, cadastre uma credencial **Username with password** com seu usuário GitHub e um token com acesso de leitura ao repositório como senha. Selecione a credencial no SCM e salve o job.

A branch é uma configuração do job, não uma restrição imposta pela esteira. Configure apenas código em que você confia para executar comandos nesse host.

### Cadastrar a credencial do Discord

No servidor Discord, abra **Configurações do servidor → Integrações → Webhooks**, crie um webhook e escolha o canal de destino. No Jenkins, abra **Gerenciar Jenkins → Credenciais → System → Global credentials → Add Credentials**. Escolha **Secret text**, cole a URL do webhook e use o ID **`discord-webhook-url`**.

A esteira disponibiliza a credencial como `DISCORD_WEBHOOK_URL` apenas durante a notificação. Os scripts fornecidos não a gravam em relatórios, prompts do modelo ou imagens da aplicação. Quem pode alterar a esteira confiável também pode mudar o uso das credenciais; essa vinculação não isola o segredo do código do repositório.

A ausência da credencial ou uma falha comum de envio deixa um build que seria bem-sucedido como `UNSTABLE`, sem substituir um resultado anterior mais grave. Isso não desfaz a implantação. O canal recebe dados do build, um resumo da revisão e até três sugestões; escolha um canal adequado para essas informações.

## Executar o primeiro build

Clique em **Construir agora** uma vez. A execução do Jenkinsfile registra `pollSCM('H/5 * * * *')`: o Jenkins consulta a branch escolhida a cada cinco minutos, com o minuto inicial definido para aquele job, e dispara um build quando encontra alterações. Esse mecanismo não exige configurar webhook no GitHub.

O modelo padrão é `qwen2.5-coder:1.5b`. A preparação aguarda o Ollama e só baixa o modelo se ele estiver ausente; os builds seguintes reutilizam o volume. Acompanhe o console e consulte os relatórios arquivados ao final da execução.

Após a implantação, verifique o endpoint padrão da aplicação:

```sh
curl http://localhost:3000/health
```

A resposta informa `status` e o `commit` implantado. Use o [exemplo de chat](operations.md#api) para verificar a inferência. Se você alterou `APP_PORT`, use essa porta nas requisições pelo host. Uma implantação bem-sucedida pode acompanhar um build `UNSTABLE`; o [guia de arquitetura](architecture.md#resultado-do-build-e-condições-para-implantar) explica essa diferença.

## Limites de confiança do ambiente local

O Jenkins usa seu próprio usuário no contêiner, mas o socket Docker permite criar e controlar contêineres no host. Ajustar `DOCKER_GID` resolve a permissão de acesso; não reduz essa autoridade. Trate o acesso à conta de administrador do Jenkins e à branch de origem como acesso ao host Docker.

O Compose publica Jenkins e aplicação apenas em loopback. A aplicação não implementa autenticação, TLS ou limitação de requisições, e uma execução direta com `npm start` escuta em `0.0.0.0:3000`. A configuração é voltada a um laboratório local. Disponibilizá-la para outros usuários exige decisões próprias sobre controle de acesso, segurança do transporte, isolamento dos builds e backup dos dados persistentes.

Continue em [arquitetura](architecture.md), [revisão por IA](ai-review.md) ou [configuração, implantação e recuperação](operations.md).
