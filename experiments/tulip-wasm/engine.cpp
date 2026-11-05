#include "Pool.hpp"
#include <tulip/TulipHook.hpp>
#include <tulip/platform/DefaultConvention.hpp>
#include <emscripten.h>
#include <dlfcn.h>
#include <climits>
#include <cstdint>
#include <string>

using namespace tulip::hook;
namespace {
constexpr uintptr_t gameAddress = 0x717680;
using Callback = void (*)(uint32_t);
void* commonHandler = nullptr;
std::string lastError;
void* loadedMod = nullptr;
}

// The game and C++ hook engine have separate memories. This deliberately narrow
// adapter supports one controlled i32-valued game getter; it is not a GD SDK ABI.
EM_JS(void, host_original, (uint32_t cpu), { Module.bridge.original(cpu); });
EM_JS(int, host_read_rax, (uint32_t cpu), { return Module.bridge.readRax(cpu); });
EM_JS(void, host_write_rax, (uint32_t cpu, int value), { Module.bridge.writeRax(cpu, value); });

extern "C" {
EMSCRIPTEN_KEEPALIVE int wm_read_rax(uint32_t cpu) { return host_read_rax(cpu); }
EMSCRIPTEN_KEEPALIVE void wm_write_rax(uint32_t cpu, int value) { host_write_rax(cpu, value); }

EMSCRIPTEN_KEEPALIVE void wm_next(uint32_t cpu) {
    auto fn = Pool::get().getCommonHandler(reinterpret_cast<void*>(gameAddress), 0, 0,
                                          reinterpret_cast<void*>(&host_original), 0);
    reinterpret_cast<Callback>(fn)(cpu);
    Pool::get().getCommonHandler(nullptr, 0, 0, nullptr, 1);
}

EMSCRIPTEN_KEEPALIVE unsigned wm_add_hook(Callback fn, int priority) {
    return createHook(gameAddress, reinterpret_cast<void*>(fn), HookMetadata{priority});
}
EMSCRIPTEN_KEEPALIVE void wm_remove_hook(unsigned handle) { removeHook(gameAddress, handle); }
EMSCRIPTEN_KEEPALIVE void wm_priority(unsigned handle, int priority) {
    updateHookMetadata(gameAddress, handle, HookMetadata{priority});
}
EMSCRIPTEN_KEEPALIVE int wm_init() {
    auto disabled = disableRuntimeIntervening(&commonHandler);
    if (disabled.isErr()) { lastError = disabled.unwrapErr(); return 0; }
    auto created = createHandler(reinterpret_cast<void*>(gameAddress), HandlerMetadata{
        DefaultConvention::create(), AbstractFunction::from<void(uint32_t)>()});
    if (created.isErr()) { lastError = created.unwrapErr(); return 0; }
    return commonHandler != nullptr;
}
EMSCRIPTEN_KEEPALIVE int wm_load_mod(char const* path) {
    loadedMod = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!loadedMod) { lastError = dlerror(); return 0; }
    auto install = reinterpret_cast<int (*)()>(dlsym(loadedMod, "wm_mod_install"));
    if (!install) { lastError = dlerror(); return 0; }
    return install();
}
EMSCRIPTEN_KEEPALIVE int wm_mod_command(int command) {
    if (!loadedMod) return 0;
    auto fn = reinterpret_cast<int (*)(int)>(dlsym(loadedMod, "wm_mod_control"));
    return fn ? fn(command) : 0;
}
EMSCRIPTEN_KEEPALIVE char const* wm_error() { return lastError.c_str(); }
}
