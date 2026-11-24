@echo off
chcp 65001 >nul
title Server Test Locale — Agro-VPD Monitor
cd /d "%~dp0\site"
echo Avvio server locale su http://localhost:8090 ...
start "" "http://localhost:8090"
python -m http.server 8090

