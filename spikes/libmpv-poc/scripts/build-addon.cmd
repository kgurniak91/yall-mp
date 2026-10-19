@echo off
rem Builds the spike addon against Electron 44 headers using the VS 2019 Build Tools CMake.
set CM=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe
cd /d %~dp0..
call npx cmake-js compile -d addon --runtime=electron --runtime-version=44.9.0 --arch=x64 --CDNAPI_VERSION=8 -G "Visual Studio 16 2019" --cmake-path "%CM%"
