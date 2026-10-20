# Environment and Jenkins setup

[README](../README.md) · English · [Português (Brasil)](pt-BR/setup.md)

This guide sets up one local Jenkins job that builds and deploys a trusted Git branch on the same Docker host. Run the shell commands from the repository root.

## Prepare the host

Use Linux or WSL2 with Docker Engine and the Docker Compose plugin. Your user must be able to run Docker commands, and the daemon socket must be available at `/var/run/docker.sock`. Node.js 24 is needed on the host only for local development and tests; the Jenkins image already includes Node.js, npm, Docker CLI, and Compose.

The initial setup needs internet access to retrieve container images, Jenkins plugins, Git source, and the Ollama model. Notifications also need access to Discord. Inference runs locally; the supplied Compose configuration does not enable GPU access. CPU speed and available memory affect whether inference finishes within the configured time limits.

Create `.env` without overwriting an existing configuration, then inspect the Docker socket group:

```sh
test -f .env || cp .env.example .env
stat -c '%g' /var/run/docker.sock
```

Set `DOCKER_GID` in `.env` to that numeric group ID. The sample value `0` is a placeholder, not a value that works on every host. Keep the default model and application port for the first run unless they need to change.

The `.gitignore` excludes `.env`. Keep it local, inspect staged files before committing, and store credentials in Jenkins rather than in `.env` or source files. The review script's secret filtering does not prevent files from being committed.

Validate the configuration and start the infrastructure:

```sh
docker compose config --quiet
docker compose up -d --build jenkins ollama
docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

If Jenkins is still initializing, wait for startup to finish before reading the password. Jenkins is published at `127.0.0.1:8080`. Ollama has no published host port. Named volumes preserve Jenkins data and downloaded models across container recreation. The `app` service belongs to a separate profile and is started by deployment after validation.

## Configure Jenkins

Open [http://localhost:8080](http://localhost:8080), unlock Jenkins with the initial password, and create the administrator account. The [Jenkins image](../jenkins/Dockerfile) installs the [Pipeline, Git, Credentials Binding, and JUnit plugins](../jenkins/plugins.txt).

In **Manage Jenkins → Nodes → Built-In Node → Configure**, set **Number of executors** to **1**. In the system configuration, set **Jenkins URL** to `http://localhost:8080/`. This URL appears in build notifications; a `localhost` link only works on the machine hosting Jenkins.

This setup runs builds on the built-in node. The pipeline uses `agent any`; adding other agents requires them to have the same tools and access to the deployment host. Keep a single deployment job for this Compose project: disabling concurrent builds serializes executions of that job, not separate jobs or manual deployments.

### Connect the Git repository

Before configuring the job, make sure the remote branch contains `Jenkinsfile`, the application, tests, scripts, and container configuration. Jenkins checks out Git source; uncommitted local files are not available to it.

1. Create a new **Pipeline** item, for example `jenkins-ai-pipeline`.
2. Select **Pipeline script from SCM**, then **Git**.
3. Enter `https://github.com/RobotEby/jenkins-ai-pipeline.git`, or the URL of your own repository containing these files.
4. Set **Branch Specifier** to `*/main` and **Script Path** to `Jenkinsfile`.
5. For a private repository over HTTPS, add a **Username with password** credential with your GitHub username and a token with repository read access as the password. Select it in the SCM configuration and save the job.

The branch is a job setting, not a restriction enforced by the pipeline. Only configure source you trust to execute commands on this host.

### Add the Discord credential

In your Discord server, open **Server Settings → Integrations → Webhooks**, create a webhook, and select the destination channel. In Jenkins, open **Manage Jenkins → Credentials → System → Global credentials → Add Credentials**. Choose **Secret text**, paste the webhook URL, and set the ID to **`discord-webhook-url`**.

The pipeline binds this credential as `DISCORD_WEBHOOK_URL` only during notification. The supplied scripts do not write it into reports, model prompts, or application images. Anyone able to change the trusted pipeline can change how credentials are used, so this binding is not isolation from repository code.

A missing credential or ordinary delivery failure marks an otherwise successful build `UNSTABLE`, preserving a worse existing result. It does not undo a deployment. The channel receives build metadata, a review summary, and up to three findings; choose a channel appropriate for that information.

## Run the first build

Click **Build Now** once. Running the Jenkinsfile registers `pollSCM('H/5 * * * *')`: Jenkins checks the selected branch for changes every five minutes at a job-specific offset and builds when it finds changes. No GitHub webhook setup is required for this trigger.

The default model is `qwen2.5-coder:1.5b`. Model preparation waits for Ollama and downloads the model only if it is absent; later builds reuse the model volume. Follow the build console and inspect its archived reports after completion.

After deployment, verify the default application endpoint:

```sh
curl http://localhost:3000/health
```

It returns `status` and the deployed `commit`. Use the [chat example](operations.md#api) to check inference. If you changed `APP_PORT`, substitute that port in host requests. A successful deployment can accompany an `UNSTABLE` build; the [architecture guide](architecture.md#build-results-and-deployment-gates) explains why.

## Local trust boundary

Jenkins runs as its own container user, but its Docker socket mount allows it to create and control containers on the host. Matching `DOCKER_GID` fixes access permissions; it does not reduce that authority. Treat access to the Jenkins administrator account and the source branch as access to the Docker host.

Compose binds Jenkins and the application to loopback. The application itself has no authentication, TLS, or rate limiting, and a direct `npm start` listens on `0.0.0.0:3000`. This is a local laboratory configuration. Hosting it for other users requires separate decisions about access control, transport security, build isolation, and persistent-data backups.

Continue with [architecture](architecture.md), [AI review](ai-review.md), or [configuration, deployment, and recovery](operations.md).
