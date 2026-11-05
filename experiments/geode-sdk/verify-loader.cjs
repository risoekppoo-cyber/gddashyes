/* Regression check: the game uses a CDN <base>, but SDK scripts are local. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname,'../../index.html'),'utf8');
const code = html.match(/<script id="westminster-experiment-loader">([\s\S]*?)<\/script>/)[1];
const assetBase = html.match(/<base href="([^"]+)"/)[1];
function resolve(page, expected) {
  const writes = [];
  vm.runInNewContext(code, {URL, URLSearchParams,window:{location:new URL(page)}, document:{write: s => writes.push(s)}});
  const scripts = [...writes.join('').matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => new URL(m[1],assetBase).href);
  assert.deepEqual(scripts,expected);
}
const base = 'https://risoekppoo-cyber.github.io/gddashyes/';
resolve(base+'index.html?sdkmenu=1&quality=low',[
  base+'experiments/hook-prototype.js',base+'experiments/geode-sdk/menu-runtime.js']);
resolve(base+'?hooktest=1',[base+'experiments/hook-prototype.js']);
resolve(base+'index.html',[]);
resolve(base+'index.html?sdkmenu=1&binarygeode=1&rev=binary1',[
  base+'experiments/hook-prototype.js?rev=binary1',base+'experiments/geode-sdk/menu-runtime.js?rev=binary1']);
// A clone served from another path must also load its own scripts.
resolve('http://localhost:8000/clone/?sdkmenu=1',[
  'http://localhost:8000/clone/experiments/hook-prototype.js',
  'http://localhost:8000/clone/experiments/geode-sdk/menu-runtime.js']);
const guard = html.match(/<script id="westminster-experiment-check">([\s\S]*?)<\/script>/)[1];
for (const ready of [false,true]) {
  const nodes = [], window = {location:new URL(base+'?sdkmenu=1')};
  if (ready) {
    window.GDHookPrototype = {enabled:true,instantiate(){}};
    window.WestminsterSdkReport = {status:'PREPARING'};
  }
  vm.runInNewContext(guard,{URLSearchParams,window,document:{
    createElement:()=>({style:{},setAttribute(){}}),body:{appendChild:n=>nodes.push(n)}
  }});
  assert.equal(nodes.length,ready?0:1);
  assert.equal(!!window.WestminsterExperimentLoadFailed,!ready);
}
console.log('PASS: page-local script URLs ignore the CDN asset base; alternate paths work; missing SDK code displays an error; normal game skips the experiment.');
