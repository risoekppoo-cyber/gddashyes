#include "Pool.hpp"
#include <tulip/TulipHook.hpp>
#include <tulip/platform/DefaultConvention.hpp>
#include <emscripten.h>
#include <dlfcn.h>
#include <cstdint>
#include <string>
using namespace tulip::hook;
namespace {
using Callback = void (*)(uint32_t);
void* commonHandler = nullptr;
void* mod = nullptr;
std::string error;
bool supported(uint32_t a) { return a == 0x8720c0 || a == 0x717680; }
}
EM_JS(void, original_menu, (uint32_t cpu), {Module.bridge.original(0x8720c0, cpu);});
EM_JS(void, original_getter, (uint32_t cpu), {Module.bridge.original(0x717680, cpu);});
extern "C" {
EMSCRIPTEN_KEEPALIVE int ws_init() {
    auto r = disableRuntimeIntervening(&commonHandler);
    if (r.isErr()) { error = r.unwrapErr(); return 0; }
    return commonHandler != nullptr;
}
EMSCRIPTEN_KEEPALIVE unsigned ws_hook_create(uint32_t address, Callback fn, int priority) {
    if (!supported(address) || !commonHandler) return 0;
    auto r = createHandler(reinterpret_cast<void*>(address), HandlerMetadata{
        DefaultConvention::create(), AbstractFunction::from<void(uint32_t)>()});
    if (r.isErr()) { error = r.unwrapErr(); return 0; }
    return createHook(r.unwrap(), reinterpret_cast<void*>(fn), HookMetadata{priority});
}
EMSCRIPTEN_KEEPALIVE void ws_hook_remove(uint32_t address, unsigned handle) { removeHook(address, handle); }
EMSCRIPTEN_KEEPALIVE void ws_hook_priority(uint32_t address, unsigned handle, int priority) {
    updateHookMetadata(address, handle, HookMetadata{priority});
}
EMSCRIPTEN_KEEPALIVE void ws_next(uint32_t address, uint32_t cpu) {
    if (!supported(address)) return;
    auto original = address == 0x8720c0 ? &original_menu : &original_getter;
    auto fn = Pool::get().getCommonHandler(reinterpret_cast<void*>(address), address == 0x8720c0 ? 0 : 1,
        0, reinterpret_cast<void*>(original), 0);
    reinterpret_cast<Callback>(fn)(cpu);
    Pool::get().getCommonHandler(nullptr, 0, 0, nullptr, 1);
}
EMSCRIPTEN_KEEPALIVE int ws_load_mod(char const* path) {
    mod = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!mod) { error = dlerror(); return 0; }
    auto entry = reinterpret_cast<int (*)()>(dlsym(mod, "geodeCustomEntry"));
    if (!entry) { error = dlerror(); return 0; }
    return entry();
}
EMSCRIPTEN_KEEPALIVE int ws_test_install() {
    auto fn = mod ? reinterpret_cast<int (*)()>(dlsym(mod, "sdk_test_install")) : nullptr;
    return fn ? fn() : 0;
}
EMSCRIPTEN_KEEPALIVE int ws_test_toggle(int on) {
    auto fn = mod ? reinterpret_cast<int (*)(int)>(dlsym(mod, "sdk_test_toggle")) : nullptr;
    return fn ? fn(on) : 0;
}
EMSCRIPTEN_KEEPALIVE char const* ws_error() { return error.c_str(); }
// Retain DefaultConvention::create for the SDK side module's imported symbol.
EMSCRIPTEN_KEEPALIVE void* ws_default_convention() { return new std::shared_ptr<CallingConvention>(DefaultConvention::create()); }
}
EM_JS(int, ws_read_rax, (uint32_t cpu), {return Module.bridge.readRax(cpu);});
EM_JS(void, ws_write_rax, (uint32_t cpu, int value), {Module.bridge.writeRax(cpu, value);});
EM_JS(int, ws_menu_completed, (uint32_t cpu), {return Module.bridge.menuCompleted(cpu) ? 1 : 0;});
EM_JS(void, ws_label_request, (uint32_t cpu, char const* text), {Module.bridge.label(cpu, UTF8ToString(text));});

// Referenced by the plugin, so these JS imports must also be exported by main.
extern "C" {
EMSCRIPTEN_KEEPALIVE int ws_read(uint32_t c) {return ws_read_rax(c);}
EMSCRIPTEN_KEEPALIVE void ws_write(uint32_t c, int v) {ws_write_rax(c,v);}
EMSCRIPTEN_KEEPALIVE int ws_completed(uint32_t c) {return ws_menu_completed(c);}
EMSCRIPTEN_KEEPALIVE void ws_label(uint32_t c, char const* t) {ws_label_request(c,t);}
}
