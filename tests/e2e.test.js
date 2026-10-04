'use strict';
/* Browser smoke tests. Run with `npm run test:e2e` (needs Playwright + Chromium). */
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const http=require('node:http');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'..');
let url,server,browser,page,errors;

test.before(async function(){
  // Exercise the same HTTP origin as GitHub Pages; also works in browsers
  // whose managed policy disables file:// navigation.
  server=http.createServer(function(req,res){
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
    fs.readFile(file,function(error,data){
      if(error){res.writeHead(404);res.end();return}
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
      res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);
    });
  });
  await new Promise(function(resolve){server.listen(0,'127.0.0.1',resolve)});
  url='http://127.0.0.1:'+server.address().port+'/';
  const executablePath=process.env.CHROMIUM_PATH||undefined;
  browser=await chromium.launch(executablePath?{executablePath:executablePath}:{});
});
test.after(async function(){if(browser)await browser.close();if(server)await new Promise(function(resolve){server.close(resolve)})});
test.beforeEach(async function(){
  const context=await browser.newContext({viewport:{width:1300,height:900},acceptDownloads:true});
  page=await context.newPage();errors=[];
  page.on('pageerror',function(e){errors.push(e.message)});
  await page.goto(url);
  await page.waitForFunction(function(){return document.querySelectorAll('#printRoot .print-sheet').length>0});
});
test.afterEach(async function(){assert.deepEqual(errors,[]);await page.context().close()});

async function setValue(id,value){
  await page.fill('#'+id,String(value));
  await page.waitForTimeout(150);
}

test('default project renders 4 tiled pages with the bundled font',async function(){
  assert.equal(await page.textContent('#metricPages'),'4 A4');
  assert.equal(await page.textContent('#metricSize'),'60 × 12 cm');
  assert.equal(await page.locator('.thumb').count(),4);
  assert.equal(await page.locator('#printRoot .print-sheet:not(.print-map)').count(),4);
  assert.equal(await page.locator('#printRoot .print-map').count(),1,'assembly map is on by default');
  assert.ok(await page.evaluate(function(){return document.fonts.check('400 20px "Black Ops One"')}));
});

test('each printed page crops the design to its own window',async function(){
  const boxes=await page.$$eval('#printRoot .print-sheet:not(.print-map) > svg > svg',function(views){return views.map(function(v){return v.getAttribute('viewBox')})});
  assert.deepEqual(boxes,['0 0 190 277','175 0 190 277','350 0 190 277','525 0 190 277']);
  const ids=await page.$$eval('[id]',function(els){return els.map(function(e){return e.id})});
  assert.equal(new Set(ids).size,ids.length,'no duplicate ids');
});

test('changing size, unit and mode updates the layout',async function(){
  await page.selectOption('#unitSelect','mm');
  await setValue('widthInput',150);await setValue('heightInput',40);
  assert.equal(await page.textContent('#metricPages'),'1 A4');
  await page.selectOption('#orientation','landscape');
  await setValue('widthInput',1000);await setValue('heightInput',300);
  await page.waitForTimeout(100);
  assert.equal(await page.textContent('#metricGrid'),'4 × 2 sütun × satır');
  await page.selectOption('#outputMode','single');
  await page.waitForTimeout(150);
  assert.ok(await page.isVisible('#warningBox'));
  assert.ok(await page.isDisabled('#printBtn'));
});

test('multi-line text and assembly map',async function(){
  await page.click('#lineModeSeg button[data-value="multi"]');
  await page.fill('#textInput','ÜST\nALT');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('#lineCount'),'2 satır');
  assert.equal(await page.locator('#printRoot .print-sheet').count(),5);
  await page.uncheck('#includeMap');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#printRoot .print-sheet').count(),4);
  const text=await page.$$eval('#previewStage text',function(t){return t.map(function(x){return x.textContent})});
  assert.ok(text.includes('ÜST')&&text.includes('ALT'));
});

test('state survives a reload',async function(){
  await page.fill('#textInput','KALICI');
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForFunction(function(){return document.querySelectorAll('#printRoot .print-sheet').length>0});
  assert.equal(await page.inputValue('#textInput'),'KALICI');
});

test('SVG export is real size and embeds the font',async function(){
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#exportSvgBtn')]);
  const file=await download.path();
  const svg=fs.readFileSync(file,'utf8');
  assert.match(svg,/width="600mm"/);
  assert.match(svg,/height="120mm"/);
  assert.match(svg,/@font-face\{font-family:"Black Ops One";font-weight:400;src:url\(data:font\/woff2;base64,/);
  assert.match(svg,/ADVANTAGE SPRING/);
});

test('zoom goes beyond the fitted size',async function(){
  const before=await page.$eval('.full-wrap',function(e){return e.getBoundingClientRect().width});
  await page.click('#zoomIn');await page.click('#zoomIn');
  const after=await page.$eval('.full-wrap',function(e){return e.getBoundingClientRect().width});
  assert.ok(after>before*1.4);
  assert.equal(await page.textContent('#zoomValue'),'150%');
});

test('uploading a font switches to it and keeps it after reload',async function(){
  const src=fs.readFileSync(path.resolve(__dirname,'..','fonts','saira.js'),'utf8');
  const b64=/"400": "([^"]+)"/.exec(src)[1];
  await page.setInputFiles('#fontFile',{name:'MyStencil.woff2',mimeType:'font/woff2',buffer:Buffer.from(b64,'base64')});
  await page.waitForFunction(function(){return /MyStencil\.woff2/.test(document.getElementById('fontStatus').textContent)});
  assert.equal(await page.inputValue('#fontSelect'),'custom');
  await page.reload();
  await page.waitForFunction(function(){return /MyStencil\.woff2/.test(document.getElementById('fontStatus').textContent)});
  assert.equal(await page.inputValue('#fontSelect'),'custom');
});

test('join guides: cut edge on top/left, alignment line on bottom/right',async function(){
  await page.selectOption('#orientation','landscape');
  await page.selectOption('#unitSelect','cm');
  await setValue('widthInput',60);await setValue('heightInput',30);
  await page.waitForTimeout(150);
  const sheets=await page.$$eval('#printRoot .print-sheet:not(.print-map) > svg',function(svgs){
    return svgs.map(function(svg){
      const paths=Array.from(svg.querySelectorAll('path')).map(function(p){return{d:p.getAttribute('d'),stroke:p.getAttribute('stroke')}});
      return{label:svg.getAttribute('aria-label'),
        cut:paths.filter(function(p){return p.stroke==='#c8321c'&&/^M [\d.]+ 0 V|^M 0 [\d.]+ H/.test(p.d)}).map(function(p){return p.d}),
        align:paths.filter(function(p){return p.stroke==='#1b6fa0'&&/^M [\d.]+ 0 V|^M 0 [\d.]+ H/.test(p.d)}).map(function(p){return p.d}),
        text:svg.textContent};
    });
  });
  // landscape: cell 277 x 190, step 262 x 175 -> 3 columns x 2 rows
  assert.equal(sheets.length,6);
  const a1=sheets[0],a2=sheets[1],b2=sheets[4];
  assert.deepEqual(a1.cut,[]);
  assert.deepEqual(a1.align,['M 272 0 V 210','M 0 185 H 297']);
  assert.deepEqual(a2.cut,['M 10 0 V 210']);
  assert.match(a2.text,/KES · A1 üzerine bindir/);
  assert.deepEqual(b2.cut,['M 10 0 V 210','M 0 10 H 297']);
  assert.match(a1.text,/A2 kesim kenarı/);
  assert.match(a1.text,/B1 kesim kenarı/);
});

test('bundled stencil fonts are selectable and flag missing Turkish letters',async function(){
  const ids=await page.$$eval('#fontSelect option',function(o){return o.map(function(x){return x.value})});
  for(const id of ['blackops','bigshoulders','saira','sticknobills','emblema','stardos','usaaf'])assert.ok(ids.includes(id),id);
  await page.fill('#textInput','ŞİŞLİ DOĞU');
  await page.selectOption('#fontSelect','bigshoulders');
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(function(){return document.fonts.check('700 20px "Big Shoulders Stencil"')}));
  assert.ok(!(await page.isDisabled('#weightSelect')),'bold available');
  assert.doesNotMatch(await page.textContent('#fontStatus'),/olmayan karakterler/);
  await page.selectOption('#fontSelect','stardos');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#fontStatus'),/olmayan karakterler: Ş İ Ğ/);
  await page.selectOption('#fontSelect','blackops');
  await page.waitForTimeout(200);
  assert.ok(await page.isDisabled('#weightSelect'),'Black Ops One has a single weight');
});

test('an old saved project with the former 10 mm default moves to 15 mm',async function(){
  await page.evaluate(function(){localStorage.setItem('stencil-maker-project',JSON.stringify({text:'ESKI',overlap:10,font:'stardos'}))});
  await page.reload();
  await page.waitForFunction(function(){return document.querySelectorAll('#printRoot .print-sheet').length>0});
  assert.equal(await page.inputValue('#overlap'),'15');
  assert.equal(await page.inputValue('#fontSelect'),'stardos');
});

test('empty and overflowing artwork cannot print or export blank files',async function(){
  await page.fill('#textInput','   ');
  await page.waitForFunction(function(){return document.getElementById('exportSvgBtn').disabled});
  assert.ok(await page.isDisabled('#printBtn'));
  assert.match(await page.textContent('#warningBox'),/metni boş/);
  assert.equal(await page.locator('#printRoot .print-sheet').count(),0);
  await page.click('#lineModeSeg button[data-value="multi"]');
  await page.fill('#textInput',' \n\t');
  await page.waitForTimeout(100);
  assert.ok(await page.isDisabled('#exportSvgBtn'));
  await page.fill('#textInput','AB');
  await setValue('textInset',70);
  assert.ok(await page.isDisabled('#exportSvgBtn'));
  assert.match(await page.textContent('#warningBox'),/İç payı azalt/);
  await setValue('textInset',5);
  await page.waitForFunction(function(){return !document.getElementById('exportSvgBtn').disabled});
});

test('output revalidates edits that arrive before the debounced preview',async function(){
  await page.evaluate(function(){
    window.printCalls=0;window.print=function(){window.printCalls++};
    const input=document.getElementById('textInput');input.value='';input.dispatchEvent(new Event('input'));
    document.getElementById('printBtn').click();
  });
  await page.waitForFunction(function(){return document.getElementById('printBtn').disabled});
  assert.equal(await page.evaluate(function(){return window.printCalls}),0);
  assert.equal(await page.locator('#printRoot .print-sheet').count(),0);
  await page.fill('#textInput','GEÇERLİ');
  await page.waitForFunction(function(){return !document.getElementById('printBtn').disabled});
  await page.evaluate(function(){
    const input=document.getElementById('textInset');input.value='100';input.dispatchEvent(new Event('input'));
    window.dispatchEvent(new Event('beforeprint'));
  });
  assert.equal(await page.locator('#printRoot .print-sheet').count(),0,'native print cannot use stale sheets');
});

test('SVG remains available when only the A4 page setup is invalid',async function(){
  await page.selectOption('#outputMode','single');
  await page.waitForFunction(function(){return document.getElementById('printBtn').disabled});
  assert.ok(!(await page.isDisabled('#exportSvgBtn')));
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#exportSvgBtn')]);
  assert.match(fs.readFileSync(await download.path(),'utf8'),/width="600mm"/);
});

test('visible ink overhangs fit inside the requested inset',async function(){
  await page.selectOption('#fontSelect','emblema');
  await page.selectOption('#unitSelect','mm');
  await setValue('widthInput',100);await setValue('heightInput',100);
  await page.fill('#textInput','AVT');
  await page.waitForTimeout(100);
  const bounds=await page.evaluate(function(){
    const text=document.querySelector('#previewStage svg > svg text'),group=text.parentNode;
    const ctx=document.createElement('canvas').getContext('2d');
    ctx.font=group.getAttribute('font-weight')+' '+group.getAttribute('font-size')+'px '+group.getAttribute('font-family');ctx.fontKerning='none';
    const xs=text.getAttribute('x').split(' ').map(Number),chars=Array.from(text.textContent);
    return chars.map(function(char,i){const m=ctx.measureText(char);return{left:xs[i]-m.actualBoundingBoxLeft,right:xs[i]+m.actualBoundingBoxRight}});
  });
  // Canvas hinting at a small size may differ slightly from the 1000 px measurement.
  assert.ok(Math.min(...bounds.map(function(b){return b.left}))>=4.8);
  assert.ok(Math.max(...bounds.map(function(b){return b.right}))<=95.2);
});

test('fractional dimensions stay visible when switching units',async function(){
  await page.selectOption('#unitSelect','mm');
  await setValue('widthInput',12.4);await setValue('heightInput',20.25);
  assert.equal(await page.textContent('#metricSize'),'12.4 × 20.25 mm');
  await page.selectOption('#unitSelect','in');
  assert.equal(await page.inputValue('#widthInput'),'0.48819');
  assert.ok(await page.$eval('#widthInput',function(el){return el.validity.valid}));
  await page.selectOption('#unitSelect','mm');
  assert.equal(await page.inputValue('#widthInput'),'12.4');
  assert.equal(await page.inputValue('#heightInput'),'20.25');
});

test('page navigation reflects selection and stops at grid boundaries',async function(){
  assert.ok(await page.isDisabled('#previousPage'));
  for(const code of ['A2','A3','A4']){
    await page.click('#nextPage');assert.match(await page.textContent('#selectedPageCaption'),new RegExp(code));
  }
  assert.ok(await page.isDisabled('#nextPage'));
  assert.equal(await page.locator('.thumb[aria-pressed="true"]').count(),1);
  await page.click('#previousPage');assert.match(await page.textContent('#selectedPageCaption'),/A3/);
  await page.selectOption('#unitSelect','mm');await setValue('widthInput',150);
  assert.match(await page.textContent('#selectedPageCaption'),/A1/);
  assert.ok(await page.isDisabled('#previousPage'));
  assert.ok(await page.isDisabled('#nextPage'));
});

test('fit preview uses the available width on mobile and scrolls when zoomed',async function(){
  // Ubuntu runners default to DejaVu Sans; its wider controls used to force
  // the sidebar's grid track past a 320 px viewport.
  await page.addStyleTag({content:'body{font-family:"DejaVu Sans",sans-serif}'});
  await page.setViewportSize({width:320,height:740});
  await page.waitForTimeout(200);
  const size=await page.evaluate(function(){
    const stage=document.getElementById('previewStage'),style=getComputedStyle(stage);
    return{available:stage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),wrap:document.querySelector('.full-wrap').clientWidth,
      body:document.body.scrollWidth,viewport:innerWidth};
  });
  assert.ok(Math.abs(size.available-size.wrap)<=1);
  assert.equal(size.body,size.viewport);
  await page.click('#zoomIn');await page.click('#zoomIn');
  assert.ok(await page.$eval('#previewStage',function(el){return el.scrollWidth>el.clientWidth}));
});
