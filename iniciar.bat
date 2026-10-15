@echo off
title Clima Huauchinango
cd /d "%~dp0"
start "" http://localhost:3000
echo Servidor de Clima Huauchinango. Deja esta ventana abierta mientras usas la app.
node server.js
pause
