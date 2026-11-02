// claude.ai のアーティファクト用に、index.html + css + js を1つのHTMLファイルにまとめる
// 使い方: node tools/build-single.mjs  → dist/liars-table.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const order = ['util', 'engine', 'crypto', 'face', 'textures', 'models', 'avatar', 'audio', 'post', 'net-room', 'net-peer', 'rules', 'world', 'app', 'main'];
const ext = new Map();
let body = '';
for (const name of order) {
  const src = fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8');
  const out = [];
  for (const line of src.split('\n')) {
    const m = line.match(/^import\s+(.+?)\s+from\s+'([^']+)';\s*$/);
    if (m) {
      if (m[2].startsWith('.')) continue;                  // 自前モジュールは連結するので不要
      const key = m[2] + '|' + m[1];
      if (!ext.has(key)) ext.set(key, line);
      continue;
    }
    if (/^export\s*\{[^}]*\};?\s*$/.test(line)) continue;
    out.push(line.replace(/^export\s+(?=(const|let|class|function|async)\b)/, ''));
  }
  body += `\n// ---- ${name}.js ----\n` + out.join('\n');
}
// 外部 import をまとめる（同じモジュールからの名前つき import は統合）
const byMod = new Map();
for (const line of ext.values()) {
  const m = line.match(/^import\s+(.+?)\s+from\s+'([^']+)';/);
  const spec = m[1], mod = m[2];
  if (!byMod.has(mod)) byMod.set(mod, { ns: null, names: new Set() });
  const e = byMod.get(mod);
  if (spec.startsWith('*')) e.ns = spec;
  else spec.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean).forEach(n => e.names.add(n));
}
let imports = '';
for (const [mod, e] of byMod) {
  if (e.ns) imports += `import ${e.ns} from '${mod}';\n`;
  if (e.names.size) imports += `import { ${[...e.names].join(', ')} } from '${mod}';\n`;
}
let js = imports + body;
if (process.argv.includes('--debug')) js += '\nwindow.__lt = App;\n';
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const cfg = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script src="js/config.js"></script>', () => `<script>\n${cfg}\n</script>`);
html = html.replace('<script type="module" src="js/main.js"></script>', () => `<script type="module">\n${js}\n</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const outFile = path.join(root, 'dist', 'liars-table.html');
fs.writeFileSync(outFile, html);
console.log('built', path.relative(root, outFile), (html.length / 1024).toFixed(0) + ' KB');
