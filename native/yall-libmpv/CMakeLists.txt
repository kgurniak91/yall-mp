cmake_minimum_required(VERSION 3.20)
cmake_policy(SET CMP0091 NEW)
project(yall_libmpv CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
# Static CRT: the addon must not depend on a VC++ redistributable being installed.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Windows/macOS load libmpv in-process through the N-API addon. Linux runs it in a separate
# host executable (libmpv cannot share a process with Electron's bundled ffmpeg).
if(UNIX AND NOT APPLE)
  option(YALL_BUILD_ADDON "Build the N-API addon" OFF)
  option(YALL_BUILD_HOST "Build the out-of-process libmpv host" ON)
  option(YALL_BUILD_FDPASS "Build the yall_fdpass N-API addon (descriptor receiver for the host)" OFF)
else()
  option(YALL_BUILD_ADDON "Build the N-API addon" ON)
  option(YALL_BUILD_HOST "Build the out-of-process libmpv host" OFF)
  set(YALL_BUILD_FDPASS OFF)
endif()

find_package(Threads REQUIRED)

# yall_core: everything that does not depend on Node, shared by the addon and the host.
if(APPLE)
  enable_language(OBJCXX)
  set(CMAKE_OBJCXX_STANDARD 17)
  set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)
endif()

set(CORE_SOURCES
  src/event_msg.cpp
  src/live_counts.cpp
  src/mpv_loader.cpp
  src/node_value.cpp
  src/thread_cpu.cpp
  src/render/render_thread.cpp
  src/render/sw_readback.cpp)

if(WIN32)
  list(APPEND CORE_SOURCES
    src/render/d3d11_device.cpp
    src/render/d3d11_shared.cpp
    src/render/d3d11_readback.cpp)
endif()

if(APPLE)
  list(APPEND CORE_SOURCES src/render/iosurface_shared.mm)
endif()

# Linux dma-buf backend: building needs only the EGL and GBM headers (the libraries are dlopen'ed at run time),
# so a build machine without them still produces a readback-only host.
set(YALL_HAVE_DMABUF OFF)
if(UNIX AND NOT APPLE)
  include(CheckIncludeFileCXX)
  check_include_file_cxx(EGL/egl.h YALL_HAS_EGL_H)
  check_include_file_cxx(gbm.h YALL_HAS_GBM_H)
  if(YALL_HAS_EGL_H AND YALL_HAS_GBM_H)
    set(YALL_HAVE_DMABUF ON)
    list(APPEND CORE_SOURCES src/render/egl_context.cpp src/render/dmabuf_shared.cpp)
  else()
    message(STATUS "EGL/GBM headers not found: building without the dma-buf backend")
  endif()
endif()

add_library(yall_core STATIC ${CORE_SOURCES})
set_target_properties(yall_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(yall_core PUBLIC
  # Vendored mpv headers only, never the ones from a mpv-dev archive.
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(yall_core PUBLIC
  NOMINMAX
  WIN32_LEAN_AND_MEAN
  _CRT_SECURE_NO_WARNINGS)
if(WIN32)
  target_link_libraries(yall_core PUBLIC d3d11 dxgi)
elseif(APPLE)
  target_link_libraries(yall_core PUBLIC ${CMAKE_DL_LIBS} Threads::Threads
    "-framework OpenGL" "-framework IOSurface" "-framework CoreFoundation")
else()
  target_link_libraries(yall_core PUBLIC ${CMAKE_DL_LIBS} Threads::Threads)
  if(YALL_HAVE_DMABUF)
    target_compile_definitions(yall_core PUBLIC YALL_HAVE_DMABUF=1)
  endif()
endif()
if(MSVC)
  target_compile_options(yall_core PRIVATE /EHsc /W4 /wd4127)
else()
  target_compile_options(yall_core PRIVATE -Wall -Wextra -fvisibility=hidden)
endif()

if(YALL_BUILD_ADDON)
  execute_process(
    COMMAND node -p "require('node-addon-api').include_dir"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE)
  string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})

  set(ADDON_SOURCES
    src/addon.cpp
    src/core.cpp
    src/core_render.cpp
    src/node_convert.cpp)

  add_library(${PROJECT_NAME} SHARED ${ADDON_SOURCES} ${CMAKE_JS_SRC})
  set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

  target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_JS_INC}
    ${NODE_ADDON_API_DIR})
  target_compile_definitions(${PROJECT_NAME} PRIVATE
    NAPI_VERSION=8
    NAPI_CPP_EXCEPTIONS)

  target_link_libraries(${PROJECT_NAME} PRIVATE yall_core ${CMAKE_JS_LIB})

  if(MSVC)
    # C4127 fires inside node-addon-api headers.
    target_compile_options(${PROJECT_NAME} PRIVATE /EHsc /W4 /wd4127)
  else()
    target_compile_options(${PROJECT_NAME} PRIVATE -Wall -Wextra -fvisibility=hidden)
  endif()
endif()

if(YALL_BUILD_HOST)
  add_executable(yall-mpv-host
    host/main.cpp
    host/fd_sender.cpp
    host/host_core.cpp
    host/protocol.cpp
    host/socket_sink.cpp)
  target_include_directories(yall-mpv-host PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/host
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party)
  target_link_libraries(yall-mpv-host PRIVATE yall_core)
  target_compile_options(yall-mpv-host PRIVATE -Wall -Wextra -fvisibility=hidden)
  # The host runs on the user's distro next to its libmpv: no libstdc++ version coupling with the build machine.
  target_link_options(yall-mpv-host PRIVATE -static-libstdc++ -static-libgcc)
endif()

# Linux: receives the descriptors of the host's dma-buf slots in the Electron main process. It does not link
# libmpv or ffmpeg, which is why it may live there. Built with cmake-js against the Electron headers.
if(YALL_BUILD_FDPASS)
  execute_process(
    COMMAND node -p "require('node-addon-api').include_dir"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE)
  string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})

  add_library(yall_fdpass SHARED fdpass/yall_fdpass.cpp ${CMAKE_JS_SRC})
  set_target_properties(yall_fdpass PROPERTIES PREFIX "" SUFFIX ".node")
  target_include_directories(yall_fdpass PRIVATE ${CMAKE_JS_INC} ${NODE_ADDON_API_DIR})
  target_compile_definitions(yall_fdpass PRIVATE NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS)
  target_link_libraries(yall_fdpass PRIVATE Threads::Threads ${CMAKE_JS_LIB})
  target_compile_options(yall_fdpass PRIVATE -Wall -Wextra -fvisibility=hidden)
endif()
