/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/@litertjs/wasm-utils@2.5.3/dist/index.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
async function i(t){if(typeof importScripts=="function")importScripts(t.toString());else{const e=document.createElement("script");return e.src=t.toString(),e.crossOrigin="anonymous",new Promise((r,n)=>{e.addEventListener("load",()=>{r()},!1),e.addEventListener("error",o=>{n(o)},!1),document.body.appendChild(e)})}}var a=async(t,e,r,n,o)=>{if(e&&await i(e),!self.ModuleFactory)throw new Error("ModuleFactory not set.");if(r&&(await i(r),!self.ModuleFactory))throw new Error("ModuleFactory not set.");if(self.Module&&o){const l=self.Module;l.locateFile=o.locateFile,o.mainScriptUrlOrBlob&&(l.mainScriptUrlOrBlob=o.mainScriptUrlOrBlob)}const s=await self.ModuleFactory(self.Module||o);return self.ModuleFactory=self.Module=void 0,new t(s,n)};export{a as createWasmLib};
//# sourceMappingURL=/sm/355ffd76bb59c282ec23ef7b0f11bef8dcf815fff2c8858e17b547aa25d0690d.map