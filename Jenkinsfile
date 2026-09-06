pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'eli0504167101/hotel-backend'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install and Test') {
            steps {
                sh '''
                    docker run --rm \
                      --user "$(id -u):$(id -g)" \
                      -e HOME="$WORKSPACE" \
                      -v jenkins_home:/var/jenkins_home \
                      -w "$WORKSPACE" \
                      node:20 \
                      sh -c 'npm ci --omit=dev && npm test'
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                    docker build \
                      --pull \
                      -t ${DOCKER_IMAGE}:jenkins-${BUILD_NUMBER} \
                      .
                '''
            }
        }

        stage('Security Scan') {
            steps {
                sh '''
                    docker run --rm \
                      -v /var/run/docker.sock:/var/run/docker.sock \
                      -v trivy_cache:/root/.cache/trivy \
                      aquasec/trivy:latest image \
                      --timeout 45m \
                      --severity HIGH,CRITICAL \
                      --exit-code 1 \
                      --scanners vuln \
                      ${DOCKER_IMAGE}:jenkins-${BUILD_NUMBER}
                '''
            }
        }

        stage('Docker Hub Login') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'dockerhub-credentials',
                        usernameVariable: 'DOCKERHUB_USERNAME',
                        passwordVariable: 'DOCKERHUB_TOKEN'
                    )
                ]) {
                    sh '''
                        echo "$DOCKERHUB_TOKEN" | \
                        docker login \
                          -u "$DOCKERHUB_USERNAME" \
                          --password-stdin
                    '''
                }
            }
        }

        stage('Push Docker Image') {
            steps {
                sh '''
                    docker push \
                      ${DOCKER_IMAGE}:jenkins-${BUILD_NUMBER}
                '''
            }
        }
    }

    post {
        always {
            sh 'docker logout || true'
        }
    }
}
