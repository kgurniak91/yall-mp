cmake_minimum_required(VERSION 3.15)
cmake_policy(SET CMP0091 NEW)
project(yall_libmpv_poc CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(NODE_ADDON_API_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../node_modules/node-addon-api)

add_library(${PROJECT_NAME} SHARED
  src/addon.cpp
  src/mpv_loader.cpp
  src/d3d11_backend.cpp
  ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

target_include_directories(${PROJECT_NAME} PRIVATE
  ${CMAKE_JS_INC}
  ${NODE_ADDON_API_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/../vendor/mpv-dev/include)
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS _CRT_SECURE_NO_WARNINGS NOMINMAX)
target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB} d3d11 dxgi)
if(MSVC)
  target_compile_options(${PROJECT_NAME} PRIVATE /EHsc)
endif()
