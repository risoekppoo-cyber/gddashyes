import assert from 'node:assert/strict';
import {GuestInput,BrowserModifiers} from '../experiments/geode-binary/windows-input.mjs';
const target=new EventTarget(),input=new BrowserModifiers(target);
function event(type,alt=false){const e=new Event(type);e.getModifierState=key=>key==='Alt'&&alt;target.dispatchEvent(e);}
event('keydown',true);assert.equal(input.read(18),0x8001);assert.equal(input.read(18),0x8000);event('keyup');assert.equal(input.read(18),0);
event('keydown',true);event('blur');assert.equal(input.read(18),1);assert.equal(input.read(18),0);assert.throws(()=>input.read(65),/Unsupported/);
const memory=new WebAssembly.Memory({initial:1}),v=new DataView(memory.buffer),s=new GuestInput(memory,{GetAsyncKeyState:123,ceilf:139},{input});
v.setBigUint64(4096+8,18n,true);v.setBigUint64(4096+32,9000n,true);v.setBigUint64(9000,321n,true);input.set(18,true);s.invoke(4096,123n);assert.equal(v.getBigUint64(4096,true),0x8001n);assert.equal(v.getBigUint64(4096+192,true),321n);
for(const value of [1.25,-1.25,-0.25,-0,0,Infinity,-Infinity,NaN]){v.setFloat32(4096+512,value,true);v.setBigUint64(4096+32,9000n,true);s.invoke(4096,139n);assert.ok(Object.is(v.getFloat32(4096+512,true),Math.ceil(value)));}
s.releaseHeap();event('keydown',true);assert.equal(input.read(18),0);
console.log('PASS: browser modifier transitions, pressed latch, focus loss, guest return and listener cleanup');
