#include <Geode/loader/Hook.hpp>
#include <tulip/platform/DefaultConvention.hpp>
#include <cstdint>

// Uses the actual Geode public Hook API, with an explicit translated-CPU ABI.
// This is a source-ported SDK subset mod, not an unmodified native .geode mod.
extern "C" {
void ws_next(uint32_t address, uint32_t cpu);
int ws_menu_completed(uint32_t cpu);
void ws_label_request(uint32_t cpu, char const* text);
int ws_read_rax(uint32_t cpu);
void ws_write_rax(uint32_t cpu, int value);
}
namespace {
std::shared_ptr<geode::Hook> menuHook, testHook;
void menu(uint32_t cpu) {
    ws_next(0x8720c0, cpu);
    if (ws_menu_completed(cpu)) ws_label_request(cpu, "Geode SDK hook active");
}
void getter(uint32_t cpu) {
    ws_next(0x717680, cpu);
    ws_write_rax(cpu, ws_read_rax(cpu) + 120);
}
std::shared_ptr<geode::Hook> make(uint32_t address, void (*detour)(uint32_t), char const* name) {
    auto handler = tulip::hook::HandlerMetadata{
        tulip::hook::DefaultConvention::create(), tulip::hook::AbstractFunction::from(detour)};
    return geode::Hook::create(reinterpret_cast<void*>(address), reinterpret_cast<void*>(detour), name, handler, {});
}
}
extern "C" int geodeCustomEntry() {
    menuHook = make(0x8720c0, menu, "MenuLayer::init (translated CPU)");
    auto result = menuHook->enable();
    return result.isOk() && menuHook->isEnabled();
}
extern "C" int sdk_test_install() {
    testHook = make(0x717680, getter, "GJBaseGameLayer::getHitboxTrailMax (translated CPU)");
    return testHook->enable().isOk() && testHook->isEnabled();
}
extern "C" int sdk_test_toggle(int on) {
    if (!testHook) return 0;
    return testHook->toggle(on != 0).isOk() && testHook->isEnabled() == (on != 0);
}
