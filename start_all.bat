@echo off
echo ===================================================
echo Launching SyncLab Full Stack System
echo ===================================================
start "SyncLab Backend" cmd /k "cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
timeout /t 2 /nobreak >nul
start "SyncLab Frontend" cmd /k "cd frontend && npm run dev"
echo.
echo SyncLab is launching:
echo - Backend:  http://127.0.0.1:8000
echo - Frontend: http://localhost:5173
echo.
pause

