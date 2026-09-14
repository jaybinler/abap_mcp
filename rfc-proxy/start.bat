@echo off
echo Starting RFC Proxy Service...
cd /d "%~dp0"
python rfc_proxy.py --config config.json
pause
