// Native methods resolved from the pinned Cocos image's PE exports and checked
// against the translated module's address table. No C++ objects cross memories.
export const COCOS = Object.freeze({
  createLabel: 0x10049150,
  setPosition: 0x10004e60,
  addChild: 0x10002ba0,
  getParent: 0x10003540
});
const BASE = 346225600, PENDING = 346225608, TARGET = 346225616, RESUME = 346324656;
const RETURN = 0x1234fedcn;
export class GuestApi {
  constructor(exports, arena) {
    this.e = exports;
    this.arena = arena || {cpu: exports.malloc(4096), stack: exports.malloc(65536), scratch: exports.malloc(8192)};
    if (Object.values(this.arena).some(x => !x)) throw Error('Could not allocate guest-call arena');
    this.scratchAt = 0;
    this.calls = [];
    this.busy = false;
  }
  view() { return new DataView(this.e.memory.buffer); }
  base() { return this.view().getUint32(BASE,true); }
  guest(linear) { return BigInt((linear-this.base())>>>0); }
  linear(guest) {
    if (guest < 0n || guest > 0xffffffffn) throw Error('Guest pointer is outside mapped 32-bit range');
    const n=Number(guest)+this.base();
    if (n>=this.e.memory.buffer.byteLength) throw Error('Guest pointer is outside game memory');
    return n;
  }
  string(text) {
    const bytes=new TextEncoder().encode(text+'\0');
    const p=this.reserve(bytes.length);
    new Uint8Array(this.e.memory.buffer,p,bytes.length).set(bytes);
    return this.guest(p);
  }
  point(x,y) {
    const p=this.reserve(8),v=this.view();v.setFloat32(p,x,true);v.setFloat32(p+4,y,true);
    return this.guest(p);
  }
  reserve(size) {
    const at=(this.scratchAt+7)&~7;
    if(at+size>8192)throw Error('Guest scratch area exhausted');
    this.scratchAt=at+size;return this.arena.scratch+at;
  }
  call(address,args=[]) {
    if(this.busy)throw Error('Nested guest-call bridge request rejected');
    if(![0x717680,...Object.values(COCOS)].includes(address))throw Error('Native method is not in the checked allowlist');
    this.busy=true;
    const {cpu,stack}=this.arena,top=((stack+65536-256)&~15)-8;
    let v=this.view();
    const saved={pending:v.getBigUint64(PENDING,true),target:v.getBigUint64(TARGET,true),resume:v.getUint32(RESUME,true)};
    try {
      new Uint8Array(this.e.memory.buffer,cpu,4096).fill(0);
      new Uint8Array(this.e.memory.buffer,top,128).fill(0);
      v=this.view();v.setBigUint64(top,RETURN,true);
      v.setBigUint64(cpu+32,this.guest(top),true);v.setBigUint64(cpu+192,BigInt(address),true);
      for(let i=0;i<args.length;i++)v.setBigUint64(cpu+[8,16,64,72][i],BigInt(args[i]),true);
      v.setBigUint64(PENDING,0n,true);v.setBigUint64(TARGET,0n,true);v.setUint32(RESUME,0,true);
      this.e.westminster_dispatch(cpu,BigInt(address));
      let count=0;
      while(this.view().getBigUint64(PENDING,true)!==0n) {
        if(++count>100000)throw Error('Native continuation limit reached');
        this.e.westminster_drain_pending(cpu);
      }
      v=this.view();
      if(v.getBigUint64(cpu+192,true)!==RETURN||v.getBigUint64(cpu+32,true)!==this.guest(top)+8n)
        throw Error('Native call did not complete with the expected return state: 0x'+address.toString(16));
      this.calls.push({address:'0x'+address.toString(16),continuations:count});
      return v.getBigUint64(cpu,true);
    } finally {
      v=this.view();v.setBigUint64(PENDING,saved.pending,true);v.setBigUint64(TARGET,saved.target,true);v.setUint32(RESUME,saved.resume,true);
      this.busy=false;
    }
  }
  addLabel(menu,text) {
    this.scratchAt=0;
    const label=this.call(COCOS.createLabel,[this.string(text),this.string('goldFont.fnt')]);
    if(!label)throw Error('CCLabelBMFont::create returned null');
    this.call(COCOS.setPosition,[label,this.point(284,24)]);
    this.call(COCOS.addChild,[menu,label,1000n,0x574d5344n]);
    if(this.call(COCOS.getParent,[label])!==menu)throw Error('Created label was not attached to the expected menu');
    return {menu:'0x'+menu.toString(16),label:'0x'+label.toString(16),text,parentVerified:true,nativeCalls:this.calls.slice(-4)};
  }
}

// A WASM body can return repeatedly while processing one native invocation.
// A completed native return must match the saved entry stack and return PC.
export class MenuCompletion {
  constructor(memory) {this.memory=memory;this.frames=new Map();this.completed=new Map();}
  before(cpu) {
    if(this.frames.has(cpu))return;
    const v=new DataView(this.memory.buffer),base=v.getUint32(BASE,true),sp=v.getBigUint64(cpu+32,true);
    if(sp>0xffffffffn||Number(sp)+base+8>this.memory.buffer.byteLength)throw Error('Invalid native menu entry stack');
    this.frames.set(cpu,{sp,ret:v.getBigUint64(Number(sp)+base,true),self:v.getBigUint64(cpu+8,true)});
  }
  finished(cpu) {
    const f=this.frames.get(cpu);if(!f)return false;
    const v=new DataView(this.memory.buffer);
    if(v.getBigUint64(cpu+32,true)!==f.sp+8n||v.getBigUint64(cpu+192,true)!==f.ret||v.getBigUint64(PENDING,true)!==0n)return false;
    this.frames.delete(cpu);
    if((v.getBigUint64(cpu,true)&255n)===0n)return false;
    this.completed.set(cpu,f.self);return true;
  }
  take(cpu) {const self=this.completed.get(cpu);this.completed.delete(cpu);return self;}
}
