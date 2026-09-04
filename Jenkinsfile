pipeline {
    agent any

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
                      -t hotel-backend:jenkins-test \
                      .
                '''
            }
        }
    }
}