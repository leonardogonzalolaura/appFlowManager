#!/usr/bin/env pwsh

Write-Host "Compilando backend..." -ForegroundColor Cyan
cd src-tauri
cargo check 2>&1 | Select-String "error" | Select-Object -First 20

if ($LASTEXITCODE -ne 0) {
  Write-Host "Error en backend" -ForegroundColor Red
  exit 1
}

cd ..
Write-Host "Tipo-checkeando frontend..." -ForegroundColor Cyan
npm run typecheck 2>&1 | Select-String "error" | Select-Object -First 20

if ($LASTEXITCODE -ne 0) {
  Write-Host "Error en frontend" -ForegroundColor Red
  exit 1
}

Write-Host "¡Todo compila!" -ForegroundColor Green
