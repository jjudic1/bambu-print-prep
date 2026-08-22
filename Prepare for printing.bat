@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem Do NOT set chcp 65001 here. The UTF-8 code page silently breaks "set /p":
rem every menu answer below reads back empty, so the script ignores whatever the
rem user types and quietly uses the defaults. Verified on this machine.

set "PREP=.venv\Scripts\python.exe"
if not exist "%PREP%" (
    echo.
    echo   The Python environment is missing.
    echo   Run this once in PowerShell, in this folder:
    echo.
    echo     py -m venv .venv
    echo     .venv\Scripts\python.exe -m pip install -r requirements.txt -e .
    echo.
    pause
    exit /b 1
)

echo ============================================
echo   Get a model ready to print
echo ============================================
echo.

rem ---- 1. which model ----------------------------------------------------
set "model=%~1"
if not defined model (
    echo Drag your model INTO THIS WINDOW, then press Enter.
    echo ^(Or drag it onto this file's icon in Explorer to skip this step.^)
    echo.
    set /p "model=Model file: "
)

if not defined model (
    echo No model given.
    pause
    exit /b 1
)
set "model=!model:"=!"

if not exist "!model!" (
    echo Can't find that file: !model!
    pause
    exit /b 1
)

rem ---- 2. which printer, asked once and remembered -----------------------
set "printer="
if exist "my-printer.txt" set /p "printer="<"my-printer.txt"

if not defined printer (
    echo.
    echo Which printer do you have? ^(asked once, then remembered^)
    echo.
    echo   1  Bambu Lab P1S
    echo   2  Bambu Lab P1P
    echo   3  Bambu Lab X1 Carbon
    echo   4  Bambu Lab X1
    echo   5  Bambu Lab X1E
    echo   6  Bambu Lab A1
    echo   7  Bambu Lab A1 mini
    echo.
    set "pick="
    set /p "pick=Number [Enter for 1]: "
    if not defined pick set "pick=1"
    set "pick=!pick: =!"
    set "pick=!pick:"=!"

    if "!pick!"=="1" set "printer=Bambu Lab P1S 0.4 nozzle"
    if "!pick!"=="2" set "printer=Bambu Lab P1P 0.4 nozzle"
    if "!pick!"=="3" set "printer=Bambu Lab X1 Carbon 0.4 nozzle"
    if "!pick!"=="4" set "printer=Bambu Lab X1 0.4 nozzle"
    if "!pick!"=="5" set "printer=Bambu Lab X1E 0.4 nozzle"
    if "!pick!"=="6" set "printer=Bambu Lab A1 0.4 nozzle"
    if "!pick!"=="7" set "printer=Bambu Lab A1 mini 0.4 nozzle"

    if not defined printer (
        echo That wasn't one of the numbers.
        pause
        exit /b 1
    )
    >"my-printer.txt" echo !printer!
    echo.
    echo Saved. Delete my-printer.txt if you ever change printers.
)

rem ---- 3. how big -------------------------------------------------------
echo.
echo How big should it be?
echo.
echo   1  Keychain            ^(about 35 mm^)
echo   2  Desk size           ^(about 100 mm^)
echo   3  As big as it'll print
echo   4  Leave it the size it already is
echo   5  Type an exact size
echo.
set "pick="
set /p "pick=Number [Enter for 2]: "
if not defined pick set "pick=2"
set "pick=!pick: =!"
set "pick=!pick:"=!"

set "sizearg="
if "!pick!"=="1" set "sizearg=--intent keychain"
if "!pick!"=="2" set "sizearg=--intent "desk size""
if "!pick!"=="3" set "sizearg=--intent "as big as it'll print""
if "!pick!"=="4" set "sizearg="
if "!pick!"=="5" (
    echo.
    echo   Longest side. Examples:  80mm    12cm    3in
    set "howbig="
    set /p "howbig=Size: "
    if defined howbig set "sizearg=--size !howbig!"
)

rem ---- 4. run it --------------------------------------------------------
if not exist "output" mkdir "output"
set "out=output\%~n1.3mf"
if "%~n1"=="" (
    for %%F in ("!model!") do set "out=output\%%~nF.3mf"
)

echo.
echo ------------------------------------------------------
"%PREP%" -m prep.cli "!model!" --printer "!printer!" !sizearg! --out "!out!"
set "code=!errorlevel!"
echo ------------------------------------------------------
echo.

if not "!code!"=="0" (
    if "!code!"=="1" (
        echo That model is too big for your printer - run this again and
        echo pick a smaller size.
    ) else (
        echo That model couldn't be prepared. The message above says why.
    )
    pause
    exit /b !code!
)

rem ---- 5. show them where it went ---------------------------------------
echo Your file is ready. Opening the folder now.
echo.
echo Next: upload it to MakerWorld as a PRIVATE model, then print it
echo from the Bambu Handy app on your phone.
echo.
if exist "!out!" (
    explorer /select,"%CD%\!out!"
) else (
    explorer "%CD%\output"
)

pause
