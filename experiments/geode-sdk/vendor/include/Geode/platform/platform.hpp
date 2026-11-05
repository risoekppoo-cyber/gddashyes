#pragma once
#define GEODE_IS_WASM
#define GEODE_PLATFORM_NAME "WebAssembly"
#define GEODE_DLL
#define GEODE_API extern "C" __attribute__((visibility("default")))
#define GEODE_EXPORT __attribute__((visibility("default")))
#define GEODE_NO_UNIQUE_ADDRESS [[no_unique_address]]
