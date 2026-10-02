const $ = (id) => document.getElementById(id);

const source = $("source");
const scriptName = $("scriptName");
const secret = $("secret");
const chunkSize = $("chunkSize");
const output = $("output");
const inputStats = $("inputStats");
const outputStats = $("outputStats");
const status = $("status");
const copyBtn = $("copy");
const downloadBtn = $("download");

const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(text) {
  return new TextEncoder().encode(text);
}

function base64(bytes) {
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, Math.min(i + step, bytes.length));
    let bin = "";
    for (let j = 0; j < slice.length; j++) bin += String.fromCharCode(slice[j]);
    out += btoa(bin);
  }
  return out;
}

function randomKey(length = 32) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  let s = "";
  for (const n of buf) s += alphabet[n % alphabet.length];
  return s;
}

function xorBytes(bytes, key) {
  const kb = utf8Bytes(key);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ kb[i % kb.length];
  return out;
}

function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) chunks.push(str.slice(i, i + size));
  return chunks;
}

function luaQuote(s) {
  return JSON.stringify(s);
}

function sanitizeName(value) {
  const cleaned = String(value || "locked_script").trim().replace(/[^a-zA-Z0-9_\-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
  return cleaned || "locked_script";
}

function makeLua(chunks, key, name) {
  const vmTag = randomKey(12);
  const varPart = "_" + vmTag.toLowerCase();
  const chunksLua = chunks.map((c) => luaQuote(c)).join(",\n");
  const keyLiteral = luaQuote(key);
  const safeName = luaQuote(name);

  return `-- ${name} | Lua VM Locker\n-- VM-style protected wrapper. Generated locally in your browser.\nlocal ${varPart} = {\n  name=${safeName},\n  key=${keyLiteral},\n  pc=1,\n  data={${chunksLua}}\n}\n\nlocal function ${varPart}_bxor(a,b)\n  if bit32 and bit32.bxor then return bit32.bxor(a,b) end\n  local r=0\n  local p=1\n  for _=1,8 do\n    local aa=a%2\n    local bb=b%2\n    if aa~=bb then r=r+p end\n    a=(a-aa)/2\n    b=(b-bb)/2\n    p=p*2\n  end\n  return r\nend\n\nlocal function ${varPart}_decode64(s)\n  local map={}\n  local alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'\n  for i=1,#alphabet do map[string.byte(alphabet,i)]=i-1 end\n  local out={}\n  local buffer=0\n  local bits=0\n  for i=1,#s do\n    local v=map[string.byte(s,i)]\n    if v then\n      buffer=buffer*64+v\n      bits=bits+6\n      while bits>=8 do\n        bits=bits-8\n        out[#out+1]=string.char(math.floor(buffer/2^bits)%256)\n        buffer=buffer%2^bits\n      end\n    end\n  end\n  return table.concat(out)\nend\n\nlocal function ${varPart}_unmask(blob,key)\n  local out={}\n  local klen=#key\n  for i=1,#blob do\n    local a=string.byte(blob,i)\n    local b=string.byte(key,((i-1)%klen)+1)\n    out[i]=string.char(${varPart}_bxor(a,b))\n  end\n  return table.concat(out)\nend\n\nlocal function ${varPart}_vm()\n  local vm=${varPart}\n  local assembled={}\n  while vm.pc<=#vm.data do\n    local instruction=vm.data[vm.pc]\n    assembled[#assembled+1]=instruction\n    vm.pc=vm.pc+1\n  end\n  local encoded=table.concat(assembled)\n  local masked=${varPart}_decode64(encoded)\n  local source=${varPart}_unmask(masked,vm.key)\n  local fn,err\n  if loadstring then\n    fn,err=loadstring(source,vm.name)\n  elseif load then\n    fn,err=load(source,vm.name,'t')\n  else\n    error('This runtime does not expose loadstring/load',2)\n  end\n  if not fn then error(err,2) end\n  return fn()\nend\n\nreturn ${varPart}_vm()\n`;
}

function updateInputStats() {
  const text = source.value;
  const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
  inputStats.textContent = `${lines.toLocaleString()} lines · ${text.length.toLocaleString()} chars`;
}

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

function protect() {
  const raw = source.value.replace(/^\uFEFF/, "");
  if (!raw.trim()) {
    setStatus("กรุณาวาง Lua script ก่อน", "bad");
    output.value = "";
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    outputStats.textContent = "ยังไม่ได้สร้าง";
    return;
  }

  const key = secret.value.trim() || randomKey(32);
  const size = Math.max(256, Math.min(12000, Number(chunkSize.value) || 4096));
  const bytes = utf8Bytes(raw);
  const masked = xorBytes(bytes, key);
  const encoded = base64(masked);
  const chunks = chunkString(encoded, size);
  const name = sanitizeName(scriptName.value);
  const locked = makeLua(chunks, key, name);

  output.value = locked;
  copyBtn.disabled = false;
  downloadBtn.disabled = false;
  const outLines = locked.split(/\r\n|\r|\n/).length;
  outputStats.textContent = `${outLines.toLocaleString()} lines · ${locked.length.toLocaleString()} chars · ${chunks.length.toLocaleString()} chunks`;
  setStatus("สร้าง Lua แบบ VM-style สำเร็จ — ถอดรหัสครั้งเดียวแล้วส่งให้ loadstring/load", "good");
}

async function copyOutput() {
  if (!output.value) return;
  try {
    await navigator.clipboard.writeText(output.value);
    setStatus("คัดลอกสคริปต์ที่ล็อคแล้วเรียบร้อย", "good");
  } catch {
    output.select();
    document.execCommand("copy");
    setStatus("คัดลอกแล้ว", "good");
  }
}

function downloadOutput() {
  if (!output.value) return;
  const name = sanitizeName(scriptName.value);
  const blob = new Blob([output.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}_locked.lua`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus("บันทึกไฟล์ Lua แล้ว", "good");
}

source.addEventListener("input", updateInputStats);
$("protect").addEventListener("click", protect);
$("copy").addEventListener("click", copyOutput);
$("download").addEventListener("click", downloadOutput);
$("randomKey").addEventListener("click", () => {
  secret.value = randomKey(32);
  setStatus("สร้างรหัสล็อคใหม่แล้ว — ระบบจะฝังไว้ใน output อัตโนมัติ", "good");
});
$("clear").addEventListener("click", () => {
  source.value = "";
  output.value = "";
  outputStats.textContent = "ยังไม่ได้สร้าง";
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  setStatus("ล้างข้อมูลแล้ว");
  updateInputStats();
});

updateInputStats();
