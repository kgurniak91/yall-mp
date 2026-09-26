{
  "targets": [
    {
      "target_name": "yall_mpv_embed",
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "vendor"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS",
        "NAPI_VERSION=8"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "conditions": [
        [
          "OS==\"mac\"",
          {
            "sources": ["src/mpv_embed_mac.mm"],
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "11.0",
              "OTHER_CPLUSPLUSFLAGS": ["-fobjc-arc", "-Wall", "-Wextra", "-Wno-unused-parameter"]
            },
            "libraries": [
              "-framework AppKit",
              "-framework Foundation",
              "-framework OpenGL",
              "-framework QuartzCore"
            ]
          },
          {
            "sources": ["src/mpv_embed_stub.cc"]
          }
        ]
      ]
    }
  ]
}
