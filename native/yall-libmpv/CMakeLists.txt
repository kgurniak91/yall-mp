cmake_minimum_required(VERSION 3.20)
cmake_policy(SET CMP0091 NEW)
project(yall_libmpv CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
# Static CRT: the addon must not depend on a VC++ redistributable being installed.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

execute_process(
  COMMAND node -p "require('node-addon-api').include_dir"
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
  OUTPUT_STRIP_TRAILING_WHITESPACE)
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})

set(SOURCES
  src/addon.cpp
  src/core.cpp
  src/core_render.cpp
  src/mpv_loader.cpp
  src/node_convert.cpp
  src/thread_cpu.cpp
  src/render/render_thread.cpp
  src/render/sw_readback.cpp)

if(WIN32)
  list(APPEND SOURCES
    src/render/d3d11_device.cpp
    src/render/d3d11_shared.cpp
    src/render/d3d11_readback.cpp)
endif()

add_library(${PROJECT_NAME} SHARED ${SOURCES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

target_include_directories(${PROJECT_NAME} PRIVATE
  ${CMAKE_JS_INC}
  ${NODE_ADDON_API_DIR}
  # Vendored mpv headers only, never the ones from a mpv-dev archive.
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(${PROJECT_NAME} PRIVATE
  NAPI_VERSION=8
  NAPI_CPP_EXCEPTIONS
  NOMINMAX
  WIN32_LEAN_AND_MEAN
  _CRT_SECURE_NO_WARNINGS)

if(WIN32)
  target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB} d3d11 dxgi)
else()
  find_package(Threads REQUIRED)
  target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB} ${CMAKE_DL_LIBS} Threads::Threads)
endif()

if(MSVC)
  # C4127 fires inside node-addon-api headers.
  target_compile_options(${PROJECT_NAME} PRIVATE /EHsc /W4 /wd4127)
else()
  target_compile_options(${PROJECT_NAME} PRIVATE -Wall -Wextra -fvisibility=hidden)
endif()
