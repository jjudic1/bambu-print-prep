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
rem One folder per model, holding exactly the three files that belong
rem together. The user is about to be told "send all of these to the iPad", so
rem what opens must contain those three and nothing else -- not every model
rem they have ever prepared.
rem
rem Pass the FOLDER, not a filename: the tool names the file itself and puts
rem the finished size in it ("dragon-80mm.3mf"), which is what the user needs
rem three prints later when Files shows them a list (spec 6.5). It decides
rem folder-vs-file by asking whether the path exists as a directory, so the
rem mkdir below is required, not tidiness. No trailing backslash either --
rem "output\" reaches the tool as an escaped quote and eats the argument.
for %%F in ("!model!") do set "name=%%~nF"
if not exist "output" mkdir "output"
if not exist "output\!name!" mkdir "output\!name!"
set "out=output\!name!"

set "extra="

:run
echo.
echo ------------------------------------------------------
"%PREP%" -m prep.cli "!model!" --printer "!printer!" !sizearg! !extra! --out "!out!"
set "code=!errorlevel!"
echo ------------------------------------------------------
echo.

rem Exit 4 means the model is usable but far too detailed. Offer to simplify
rem rather than dead-ending, which is what spec 5.1 asks for.
if "!code!"=="4" if not defined extra (
    echo This model has far more detail than a printer can use.
    set "yn="
    set /p "yn=Simplify it and carry on? [Y/n]: "
    if /i not "!yn!"=="n" (
        set "extra=--simplify"
        goto run
    )
)

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
rem Three files, and they are only useful together: the model, its picture, and
rem the page explaining what to do with both. Spec 6.5 is the weakest link in
rem the whole product, so it ships beside the model rather than scrolling past
rem in a console window nobody keeps.
echo Your file is ready. Opening the folder now.
echo.
echo There are three things in there. Send ALL of them to the iPad
echo - the model, its picture, and "how to print this".
echo.
echo Open "how to print this" on the iPad and follow it. It is the
echo same steps every time, so keep it.
echo.
explorer "%CD%\!out!"

pause
