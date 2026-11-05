#pragma once
#include <Geode/loader/Hook.hpp>
#include <stdexcept>

// New target-specific implementation behind the retained upstream Hook API.
// The complete upstream Loader/Mod ownership graph is not ported here.
extern "C" unsigned ws_hook_create(uint32_t address, void (*detour)(uint32_t), int priority);
extern "C" void ws_hook_remove(uint32_t address, unsigned handle);
extern "C" void ws_hook_priority(uint32_t address, unsigned handle, int priority);

class geode::Hook::Impl final {
public:
    Hook* m_self = nullptr;
    void* m_address;
    void* m_detour;
    std::string m_displayName;
    std::optional<std::string> m_modifyClassName;
    tulip::hook::HandlerMetadata m_handlerMetadata;
    tulip::hook::HookMetadata m_hookMetadata;
    unsigned m_handle = 0;
    bool m_autoEnable = true;

    Impl(void* address, void* detour, std::string name,
         tulip::hook::HandlerMetadata handler, tulip::hook::HookMetadata hook)
      : m_address(address), m_detour(detour), m_displayName(std::move(name)),
        m_handlerMetadata(std::move(handler)), m_hookMetadata(hook) {}
    ~Impl() { if (m_handle) ws_hook_remove(getAddress(), m_handle); }
    static std::shared_ptr<Hook> create(void* address, void* detour, std::string name,
         tulip::hook::HandlerMetadata handler, tulip::hook::HookMetadata hook) {
        auto impl = std::make_shared<Impl>(address, detour, std::move(name), std::move(handler), hook);
        return std::shared_ptr<Hook>(new Hook(std::move(impl)), [](Hook* h) { delete h; });
    }
    Mod* getOwner() const { return nullptr; }
    bool isEnabled() const { return m_handle != 0; }
    geode::Result<> enable() {
        if (!m_handle) m_handle = ws_hook_create(getAddress(), reinterpret_cast<void (*)(uint32_t)>(m_detour), m_hookMetadata.m_priority);
        if (!m_handle) return geode::Err("WebAssembly hook adapter rejected target");
        return geode::Ok();
    }
    geode::Result<> disable() { if (m_handle) ws_hook_remove(getAddress(), m_handle); m_handle = 0; return geode::Ok(); }
    geode::Result<> toggle() { return toggle(!isEnabled()); }
    geode::Result<> toggle(bool on) { return on ? enable() : disable(); }
    bool getAutoEnable() const { return m_autoEnable; }
    void setAutoEnable(bool value) { m_autoEnable = value; }
    uintptr_t getAddress() const { return reinterpret_cast<uintptr_t>(m_address); }
    std::string_view getDisplayName() const { return m_displayName; }
    matjson::Value getRuntimeInfo() const { throw std::runtime_error("Geode IPC runtime info is not implemented in this SDK subset"); }
    tulip::hook::HookMetadata getHookMetadata() const { return m_hookMetadata; }
    void setHookMetadata(tulip::hook::HookMetadata value) {
        m_hookMetadata = value;
        if (m_handle) ws_hook_priority(getAddress(), m_handle, value.m_priority);
    }
    int32_t getPriority() const { return m_hookMetadata.m_priority; }
    void setPriority(int32_t value) { setHookMetadata({value}); }
    std::optional<std::string_view> getModifyClassName() const {
        if (m_modifyClassName) return *m_modifyClassName;
        return std::nullopt;
    }
    void setModifyClassName(std::string value) { m_modifyClassName = std::move(value); }
};
