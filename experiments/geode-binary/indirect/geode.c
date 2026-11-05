/* Generated from the pinned Windows DLL's instruction semantics. */
#include <stdint.h>
__attribute__((import_module("env"),import_name("lift_fault")))
void lift_fault(uint32_t code,uint64_t address,uint64_t pc);
static inline uint64_t mask(uint32_t n) {return n==8u?UINT64_MAX:((UINT64_C(1)<<(n*8u))-1u);}
static inline uint64_t sext(uint64_t v,uint32_t n) {uint32_t s=64u-n*8u;return (uint64_t)((int64_t)(v<<s)>>s);}
static inline uint64_t raw_read(uint64_t p,uint32_t n) {
  if(p+n>(uint64_t)__builtin_wasm_memory_size(0)*65536u){lift_fault(2u,p,0);__builtin_trap();}
  uint64_t v=0;for(uint32_t i=0;i<n;i++)v|=(uint64_t)(*(uint8_t*)(uintptr_t)(p+i))<<(i*8u);return v;
}
static inline void raw_write(uint64_t p,uint64_t v,uint32_t n) {
  if(p+n>(uint64_t)__builtin_wasm_memory_size(0)*65536u){lift_fault(2u,p,0);__builtin_trap();}
  for(uint32_t i=0;i<n;i++)*(uint8_t*)(uintptr_t)(p+i)=(uint8_t)(v>>(i*8u));
}
static inline uint64_t guest_read(uint64_t p,uint32_t n,uint32_t base) {
  if(p>UINT32_MAX){lift_fault(3u,p,0);__builtin_trap();}return raw_read(p+base,n);
}
static inline void guest_write(uint64_t p,uint64_t v,uint32_t n,uint32_t base) {
  if(p>UINT32_MAX){lift_fault(3u,p,0);__builtin_trap();}raw_write(p+base,v,n);
}
__attribute__((visibility("default")))
uint32_t lift_run(uint32_t cpu,uint64_t entry,uint64_t image_base,uint32_t guest_base,uint64_t stop,uint32_t limit) {
    raw_write(cpu+192u,entry,8u);
    for(uint32_t step=0;step<limit;step++) {
      uint64_t pc=raw_read(cpu+192u,8u);
      if(pc==stop)return step;
      switch(pc-image_base) {
case UINT64_C(3980816): { /* 0x1803cbe10/3: MOV RCX,qword ptr [RCX] */
uint64_t u_12000=0;
raw_write(cpu+192u,image_base+UINT64_C(3980819),8u);
pc_1803cbe10_op_0: ; 
pc_1803cbe10_op_1: ; u_12000=(guest_read(raw_read(cpu+8u,8u),8u,guest_base))&mask(8u);
pc_1803cbe10_op_2: ; raw_write(cpu+8u,((u_12000&mask(8u))),8u);
pc_1803cbe10_op_3: ; goto next_instruction; }
case UINT64_C(3980819): { /* 0x1803cbe13/5: JMP 0x1803cbe20 */
raw_write(cpu+192u,image_base+UINT64_C(3980824),8u);
pc_1803cbe13_op_0: ; 
pc_1803cbe13_op_1: ; { raw_write(cpu+192u,image_base+UINT64_C(3980832),8u); goto next_instruction; }
pc_1803cbe13_op_2: ; goto next_instruction; }
case UINT64_C(3980832): { /* 0x1803cbe20/4: MOV RAX,qword ptr [RCX + 0x20] */
uint64_t u_4780=0;
uint64_t u_12000=0;
raw_write(cpu+192u,image_base+UINT64_C(3980836),8u);
pc_1803cbe20_op_0: ; 
pc_1803cbe20_op_1: ; u_4780=((raw_read(cpu+8u,8u) + UINT64_C(32)))&mask(8u);
pc_1803cbe20_op_2: ; u_12000=(guest_read((u_4780&mask(8u)),8u,guest_base))&mask(8u);
pc_1803cbe20_op_3: ; raw_write(cpu+0u,((u_12000&mask(8u))),8u);
pc_1803cbe20_op_4: ; goto next_instruction; }
case UINT64_C(3980836): { /* 0x1803cbe24/1: RET  */
raw_write(cpu+192u,image_base+UINT64_C(3980837),8u);
pc_1803cbe24_op_0: ; 
pc_1803cbe24_op_1: ; raw_write(cpu+192u,(guest_read(raw_read(cpu+32u,8u),8u,guest_base)),8u);
pc_1803cbe24_op_2: ; raw_write(cpu+32u,((raw_read(cpu+32u,8u) + UINT64_C(8))),8u);
pc_1803cbe24_op_3: ; raw_write(cpu+192u,raw_read(cpu+192u,8u),8u); goto next_instruction;
pc_1803cbe24_op_4: ; goto next_instruction; }
case UINT64_C(10823600): { /* 0x180a527b0/2: JMP RAX */
raw_write(cpu+192u,image_base+UINT64_C(10823602),8u);
pc_180a527b0_op_0: ; 
pc_180a527b0_op_1: ; raw_write(cpu+192u,raw_read(cpu+0u,8u),8u); goto next_instruction;
pc_180a527b0_op_2: ; goto next_instruction; }
 default: return 0x80000000u|step;
      }
      next_instruction: ;
    }
    lift_fault(4u,raw_read(cpu+192u,8u),entry); __builtin_trap();
}
