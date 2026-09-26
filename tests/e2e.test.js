'use strict';
/* Browser smoke tests. Run with `npm run test:e2e` (needs Playwright + Chromium). */
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');

const url='file://'+path.resolve(__dirname,'..','index.html');
let browser,page,errors;

test.before(async function(){
  const executablePath=process.env.CHROMIUM_PATH||undefined;
  browser=await chromium.launch(executablePath?{executablePath:executablePath}:{});
});
test.after(async function(){await browser.close()});
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
  assert.ok(await page.evaluate(function(){return document.fonts.check('400 20px "Stardos Stencil"')}));
});

test('each printed page crops the design to its own window',async function(){
  const boxes=await page.$$eval('#printRoot .print-sheet:not(.print-map) > svg > svg',function(views){return views.map(function(v){return v.getAttribute('viewBox')})});
  assert.deepEqual(boxes,['0 0 190 277','180 0 190 277','360 0 190 277','540 0 190 277']);
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
  assert.match(svg,/@font-face\{font-family:"Stardos Stencil"/);
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
  const src=fs.readFileSync(path.resolve(__dirname,'..','js','fonts.js'),'utf8');
  const b64=/700:'([^']+)'/.exec(src)[1];
  await page.setInputFiles('#fontFile',{name:'MyStencil.ttf',mimeType:'font/ttf',buffer:Buffer.from(b64,'base64')});
  await page.waitForFunction(function(){return /MyStencil\.ttf/.test(document.getElementById('fontStatus').textContent)});
  assert.equal(await page.inputValue('#fontSelect'),'custom');
  await page.reload();
  await page.waitForFunction(function(){return /MyStencil\.ttf/.test(document.getElementById('fontStatus').textContent)});
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
  // landscape: cell 277 x 190, step 267 x 180 -> 3 columns x 2 rows
  assert.equal(sheets.length,6);
  const a1=sheets[0],a2=sheets[1],b2=sheets[4];
  assert.deepEqual(a1.cut,[]);
  assert.deepEqual(a1.align,['M 277 0 V 210','M 0 190 H 297']);
  assert.deepEqual(a2.cut,['M 10 0 V 210']);
  assert.match(a2.text,/KES · A1 üzerine bindir/);
  assert.deepEqual(b2.cut,['M 10 0 V 210','M 0 10 H 297']);
  assert.match(a1.text,/A2 kesim kenarı/);
  assert.match(a1.text,/B1 kesim kenarı/);
});
