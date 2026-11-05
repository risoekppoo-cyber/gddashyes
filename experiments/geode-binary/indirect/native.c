/* Native Win64 DLL fixture, compiled with Control Flow Guard calls. */
typedef unsigned long long u64;
typedef u64 (*Function)(void*);
void* __guard_dispatch_icall_fptr=(void*)0x180a527b0ULL;
__declspec(dllexport) u64 callback(void* hook) {
    return ((u64*)(*(u64**)hook))[5] ^ 0xa5ULL;
}
__declspec(dllexport) u64 entry(void* hook, Function getAddress) {
    Function target=(Function)getAddress(hook);
    return target(hook)+7ULL;
}
