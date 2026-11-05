#include <cstdint>

// A separately compiled C++ plugin for this experiment, NOT a .geode package.
// Its imported API is an adapter to real upstream TulipHook APIs in engine.cpp.
extern "C" {
void wm_next(uint32_t);
int wm_read_rax(uint32_t);
void wm_write_rax(uint32_t, int);
unsigned wm_add_hook(void (*)(uint32_t), int);
void wm_remove_hook(unsigned);
void wm_priority(unsigned, int);
}
namespace {
unsigned addHandle = 0, multiplyHandle = 0;
void add120(uint32_t cpu) {
    wm_next(cpu);
    wm_write_rax(cpu, wm_read_rax(cpu) + 120);
}
void multiply2(uint32_t cpu) {
    wm_next(cpu);
    wm_write_rax(cpu, wm_read_rax(cpu) * 2);
}
}
extern "C" int wm_mod_install() {
    addHandle = wm_add_hook(add120, 0);
    return addHandle != 0;
}
extern "C" int wm_mod_control(int command) {
    switch (command) {
    case 0: if (addHandle) wm_remove_hook(addHandle); addHandle = 0; break;
    case 1: if (!addHandle) addHandle = wm_add_hook(add120, 0); break;
    case 2: if (!multiplyHandle) multiplyHandle = wm_add_hook(multiply2, 10); break;
    case 3: if (multiplyHandle) wm_priority(multiplyHandle, -10); break;
    case 4: if (multiplyHandle) wm_remove_hook(multiplyHandle); multiplyHandle = 0; break;
    default: return 0;
    }
    return 1;
}
