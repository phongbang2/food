@echo off
cd /d "%~dp0"
pyw collector_gui.py
if errorlevel 1 pause
