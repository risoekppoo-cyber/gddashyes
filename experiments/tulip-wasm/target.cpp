#include "target/Target.hpp"
#include "generator/Generator.hpp"
#include <tulip/platform/DefaultConvention.hpp>
#include <cstring>

using namespace tulip::hook;
namespace {
class WasmTarget final : public Target {
public:
    geode::Result<csh> openCapstone() override { return geode::Err("No native disassembler in WebAssembly adapter"); }
    geode::Result<> allocatePage() override { return geode::Err("Native executable pages are unsupported"); }
    geode::Result<uint32_t> getProtection(void*) override { return geode::Ok(uint32_t(0)); }
    geode::Result<> protectMemory(void*, size_t, uint32_t) override { return geode::Ok(); }
    // Used only for the common-handler pointer in this module's own memory.
    geode::Result<> rawWriteMemory(void* to, void const* from, size_t size) override {
        std::memcpy(to, from, size);
        return geode::Ok();
    }
    uint32_t getWritableProtection() override { return 0; }
    std::unique_ptr<BaseGenerator> getGenerator() override { return {}; }
    std::shared_ptr<CallingConvention> createConvention(TulipConvention) noexcept override {
        return DefaultConvention::create();
    }
};
}
Target& Target::get() { static WasmTarget target; return target; }
