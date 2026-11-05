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
case UINT64_C(4096): { /* 0x1001000/3: MOV RCX,qword ptr [RCX] */
uint64_t u_12000=0;
raw_write(cpu+192u,image_base+UINT64_C(4099),8u);
pc_1001000_op_0: ; 
pc_1001000_op_1: ; u_12000=(guest_read(raw_read(cpu+8u,8u),8u,guest_base))&mask(8u);
pc_1001000_op_2: ; raw_write(cpu+8u,((u_12000&mask(8u))),8u);
pc_1001000_op_3: ; goto next_instruction; }
case UINT64_C(4099): { /* 0x1001003/5: MOV EAX,0xa5 */
raw_write(cpu+192u,image_base+UINT64_C(4104),8u);
pc_1001003_op_0: ; 
pc_1001003_op_1: ; raw_write(cpu+0u,(UINT64_C(165)),8u);
pc_1001003_op_2: ; goto next_instruction; }
case UINT64_C(4104): { /* 0x1001008/4: XOR RAX,qword ptr [RCX + 0x28] */
uint64_t u_4780=0;
uint64_t u_12000=0;
uint64_t u_2c280=0;
uint64_t u_2c300=0;
uint64_t u_2c380=0;
raw_write(cpu+192u,image_base+UINT64_C(4108),8u);
pc_1001008_op_0: ; 
pc_1001008_op_1: ; u_4780=((raw_read(cpu+8u,8u) + UINT64_C(40)))&mask(8u);
pc_1001008_op_2: ; raw_write(cpu+2560u,(UINT64_C(0)),1u);
pc_1001008_op_3: ; raw_write(cpu+2571u,(UINT64_C(0)),1u);
pc_1001008_op_4: ; u_12000=(guest_read((u_4780&mask(8u)),8u,guest_base))&mask(8u);
pc_1001008_op_5: ; raw_write(cpu+0u,((raw_read(cpu+0u,8u) ^ (u_12000&mask(8u)))),8u);
pc_1001008_op_6: ; raw_write(cpu+2567u,(((int64_t)sext(raw_read(cpu+0u,8u),8u) < (int64_t)sext(UINT64_C(0),8u))),1u);
pc_1001008_op_7: ; raw_write(cpu+2566u,((raw_read(cpu+0u,8u) == UINT64_C(0))),1u);
pc_1001008_op_8: ; u_2c280=((raw_read(cpu+0u,8u) & UINT64_C(255)))&mask(8u);
pc_1001008_op_9: ; u_2c300=(__builtin_popcountll((u_2c280&mask(8u))))&mask(1u);
pc_1001008_op_10: ; u_2c380=(((u_2c300&mask(1u)) & UINT64_C(1)))&mask(1u);
pc_1001008_op_11: ; raw_write(cpu+2562u,(((u_2c380&mask(1u)) == UINT64_C(0))),1u);
pc_1001008_op_12: ; goto next_instruction; }
case UINT64_C(4108): { /* 0x100100c/1: RET  */
raw_write(cpu+192u,image_base+UINT64_C(4109),8u);
pc_100100c_op_0: ; 
pc_100100c_op_1: ; raw_write(cpu+192u,(guest_read(raw_read(cpu+32u,8u),8u,guest_base)),8u);
pc_100100c_op_2: ; raw_write(cpu+32u,((raw_read(cpu+32u,8u) + UINT64_C(8))),8u);
pc_100100c_op_3: ; raw_write(cpu+192u,raw_read(cpu+192u,8u),8u); goto next_instruction;
pc_100100c_op_4: ; goto next_instruction; }
case UINT64_C(4112): { /* 0x1001010/1: PUSH RSI */
uint64_t u_27d80=0;
raw_write(cpu+192u,image_base+UINT64_C(4113),8u);
pc_1001010_op_0: ; 
pc_1001010_op_1: ; u_27d80=(raw_read(cpu+48u,8u))&mask(8u);
pc_1001010_op_2: ; raw_write(cpu+32u,((raw_read(cpu+32u,8u) - UINT64_C(8))),8u);
pc_1001010_op_3: ; guest_write(raw_read(cpu+32u,8u),(u_27d80&mask(8u)),8u,guest_base);
pc_1001010_op_4: ; goto next_instruction; }
case UINT64_C(4113): { /* 0x1001011/4: SUB RSP,0x20 */
uint64_t u_2c280=0;
uint64_t u_2c300=0;
uint64_t u_2c380=0;
raw_write(cpu+192u,image_base+UINT64_C(4117),8u);
pc_1001011_op_0: ; 
pc_1001011_op_1: ; raw_write(cpu+2560u,((raw_read(cpu+32u,8u) < UINT64_C(32))),1u);
pc_1001011_op_2: ; raw_write(cpu+2571u,((((raw_read(cpu+32u,8u)^UINT64_C(32))&(raw_read(cpu+32u,8u)^(raw_read(cpu+32u,8u)-UINT64_C(32))))>>63)&1u),1u);
pc_1001011_op_3: ; raw_write(cpu+32u,((raw_read(cpu+32u,8u) - UINT64_C(32))),8u);
pc_1001011_op_4: ; raw_write(cpu+2567u,(((int64_t)sext(raw_read(cpu+32u,8u),8u) < (int64_t)sext(UINT64_C(0),8u))),1u);
pc_1001011_op_5: ; raw_write(cpu+2566u,((raw_read(cpu+32u,8u) == UINT64_C(0))),1u);
pc_1001011_op_6: ; u_2c280=((raw_read(cpu+32u,8u) & UINT64_C(255)))&mask(8u);
pc_1001011_op_7: ; u_2c300=(__builtin_popcountll((u_2c280&mask(8u))))&mask(1u);
pc_1001011_op_8: ; u_2c380=(((u_2c300&mask(1u)) & UINT64_C(1)))&mask(1u);
pc_1001011_op_9: ; raw_write(cpu+2562u,(((u_2c380&mask(1u)) == UINT64_C(0))),1u);
pc_1001011_op_10: ; goto next_instruction; }
case UINT64_C(4117): { /* 0x1001015/3: MOV RAX,RDX */
raw_write(cpu+192u,image_base+UINT64_C(4120),8u);
pc_1001015_op_0: ; 
pc_1001015_op_1: ; raw_write(cpu+0u,(raw_read(cpu+16u,8u)),8u);
pc_1001015_op_2: ; goto next_instruction; }
case UINT64_C(4120): { /* 0x1001018/3: MOV RSI,RCX */
raw_write(cpu+192u,image_base+UINT64_C(4123),8u);
pc_1001018_op_0: ; 
pc_1001018_op_1: ; raw_write(cpu+48u,(raw_read(cpu+8u,8u)),8u);
pc_1001018_op_2: ; goto next_instruction; }
case UINT64_C(4123): { /* 0x100101b/6: CALL qword ptr [0x1003000] */
uint64_t u_3cc00=0;
raw_write(cpu+192u,image_base+UINT64_C(4129),8u);
pc_100101b_op_0: ; 
pc_100101b_op_1: ; u_3cc00=(guest_read(image_base+UINT64_C(12288),8u,guest_base))&mask(8u);
pc_100101b_op_2: ; raw_write(cpu+32u,((raw_read(cpu+32u,8u) - UINT64_C(8))),8u);
pc_100101b_op_3: ; guest_write(raw_read(cpu+32u,8u),UINT64_C(16781345),8u,guest_base);
pc_100101b_op_4: ; raw_write(cpu+192u,(u_3cc00&mask(8u)),8u); goto next_instruction;
pc_100101b_op_5: ; goto next_instruction; }
case UINT64_C(4129): { /* 0x1001021/3: MOV RCX,RSI */
raw_write(cpu+192u,image_base+UINT64_C(4132),8u);
pc_1001021_op_0: ; 
pc_1001021_op_1: ; raw_write(cpu+8u,(raw_read(cpu+48u,8u)),8u);
pc_1001021_op_2: ; goto next_instruction; }
case UINT64_C(4132): { /* 0x1001024/6: CALL qword ptr [0x1003000] */
uint64_t u_3cc00=0;
raw_write(cpu+192u,image_base+UINT64_C(4138),8u);
pc_1001024_op_0: ; 
pc_1001024_op_1: ; u_3cc00=(guest_read(image_base+UINT64_C(12288),8u,guest_base))&mask(8u);
pc_1001024_op_2: ; raw_write(cpu+32u,((raw_read(cpu+32u,8u) - UINT64_C(8))),8u);
pc_1001024_op_3: ; guest_write(raw_read(cpu+32u,8u),UINT64_C(16781354),8u,guest_base);
pc_1001024_op_4: ; raw_write(cpu+192u,(u_3cc00&mask(8u)),8u); goto next_instruction;
pc_1001024_op_5: ; goto next_instruction; }
case UINT64_C(4138): { /* 0x100102a/4: ADD RAX,0x7 */
uint64_t u_2c280=0;
uint64_t u_2c300=0;
uint64_t u_2c380=0;
raw_write(cpu+192u,image_base+UINT64_C(4142),8u);
pc_100102a_op_0: ; 
pc_100102a_op_1: ; raw_write(cpu+2560u,(((raw_read(cpu+0u,8u)+UINT64_C(7))&mask(8u))<raw_read(cpu+0u,8u)),1u);
pc_100102a_op_2: ; raw_write(cpu+2571u,(((~(raw_read(cpu+0u,8u)^UINT64_C(7))&(raw_read(cpu+0u,8u)^(raw_read(cpu+0u,8u)+UINT64_C(7))))>>63)&1u),1u);
pc_100102a_op_3: ; raw_write(cpu+0u,((raw_read(cpu+0u,8u) + UINT64_C(7))),8u);
pc_100102a_op_4: ; raw_write(cpu+2567u,(((int64_t)sext(raw_read(cpu+0u,8u),8u) < (int64_t)sext(UINT64_C(0),8u))),1u);
pc_100102a_op_5: ; raw_write(cpu+2566u,((raw_read(cpu+0u,8u) == UINT64_C(0))),1u);
pc_100102a_op_6: ; u_2c280=((raw_read(cpu+0u,8u) & UINT64_C(255)))&mask(8u);
pc_100102a_op_7: ; u_2c300=(__builtin_popcountll((u_2c280&mask(8u))))&mask(1u);
pc_100102a_op_8: ; u_2c380=(((u_2c300&mask(1u)) & UINT64_C(1)))&mask(1u);
pc_100102a_op_9: ; raw_write(cpu+2562u,(((u_2c380&mask(1u)) == UINT64_C(0))),1u);
pc_100102a_op_10: ; goto next_instruction; }
case UINT64_C(4142): { /* 0x100102e/4: ADD RSP,0x20 */
uint64_t u_2c280=0;
uint64_t u_2c300=0;
uint64_t u_2c380=0;
raw_write(cpu+192u,image_base+UINT64_C(4146),8u);
pc_100102e_op_0: ; 
pc_100102e_op_1: ; raw_write(cpu+2560u,(((raw_read(cpu+32u,8u)+UINT64_C(32))&mask(8u))<raw_read(cpu+32u,8u)),1u);
pc_100102e_op_2: ; raw_write(cpu+2571u,(((~(raw_read(cpu+32u,8u)^UINT64_C(32))&(raw_read(cpu+32u,8u)^(raw_read(cpu+32u,8u)+UINT64_C(32))))>>63)&1u),1u);
pc_100102e_op_3: ; raw_write(cpu+32u,((raw_read(cpu+32u,8u) + UINT64_C(32))),8u);
pc_100102e_op_4: ; raw_write(cpu+2567u,(((int64_t)sext(raw_read(cpu+32u,8u),8u) < (int64_t)sext(UINT64_C(0),8u))),1u);
pc_100102e_op_5: ; raw_write(cpu+2566u,((raw_read(cpu+32u,8u) == UINT64_C(0))),1u);
pc_100102e_op_6: ; u_2c280=((raw_read(cpu+32u,8u) & UINT64_C(255)))&mask(8u);
pc_100102e_op_7: ; u_2c300=(__builtin_popcountll((u_2c280&mask(8u))))&mask(1u);
pc_100102e_op_8: ; u_2c380=(((u_2c300&mask(1u)) & UINT64_C(1)))&mask(1u);
pc_100102e_op_9: ; raw_write(cpu+2562u,(((u_2c380&mask(1u)) == UINT64_C(0))),1u);
pc_100102e_op_10: ; goto next_instruction; }
case UINT64_C(4146): { /* 0x1001032/1: POP RSI */
uint64_t u_55480=0;
raw_write(cpu+192u,image_base+UINT64_C(4147),8u);
pc_1001032_op_0: ; 
pc_1001032_op_1: ; u_55480=(UINT64_C(0))&mask(8u);
pc_1001032_op_2: ; u_55480=(guest_read(raw_read(cpu+32u,8u),8u,guest_base))&mask(8u);
pc_1001032_op_3: ; raw_write(cpu+32u,((raw_read(cpu+32u,8u) + UINT64_C(8))),8u);
pc_1001032_op_4: ; raw_write(cpu+48u,((u_55480&mask(8u))),8u);
pc_1001032_op_5: ; goto next_instruction; }
case UINT64_C(4147): { /* 0x1001033/1: RET  */
raw_write(cpu+192u,image_base+UINT64_C(4148),8u);
pc_1001033_op_0: ; 
pc_1001033_op_1: ; raw_write(cpu+192u,(guest_read(raw_read(cpu+32u,8u),8u,guest_base)),8u);
pc_1001033_op_2: ; raw_write(cpu+32u,((raw_read(cpu+32u,8u) + UINT64_C(8))),8u);
pc_1001033_op_3: ; raw_write(cpu+192u,raw_read(cpu+192u,8u),8u); goto next_instruction;
pc_1001033_op_4: ; goto next_instruction; }
 default: return 0x80000000u|step;
      }
      next_instruction: ;
    }
    lift_fault(4u,raw_read(cpu+192u,8u),entry); __builtin_trap();
}
