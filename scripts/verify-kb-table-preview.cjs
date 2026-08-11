/* CDP interaction test for knowledge-table-preview.html (v2) */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(__dirname, '../docs/design/knowledge-table/knowledge-table-preview.html');
const PORT = 9335;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/kb-table-cdp-profile3', FILE,
  ], { stdio: 'ignore' });

  let ws;
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch {}
    await sleep(250);
  }
  if (!ws) { console.log('❌ CDP connect failed'); proc.kill(); process.exit(1); }

  let msgId = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));

  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.result && res.result.exceptionDetails) {
      return { err: (res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text) };
    }
    return { val: res.result?.result?.value };
  };
  const clickSel = async (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'MISSING'; el.click(); return 'ok'; })()`);
  const keyOn = async (sel, key, extra = '') => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'MISSING'; el.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true${extra}})); return 'ok'; })()`);
  const headerClick = (ci) => evalJs(`(() => { const th = document.querySelector('thead th[data-col="${ci}"] .th'); th.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:10,clientY:10})); window.dispatchEvent(new PointerEvent('pointerup',{clientX:10,clientY:10})); })()`);
  const check = (name, cond, extra = '') => console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : ''));

  await send('Runtime.enable');
  await sleep(800);
  let r;

  console.log('── 阶段 A：文档管理创建入口 ──');
  r = await evalJs(`document.querySelectorAll('#newMenu').length`);
  check('初始：新建下拉关闭', r.val === 0);
  await clickSel('#newBtn');
  await sleep(150);
  r = await evalJs(`[...document.querySelectorAll('#newMenu .mi')].map(b=>b.textContent.trim()).join('|')`);
  check('下拉包含 新建表格', r.val === '新建文档|新建表格|新建文件夹', r.val);
  await clickSel('[data-action="new-table"]');
  await sleep(150);
  r = await evalJs(`document.querySelector('.naming-input')?.placeholder || 'MISSING'`);
  check('内联命名行出现（placeholder=未命名表格）', r.val === '未命名表格', r.val);
  await evalJs(`(() => { const i = document.querySelector('.naming-input'); i.value = '产品迭代排期'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
  await sleep(400);
  r = await evalJs(`({ editor: !!document.getElementById('gridWrap'), title: document.querySelector('.tname')?.textContent, rows: document.querySelectorAll('tbody tr').length, cols: document.querySelectorAll('thead th[data-col]').length })`);
  check('Enter 后打开表格编辑器', r.val.editor === true);
  check('新表标题正确', r.val.title === '产品迭代排期', r.val.title);
  check('默认空表 3列×3行', r.val.cols === 3 && r.val.rows === 3, `cols=${r.val.cols} rows=${r.val.rows}`);

  // 新表单元格编辑
  await clickSel('td[data-cell="0,0"]');
  await sleep(120);
  await evalJs(`(() => { const i = document.getElementById('cellInput'); i.value = '视觉走查'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
  await sleep(200);
  r = await evalJs(`document.querySelector('td[data-cell="0,0"]')?.textContent.trim()`);
  check('单元格编辑并提交', r.val === '视觉走查', r.val);
  await keyOn('#cellInput', 'Escape');
  await sleep(120);
  await keyOn('td[data-cell="0,0"]', 'Tab');
  await sleep(150);
  r = await evalJs(`document.querySelector('td[data-cell].sel')?.dataset.cell`);
  check('选中态 Tab 换列', r.val === '0,1', r.val);

  // 返回列表：新表已出现
  await clickSel('#edBack');
  await sleep(200);
  r = await evalJs(`[...document.querySelectorAll('.row .rt')].map(e=>e.textContent.trim()).join('|')`);
  check('返回列表，新表在根目录', r.val.includes('产品迭代排期'), r.val);

  console.log('── 阶段 B：预算跟踪 · 编辑器全交互 ──');
  await evalJs(`(() => { const row = [...document.querySelectorAll('.row')].find(r => r.textContent.includes('项目文档')); row.click(); })()`);
  await sleep(150);
  await evalJs(`(() => { const row = [...document.querySelectorAll('.row')].find(r => r.textContent.includes('预算跟踪')); row.click(); })()`);
  await sleep(250);
  r = await evalJs(`document.querySelector('.tname')?.textContent`);
  check('打开已有表格「预算跟踪」', r.val === '预算跟踪', r.val);

  // 列菜单：列0 文本→数字（非法值保留）
  await headerClick(0);
  await sleep(200);
  r = await evalJs(`!!document.querySelector('#pop .menu')`);
  check('点击列头打开列菜单', r.val === true);
  await clickSel('[data-coltype="0,number"]');
  await sleep(200);
  r = await evalJs(`document.querySelector('td[data-cell="0,0"]')?.textContent.trim()`);
  check('文本→数字：非数字值保留原样', r.val === '官网改版', r.val);

  // 排序：列1 预算降序
  await headerClick(1);
  await sleep(200);
  await clickSel('[data-colsort="1,desc"]');
  await sleep(200);
  r = await evalJs(`[...document.querySelectorAll('tbody tr td[data-cell$=",1"]')].map(td=>td.textContent.trim()).join(',')`);
  check('按预算降序', r.val === '200,000,120,000,80,000,60,000,50,000', r.val);

  // 统计行（已支出求和）
  r = await evalJs(`document.querySelector('tfoot tr.stats')?.textContent.replace(/\\s/g,'')`);
  check('统计行 Σ（已支出求和）', (r.val || '').includes('271,100'), r.val);

  // 筛选：状态 = 进行中 → 2 行
  await clickSel('#filterBtn');
  await sleep(150);
  r = await evalJs(`!!document.querySelector('.fp')`);
  check('筛选面板打开', r.val === true);
  await clickSel('[data-fadd]');
  await sleep(150);
  await evalJs(`(() => { const s = document.querySelector('[data-fcol="0"]'); s.value='c4'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await sleep(150);
  await evalJs(`(() => { const s = document.querySelector('[data-fop="0"]'); s.value='eq'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await sleep(150);
  await evalJs(`(() => { const i = document.querySelector('[data-fval="0"]'); i.value='进行中'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(200);
  r = await evalJs(`[...document.querySelectorAll('tbody tr')].length`);
  check('筛选：状态=进行中 → 2 行', r.val === 2, `rows=${r.val}`);
  r = await evalJs(`document.querySelector('#filterBtn .badge')?.textContent`);
  check('筛选徽标显示 1', r.val === '1', r.val);
  // 清除筛选
  await clickSel('[data-fclear]');
  await sleep(150);
  await keyOn('document.body', 'Escape');
  await sleep(100);

  // ⌘Z 撤销排序（派发到 #main，沿冒泡路径到达其 keydown 监听器）
  await evalJs(`document.getElementById('main').dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true}))`);
  await sleep(200);
  r = await evalJs(`[...document.querySelectorAll('tbody tr td[data-cell$=",1"]')].map(td=>td.textContent.trim()).join(',')`);
  check('⌘Z 撤销排序恢复原序', r.val === '50,000,120,000,80,000,200,000,60,000', r.val);

  // 添加行
  await clickSel('#addRow');
  await sleep(200);
  r = await evalJs(`document.querySelectorAll('tbody tr').length`);
  check('添加行 → 6 行', r.val === 6, `rows=${r.val}`);

  // 导出 CSV
  r = await evalJs(`(() => { let fired=false; const orig=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download){fired=true;} }; document.getElementById('exportBtn').click(); HTMLAnchorElement.prototype.click=orig; return fired; })()`);
  check('导出 CSV 触发下载', r.val === true);

  // 列宽拖拽
  r = await evalJs(`(() => { const th = document.querySelector('thead th[data-col="0"]'); const res = th.querySelector('.th-resize'); const r0 = th.getBoundingClientRect(); const startX = r0.right - 3; res.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:startX,clientY:100})); window.dispatchEvent(new PointerEvent('pointermove',{clientX:startX+40,clientY:100})); window.dispatchEvent(new PointerEvent('pointerup',{clientX:startX+40,clientY:100})); return document.querySelector('thead th[data-col="0"]').style.width; })()`);
  check('列宽拖拽调整 150→190', r.val === '190px', r.val);

  // 行拖拽移动（第1行 官网改版 → 倒数第二）
  r = await evalJs(`(() => { const g = document.querySelector('[data-grip="0"]'); const r0 = g.getBoundingClientRect(); g.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r0.x,clientY:r0.y})); window.dispatchEvent(new PointerEvent('pointermove',{clientX:r0.x,clientY:r0.y+20})); const last = document.querySelector('tbody tr:last-child').getBoundingClientRect(); window.dispatchEvent(new PointerEvent('pointermove',{clientX:r0.x,clientY:last.top+4})); window.dispatchEvent(new PointerEvent('pointerup',{clientX:r0.x,clientY:last.top+4})); return [...document.querySelectorAll('tbody tr td[data-cell$=",0"]')].map(td=>td.textContent.trim()).join('|'); })()`);
  check('行拖拽移动', r.val === '移动端 App|品牌升级|数据中台|官网改版二期|官网改版|', r.val);

  console.log('── 阶段 C：空态与右键入口 ──');
  await clickSel('#edBack');
  await sleep(150);
  await clickSel('.crumb[data-nav="root"]');
  await sleep(150);
  await evalJs(`(() => { const row = [...document.querySelectorAll('.row')].find(r => r.textContent.includes('归档（空）')); row.click(); })()`);
  await sleep(200);
  r = await evalJs(`[...document.querySelectorAll('.empty [data-action]')].map(b=>b.textContent.trim()).join('|')`);
  check('空态含「新建表格」次按钮', r.val.includes('新建表格'), r.val);
  await clickSel('.empty [data-action="new-table"]');
  await sleep(150);
  r = await evalJs(`document.querySelector('.naming-input')?.placeholder || 'MISSING'`);
  check('空态入口 → 内联命名行', r.val === '未命名表格', r.val);
  await keyOn('.naming-input', 'Escape');
  await sleep(120);
  await evalJs(`(() => { document.getElementById('browseBody').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:200})); })()`);
  await sleep(150);
  r = await evalJs(`[...document.querySelectorAll('#pop .mi')].map(b=>b.textContent.trim()).join('|')`);
  check('右键菜单含「新建表格」', r.val.includes('新建表格'), r.val);
  await keyOn('document.body', 'Escape');
  await sleep(100);

  // 主题 / 演示
  await clickSel('#themeBtn');
  r = await evalJs(`document.documentElement.dataset.theme`);
  check('深色主题切换', r.val === 'dark', r.val);
  await clickSel('#demoBtn');
  await sleep(400);
  r = await evalJs(`document.querySelector('.demo-glow') !== null`);
  check('自动演示启动', r.val === true);

  console.log('\n✅ 全部交互链路验证完成');
  proc.kill();
  process.exit(0);
}

main().catch((e) => { console.error('❌ test crashed:', e); process.exit(1); });
