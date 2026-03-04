param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [string]$Region = 'asia-east1',
  [string]$Repo = 'pegn-ai',
  [string]$ApiService = 'pegn-api',
  [string]$SyncService = 'pegn-sync',
  [string]$WebService = 'pegn-web',
  [string]$Tag = '',
  [string]$ServerEnvFile = 'apps/server/.env.cloudrun',
  [int]$ApiMinInstances = 0,
  [int]$ApiMaxInstances = 10,
  [int]$SyncMinInstances = 0,
  [int]$SyncMaxInstances = 5,
  [int]$WebMinInstances = 0,
  [int]$WebMaxInstances = 5
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Tag)) {
  $Tag = Get-Date -Format 'yyyyMMdd-HHmmss'
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw 'gcloud CLI is not installed. Install Google Cloud SDK first: https://cloud.google.com/sdk/docs/install'
}

Write-Host "[1/8] Set gcloud project: $ProjectId"
gcloud config set project $ProjectId | Out-Null

Write-Host '[2/8] Enable required APIs'
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com | Out-Null

Write-Host "[3/8] Ensure Artifact Registry repo exists: $Repo"
$repoExists = $true
try {
  gcloud artifacts repositories describe $Repo --location $Region | Out-Null
} catch {
  $repoExists = $false
}
if (-not $repoExists) {
  gcloud artifacts repositories create $Repo --repository-format=docker --location=$Region --description='Pegn AI images' | Out-Null
}

$serverImage = "$Region-docker.pkg.dev/$ProjectId/$Repo/server:$Tag"
$webImage = "$Region-docker.pkg.dev/$ProjectId/$Repo/web:$Tag"

Write-Host '[4/8] Build server image with Cloud Build'
gcloud builds submit . `
  --config deploy/cloudrun/cloudbuild.server.yaml `
  --substitutions "_REGION=$Region,_REPO=$Repo,_TAG=$Tag"

$serverEnvArgs = @(
  '--set-env-vars',
  "API_PORT=8080,ENABLE_SYNC_SERVER=false"
)
if (Test-Path $ServerEnvFile) {
  $serverEnvArgs = @('--env-vars-file', $ServerEnvFile, '--set-env-vars', 'API_PORT=8080,ENABLE_SYNC_SERVER=false')
}

Write-Host "[5/8] Deploy API service: $ApiService"
gcloud run deploy $ApiService `
  --image $serverImage `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --port 8080 `
  --min-instances $ApiMinInstances `
  --max-instances $ApiMaxInstances `
  @serverEnvArgs

$apiUrl = (gcloud run services describe $ApiService --region $Region --format 'value(status.url)').Trim()
if ([string]::IsNullOrWhiteSpace($apiUrl)) {
  throw 'Failed to resolve API URL after deployment.'
}

Write-Host "[6/8] Deploy Sync service: $SyncService"
gcloud run deploy $SyncService `
  --image $serverImage `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --port 8080 `
  --command node `
  --args dist/sync-server.js `
  --min-instances $SyncMinInstances `
  --max-instances $SyncMaxInstances `
  --set-env-vars "SYNC_PORT=8080"

$syncHttpUrl = (gcloud run services describe $SyncService --region $Region --format 'value(status.url)').Trim()
if ([string]::IsNullOrWhiteSpace($syncHttpUrl)) {
  throw 'Failed to resolve Sync URL after deployment.'
}
$syncWsUrl = $syncHttpUrl -replace '^https://', 'wss://' -replace '^http://', 'ws://'
$apiWsUrl = ($apiUrl -replace '^https://', 'wss://' -replace '^http://', 'ws://') + '/ws'

Write-Host '[7/8] Build web image with deployed API/Sync URLs'
gcloud builds submit . `
  --config deploy/cloudrun/cloudbuild.web.yaml `
  --substitutions "_REGION=$Region,_REPO=$Repo,_TAG=$Tag,_VITE_API_URL=$apiUrl,_VITE_SYNC_URL=$syncWsUrl,_VITE_WS_URL=$apiWsUrl"

Write-Host "[8/8] Deploy web service: $WebService"
gcloud run deploy $WebService `
  --image $webImage `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --port 80 `
  --min-instances $WebMinInstances `
  --max-instances $WebMaxInstances

$webUrl = (gcloud run services describe $WebService --region $Region --format 'value(status.url)').Trim()

Write-Host ''
Write-Host '✅ Deployment complete'
Write-Host "WEB : $webUrl"
Write-Host "API : $apiUrl"
Write-Host "SYNC: $syncWsUrl"
