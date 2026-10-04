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
  assert.equal(Core.formatLength(12.4,'mm'),'12.4');
  assert.equal(Core.formatLength(1,'in'),'0.03937');
});

test('fitText aligns actual ink including left and right overhangs',function(){
  const inkMeasure=function(){return{advances:[0,.6],width:1.2,ascent:.7,descent:0,
    bounds:[{left:-.1,right:.7},{left:0,right:.8}]}};
  for(const align of ['left','center','right']){
    const s=state({text:'AV',width:150,height:200,textInset:5,align:align});
    const r=Core.fitText(s,['AV'],inkMeasure,ref),g=r.glyphs[0];
    assert.ok(Math.abs(g.width-140)<1e-6,'visible ink fills the inner width');
    assert.ok(Math.abs(g.xs[0]-.1*r.fontSize-5)<1e-4,'left ink stays inside the inset');
    assert.ok(Math.abs(g.xs[1]+.8*r.fontSize-145)<1e-4,'right ink stays inside the inset');
  }
});

test('fitText ignores inkless spaces and preserves blank-line spacing',function(){
  const inkMeasure=function(){return{advances:[0,.3,.9],width:1.2,ascent:.7,descent:0,
    bounds:[null,{left:0,right:.6},null]}};
  const s=state({text:' A \n   \n A ',lineMode:'multi',width:100,height:500,textInset:0});
  const r=Core.fitText(s,Core.getLines(s),inkMeasure,ref);
  assert.equal(r.glyphs.length,2);
  assert.ok(Math.abs(r.glyphs[0].xs[1])<1e-4);
  assert.ok(Math.abs(r.glyphs[0].width-100)<1e-6);
  assert.equal(Core.fitText(state({text:' \n\t',lineMode:'multi'}),[' ','\t'],measure,ref).empty,true);
});

test('intermediate line ink is included in the height constraint',function(){
  const tallMeasure=function(line){return{advances:[0],width:.6,ascent:line==='X'?3:.7,descent:line==='X'?3:0}};
  const s=state({text:'A\nX\nB',lineMode:'multi',width:1000,height:100,textInset:5,lineSpacing:80});
  const r=Core.fitText(s,['A','X','B'],tallMeasure,ref);
  const middle=r.glyphs[1];
  assert.ok(Math.abs(middle.baseline-3*r.fontSize-5)<1e-4);
  assert.ok(Math.abs(middle.baseline+3*r.fontSize-95)<1e-4);
});

test('negative tracking fits actual bounds even when glyph origins cross',function(){
  const s=state({text:'ABC',width:4,height:50,textInset:0,letterSpacing:-5});
  const r=Core.fitText(s,['ABC'],measure,ref);
  assert.equal(r.trackOverflow,true,'crossed origins cannot fit these ink boxes into 4 mm');
  const fits=Core.fitText(state({text:'ABC',width:10,height:50,textInset:0,letterSpacing:-5}),['ABC'],measure,ref);
  const g=fits.glyphs[0];
  assert.equal(fits.trackOverflow,false);
  for(const x of g.xs){assert.ok(x>=-1e-4&&x+.6*fits.fontSize<=10+1e-4)}
});

test('very small designs do not force an overflowing minimum font size',function(){
  const s=state({text:'A'.repeat(500),width:1,height:1,textInset:0});
  const r=Core.fitText(s,Core.getLines(s),measure,ref);
  assert.ok(r.fontSize<.1);
  assert.ok(r.glyphs[0].width<=1+1e-9);
});
