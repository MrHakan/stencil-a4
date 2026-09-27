'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../js/core.js');

const state=function(over){return Core.sanitizeState(Object.assign({},Core.DEFAULTS,over))};

/* Monospace fake font: every character advances 0.6 em, caps are 0.7 em tall. */
function measure(line){
  const chars=Array.from(line);
  return{advances:chars.map(function(_,i){return i*.6}),width:chars.length*.6,ascent:.7,descent:0};
}
const ref={ascent:.7,descent:.2};

test('row names continue after Z',function(){
  assert.equal(Core.rowName(0),'A');
  assert.equal(Core.rowName(25),'Z');
  assert.equal(Core.rowName(26),'AA');
  assert.equal(Core.rowName(27),'AB');
  assert.equal(Core.pageName(1,2),'B3');
});

test('sanitizeState clamps numbers and rejects unknown choices',function(){
  const s=Core.sanitizeState({width:-5,height:'abc',overlap:9999,unit:'ft',weight:'700',text:42,showGuides:'yes'});
  assert.equal(s.width,1);
  assert.equal(s.height,Core.DEFAULTS.height);
  assert.equal(s.overlap,100);
  assert.equal(s.unit,Core.DEFAULTS.unit);
  assert.equal(s.weight,700);
  assert.equal(s.text,Core.DEFAULTS.text);
  assert.equal(s.showGuides,true);
  assert.equal(Core.sanitizeState(null).text,Core.DEFAULTS.text);
});

test('a design that fits the safe area uses one page',function(){
  const info=Core.calculatePages(state({width:190,height:277,pageMargin:10}));
  assert.equal(info.totalPages,1);
  assert.equal(info.cellW,190);
  assert.equal(info.cellH,277);
});

test('tiling accounts for overlap between neighbours',function(){
  // cell 190 x 277, step 175 x 262 in portrait with 10 mm margin and 15 mm overlap
  const info=Core.calculatePages(state({width:600,height:120}));
  assert.equal(info.cols,4); // 190 + 3*175 = 715 >= 600, 190 + 2*175 = 540 < 600
  assert.equal(info.rows,1);
  assert.deepEqual(info.pages.map(function(p){return p.label}),['A1','A2','A3','A4']);
  assert.equal(info.pages[1].x,175);
  const last=info.pages[info.pages.length-1];
  assert.ok(last.x+info.cellW>=600,'last page reaches the design edge');
});

test('landscape changes the grid',function(){
  const info=Core.calculatePages(state({width:600,height:300,orientation:'landscape'}));
  assert.equal(info.cellW,277);
  assert.equal(info.cellH,190);
  assert.equal(info.cols,3);
  assert.equal(info.rows,2);
  assert.equal(info.pages[3].label,'B1');
});

test('single mode centres the design and flags oversized designs',function(){
  const small=Core.calculatePages(state({width:100,height:50,outputMode:'single'}));
  assert.equal(small.totalPages,1);
  assert.equal(small.pages[0].x,(100-190)/2);
  assert.equal(small.tooLargeSingle,false);
  assert.equal(Core.calculatePages(state({width:600,height:50,outputMode:'single'})).tooLargeSingle,true);
});

test('invalid margins and huge designs are reported instead of rendered',function(){
  assert.equal(Core.calculatePages(Object.assign({},Core.DEFAULTS,{pageMargin:50,overlap:150})).invalid,true);
  const huge=Core.calculatePages(state({width:100000,height:100000}));
  assert.equal(huge.tooMany,true);
  assert.equal(huge.pages.length,0);
});

test('fitText fills the width when the box is wide',function(){
  const s=state({text:'ABCDE',width:1000,height:300,textInset:0});
  const r=Core.fitText(s,Core.getLines(s),measure,ref);
  assert.ok(Math.abs(r.glyphs[0].width-1000)<1e-6);
  assert.ok(Math.abs(r.fontSize-1000/3)<1e-6);
  // ink is vertically centred: cap top and baseline are equidistant from the edges
  const top=r.glyphs[0].baseline-.7*r.fontSize;
  assert.ok(Math.abs(top-(300-r.glyphs[0].baseline))<1e-3);
});

test('fitText fills the height when the box is tall',function(){
  const s=state({text:'AB',width:1000,height:100,textInset:10});
  const r=Core.fitText(s,Core.getLines(s),measure,ref);
  assert.ok(Math.abs(r.fontSize*.7-80)<1e-6,'caps fill the 80 mm inner height');
  assert.ok(Math.abs(r.letterHeight-80)<1e-6);
  assert.equal(r.glyphs[0].xs.length,2);
});

test('letter spacing and alignment position every character',function(){
  const s=state({text:'ABC',width:400,height:40,textInset:0,letterSpacing:5,align:'left'});
  const r=Core.fitText(s,Core.getLines(s),measure,ref);
  const xs=r.glyphs[0].xs;
  assert.equal(xs[0],0);
  assert.ok(Math.abs(xs[1]-(.6*r.fontSize+5))<1e-3);
  const right=Core.fitText(state({text:'ABC',width:400,height:40,textInset:0,letterSpacing:5,align:'right'}),['ABC'],measure,ref);
  assert.ok(Math.abs(right.glyphs[0].xs[0]+right.glyphs[0].width-400)<1e-3);
});

test('multi-line text keeps empty lines and fits the total height',function(){
  const s=state({text:'AB\n\nCD',lineMode:'multi',width:10000,height:300,textInset:0,lineSpacing:100});
  const r=Core.fitText(s,Core.getLines(s),measure,ref);
  assert.equal(r.glyphs.length,2);
  const pitch=(r.glyphs[1].baseline-r.glyphs[0].baseline)/2;
  assert.ok(Math.abs(pitch-.9*r.fontSize)<1e-3);
  const inkTop=r.glyphs[0].baseline-.7*r.fontSize,inkBottom=r.glyphs[1].baseline;
  assert.ok(Math.abs(inkBottom-inkTop-300)<1e-3);
});

test('overflow conditions are reported',function(){
  assert.equal(Core.fitText(state({text:'AB',width:10,height:10,textInset:5}),['AB'],measure,ref).textAreaOverflow,true);
  assert.equal(Core.fitText(state({text:'ABCDEFGHIJ',width:50,height:50,textInset:0,letterSpacing:20}),['ABCDEFGHIJ'],measure,ref).trackOverflow,true);
  assert.equal(Core.fitText(state({text:'   '}),Core.getLines(state({text:'   '})),measure,ref).empty,true);
});

test('missingChars lists unsupported characters once',function(){
  assert.deepEqual(Core.missingChars('ŞİŞ  ABC\nĞ','ABC'),['Ş','İ','Ğ']);
  assert.deepEqual(Core.missingChars('AB A','AB'),[]);
});

test('defaults use a 15 mm overlap',function(){
  assert.equal(Core.DEFAULTS.overlap,15);
});

test('formatLength respects units',function(){
  assert.equal(Core.formatLength(600,'cm'),'60');
  assert.equal(Core.formatLength(254,'in'),'10');
  assert.equal(Core.formatLength(12.4,'mm'),'12');
});
