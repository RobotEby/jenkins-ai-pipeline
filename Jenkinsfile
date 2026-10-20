pipeline {
    agent any
    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timeout(time: 45, unit: 'MINUTES')
    }
    triggers { pollSCM('H/5 * * * *') }
    stages {
        stage('Checkout') {
            steps {
                deleteDir()
                script {
                    def revision = checkout scm
                    env.GIT_COMMIT = revision.GIT_COMMIT
                    env.GIT_PREVIOUS_SUCCESSFUL_COMMIT = revision.GIT_PREVIOUS_SUCCESSFUL_COMMIT ?: ''
                    env.APP_IMAGE = "jenkins-ai-pipeline:${env.GIT_COMMIT.take(12)}-${env.BUILD_NUMBER}"
                }
            }
        }
        stage('Testes') {
            steps {
                script { env.TEST_EXIT = sh(script: 'npm run test:ci', returnStatus: true).toString() }
            }
        }
        stage('Preparar modelo') {
            steps {
                catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE', catchInterruptions: false) {
                    timeout(time: 25, unit: 'MINUTES') { sh 'npm run model:prepare' }
                }
            }
        }
        stage('Revisão consultiva') {
            steps {
                catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE', catchInterruptions: false) {
                    timeout(time: 6, unit: 'MINUTES') { sh 'npm run review' }
                }
            }
        }
        stage('Construir imagem') {
            steps {
                script {
                    if (env.TEST_EXIT != '0') { error('Testes reprovados; implantação bloqueada.') }
                }
                sh 'docker build --build-arg APP_COMMIT="$GIT_COMMIT" --tag "$APP_IMAGE" .'
            }
        }
        stage('Validar e implantar') {
            steps { sh 'npm run deploy' }
        }
    }
    post {
        always {
            script {
                catchError(buildResult: 'UNSTABLE', catchInterruptions: false) {
                    if (fileExists('reports/tests.xml')) {
                        def tests = junit testResults: 'reports/tests.xml'
                        env.TEST_SUMMARY = "${tests.totalCount} testes, ${tests.failCount} falhas, ${tests.skipCount} ignorados"
                    }
                }
                catchError(buildResult: 'UNSTABLE', catchInterruptions: false) {
                    timeout(time: 2, unit: 'MINUTES') {
                        withCredentials([string(credentialsId: 'discord-webhook-url', variable: 'DISCORD_WEBHOOK_URL')]) {
                            withEnv(["BUILD_RESULT=${currentBuild.currentResult}"]) {
                                if (fileExists('scripts/notify.js')) {
                                    sh 'set +x\nnode scripts/notify.js'
                                } else {
                                    sh '''set +x
node -e 'const u=new URL(process.env.DISCORD_WEBHOOK_URL);u.searchParams.set("wait","true");fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(10000),body:JSON.stringify({content:"CI/CD: "+process.env.BUILD_RESULT+". Checkout não concluído. "+process.env.BUILD_URL,allowed_mentions:{parse:[]}})}).then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{console.error("Notificação não entregue.");process.exitCode=1})'
'''
                                }
                            }
                        }
                    }
                }
                archiveArtifacts artifacts: 'reports/**', allowEmptyArchive: true
            }
        }
    }
}
