@echo off
chcp 65001 >nul
title Gestione Link Clienti — Agro-VPD Monitor
cd /d "%~dp0"
python execution\gestisci_clienti.py
if %errorlevel% neq 0 (
    echo.
    echo [ERRORE] Impossibile avviare il pannello Gestione Clienti.
    pause
)
