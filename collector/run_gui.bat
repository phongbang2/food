@echo off
cd /d "%~dp0"
echo Dang khoi dong An Sap Sai Gon Food Data Desk...
py collector_gui.py
if errorlevel 1 (
  echo.
  echo Khong the khoi dong ung dung. Hay gui phan loi ben tren de minh sua.
  pause
)
