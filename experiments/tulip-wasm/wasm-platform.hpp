#pragma once
// Experimental target adapter: no native instruction set or ABI is selected.
// This only permits compilation of TulipHook's portable registry/chain code.
#define TULIP_HOOK_SUPPORTED_PLATFORM 1
#define TULIP_HOOK_DLL
#define TULIP_HOOK_DEFAULT_CONV
#include "target/Target.hpp"
