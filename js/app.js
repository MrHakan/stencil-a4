(function(){
  'use strict';
  const Core=window.StencilCore;
  const MM_PER=Core.MM_PER;
  const SVG='http://www.w3.org/2000/svg';
  const STORAGE_KEY='stencil-maker-project';
  const IMPORTED_FAMILY='ImportedStencil';
  const FALLBACK_FONT='blackops';
  const Fonts=window.StencilFonts;
  const INK='#111820';

  const $=function(id){return document.getElementById(id)};

  let state=Object.assign({},Core.DEFAULTS);
  let imported=null; // {blob,name,url}
  let localUsaafFamily='';
  let pageInfo=Core.calculatePages(state);
  let layout=null;
  let selectedPage=0;
  let previewMode='full';
  let zoom=1;
  let renderTimer=null;
  let dbPromise=null;

  /* ---------- storage ---------- */
  function openDB(){
    if(!('indexedDB' in window))return Promise.resolve(null);
    if(dbPromise)return dbPromise;
    dbPromise=new Promise(function(resolve){
      try{
        const req=indexedDB.open('stencil-maker-v1',1);
        req.onupgradeneeded=function(){const d=req.result;if(!d.objectStoreNames.contains('font'))d.createObjectStore('font')};
        req.onsuccess=function(){resolve(req.result)};
        req.onerror=function(){resolve(null)};
      }catch(e){resolve(null)}
    });
    return dbPromise;
  }
  async function dbPut(key,value){
    const db=await openDB();if(!db)return false;
    return new Promise(function(resolve){
      try{const tx=db.transaction('font','readwrite');tx.objectStore('font').put(value,key);tx.oncomplete=function(){resolve(true)};tx.onerror=function(){resolve(false)}}catch(e){resolve(false)}
    });
  }
  async function dbGet(key){
    const db=await openDB();if(!db)return null;
    return new Promise(function(resolve){
      try{const req=db.transaction('font','readonly').objectStore('font').get(key);req.onsuccess=function(){resolve(req.result||null)};req.onerror=function(){resolve(null)}}catch(e){resolve(null)}
    });
  }
  function saveState(){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(Object.assign({v:2},state)));$('saveStatus').textContent='Taslak kaydedildi'}
    catch(e){$('saveStatus').textContent='Bu tarayıcıda kayıt yapılamadı'}
  }
  function loadState(){
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(saved&&typeof saved==='object'){
        if(!saved.v&&saved.overlap===10)saved.overlap=Core.DEFAULTS.overlap; // old default
        state=Core.sanitizeState(saved);
      }
    }catch(e){}
  }

  /* ---------- fonts ---------- */
  function base64ToBytes(b64){const bin=atob(b64),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
  async function registerBundledFonts(){
    const jobs=[];
    Object.keys(Fonts.faces).forEach(function(id){
      const f=Fonts.faces[id];
      Object.keys(f.weights).forEach(function(weight){
        jobs.push((async function(){
          try{const face=new FontFace(f.family,base64ToBytes(f.weights[weight]).buffer,{weight:weight,style:'normal'});await face.load();document.fonts.add(face)}catch(e){}
        })());
      });
    });
    await Promise.all(jobs);
  }
  function bundled(id){return Fonts.faces[id]?Fonts.faces[id]:null}
  function catalogEntry(id){return Fonts.catalog.find(function(c){return c.id===id})||null}
  function populateFontSelect(){
    const sel=$('fontSelect');sel.textContent='';
    const own=document.createElement('optgroup');own.label='Bilgisayardan / yüklenen';
    [['usaaf','USAAF Stencil (bilgisayarda veya yüklenen)'],['custom','Yüklenen font']].forEach(function(o){const opt=document.createElement('option');opt.value=o[0];opt.textContent=o[1];own.appendChild(opt)});
    const inApp=document.createElement('optgroup');inApp.label='Uygulamayla gelen (açık lisans)';
    Fonts.catalog.forEach(function(c){if(!bundled(c.id))return;const opt=document.createElement('option');opt.value=c.id;opt.textContent=c.family;opt.title=c.note;inApp.appendChild(opt)});
    sel.appendChild(inApp);sel.appendChild(own);
  }
  async function loadImportedFont(blob,name){
    const url=URL.createObjectURL(blob);
    try{
      const face=new FontFace(IMPORTED_FAMILY,'url("'+url+'")');await face.load();
      document.fonts.forEach(function(f){if(f.family===IMPORTED_FAMILY||f.family==='"'+IMPORTED_FAMILY+'"')document.fonts.delete(f)});
      document.fonts.add(face);
      if(imported)URL.revokeObjectURL(imported.url);
      imported={blob:blob,name:name||'stencil-font',url:url};
      return true;
    }catch(e){URL.revokeObjectURL(url);return false}
  }
  async function restoreFont(){
    const file=await dbGet('stencil-font');
    if(file&&file.blob)await loadImportedFont(file.blob,file.name);
  }
  /* A missing font falls back to the generic family, so it measures identically to every
     generic base. An installed one differs from at least one of them. */
  function detectUsaaf(){
    const c=document.createElement('canvas').getContext('2d'),test='WMWiiii 0123 ABCDEFG';
    const bases=['monospace','serif','sans-serif'];
    const baseWidths=bases.map(function(b){c.font='100px '+b;return c.measureText(test).width});
    const options=['USAAF_Stencil','USAAF Stencil','USAAF_Serial_Stencil','USAAF Serial Stencil'];
    for(let i=0;i<options.length;i++){
      const found=bases.some(function(b,k){c.font='100px "'+options[i]+'", '+b;return Math.abs(c.measureText(test).width-baseWidths[k])>.5});
      if(found){localUsaafFamily=options[i];return}
    }
  }
  function fontSource(){
    if(state.font==='custom'&&imported)return 'imported';
    if(state.font==='usaaf'&&localUsaafFamily)return 'local';
    if(state.font==='usaaf'&&imported)return 'imported';
    return bundled(state.font)?state.font:FALLBACK_FONT;
  }
  function fontFamily(){
    const src=fontSource();
    return src==='imported'?IMPORTED_FAMILY:src==='local'?localUsaafFamily:bundled(src).family;
  }
  function hasBold(){const f=bundled(fontSource());return !!(f&&f.weights['700'])}
  function fontWeight(){return hasBold()&&Number(state.weight)===700?700:400}
  function cssFont(size){return fontWeight()+' '+size+'px "'+fontFamily()+'"'}

  /* ---------- measuring ---------- */
  function computeLayout(){
    const ctx=document.createElement('canvas').getContext('2d'),S=1000;
    ctx.font=cssFont(S);
    ctx.fontKerning='none';
    function measure(line){
      const chars=Array.from(line),advances=[],bounds=[];let advance=0;
      chars.forEach(function(char){
        const m=ctx.measureText(char);
        advances.push(advance/S);advance+=m.width;
        bounds.push(m.actualBoundingBoxLeft+m.actualBoundingBoxRight>0?
          {left:-m.actualBoundingBoxLeft/S,right:m.actualBoundingBoxRight/S}:null);
      });
      const m=ctx.measureText(line);
      return{advances:advances,bounds:bounds,width:advance/S,ascent:(m.actualBoundingBoxAscent||0)/S,descent:(m.actualBoundingBoxDescent||0)/S};
    }
    const r=ctx.measureText('HÇgj');
    const ref={ascent:(r.actualBoundingBoxAscent||720)/S,descent:(r.actualBoundingBoxDescent||220)/S};
    return Core.fitText(state,Core.getLines(state),measure,ref);
  }

  /* ---------- svg builders ---------- */
  function svgNode(name,attrs){const n=document.createElementNS(SVG,name);if(attrs)Object.keys(attrs).forEach(function(k){n.setAttribute(k,String(attrs[k]))});return n}
  function svgText(attrs,text){const t=svgNode('text',attrs);t.textContent=String(text);return t}

  function drawArtwork(parent){
    if(!layout||layout.empty||!layout.fontSize)return;
    const outline=state.inkMode==='outline';
    const group=svgNode('g',{
      'font-family':'"'+fontFamily()+'"','font-size':Core.round(layout.fontSize,4),'font-weight':fontWeight(),
      'font-kerning':'none','font-variant-ligatures':'none',
      fill:outline?'none':INK,stroke:outline?INK:'none','stroke-width':outline?.42:0,'stroke-linejoin':'round'
    });
    layout.glyphs.forEach(function(g){
      // Explicit positions keep measured ink and tracking consistent in every renderer.
      group.appendChild(svgText({x:g.xs.join(' '),y:g.baseline,'xml:space':'preserve'},g.text));
    });
    parent.appendChild(group);
  }
  function addCross(parent,x,y,size,color){
    parent.appendChild(svgNode('path',{d:'M '+(x-size)+' '+y+' H '+(x+size)+' M '+x+' '+(y-size)+' V '+(y+size),fill:'none',stroke:color||'#30444e','stroke-width':.32}));
  }
  function neighbourLabel(page,dr,dc){
    const r=page.row+dr,c=page.col+dc;
    if(r<0||c<0||r>=pageInfo.rows||c>=pageInfo.cols)return '';
    return Core.pageName(r,c);
  }
  function addTarget(parent,x,y,r,color){
    parent.appendChild(svgNode('circle',{cx:x,cy:y,r:r,fill:'none',stroke:color,'stroke-width':.3}));
    parent.appendChild(svgNode('circle',{cx:x,cy:y,r:r*.35,fill:color}));
    addCross(parent,x,y,r*1.5,color);
  }
  function label(parent,text,x,y,opts){
    const o=opts||{},attrs={x:x,y:y,'font-family':'Arial, sans-serif','font-size':o.size||2.6,'font-weight':700,fill:o.color||'#263943','text-anchor':'middle','dominant-baseline':'central'};
    if(o.rotate)attrs.transform='rotate('+o.rotate+' '+x+' '+y+')';
    parent.appendChild(svgText(attrs,text));
  }
  /* Assembly guides. Each sheet is laid ON TOP of its left and upper neighbours:
     - left/top edge: red cut line at the safe-area edge, the margin outside it is discarded;
     - right/bottom edge: blue line where the next sheet's cut edge must sit;
     - the shared overlap strip carries identical targets on both sheets, so they can be
       matched by eye (or against a window) before gluing. */
  function drawJoinGuides(g,page,info){
    if(!state.showOverlap||state.outputMode!=='tile'||info.totalPages<2)return;
    const m=info.margin,o=info.overlap,cw=info.cellW,ch=info.cellH,pw=info.width,ph=info.height;
    const CUT='#c8321c',ALIGN='#1b6fa0';
    const left=neighbourLabel(page,0,-1),right=neighbourLabel(page,0,1),top=neighbourLabel(page,-1,0),bottom=neighbourLabel(page,1,0);
    const lay=svgNode('g'),lines=svgNode('g'),marks=svgNode('g');
    // Areas to throw away and strips that overlap a neighbour.
    if(left&&m>0)lay.appendChild(svgNode('rect',{x:0,y:0,width:m,height:ph,fill:'#5d6e76','fill-opacity':.14}));
    if(top&&m>0)lay.appendChild(svgNode('rect',{x:left?m:0,y:0,width:left?pw-m:pw,height:m,fill:'#5d6e76','fill-opacity':.14}));
    if(o>0){
      if(left)lay.appendChild(svgNode('rect',{x:m,y:m,width:o,height:ch,fill:CUT,'fill-opacity':.07}));
      if(top)lay.appendChild(svgNode('rect',{x:m,y:m,width:cw,height:o,fill:CUT,'fill-opacity':.07}));
      if(right)lay.appendChild(svgNode('rect',{x:m+cw-o,y:m,width:o,height:ch,fill:ALIGN,'fill-opacity':.07}));
      if(bottom)lay.appendChild(svgNode('rect',{x:m,y:m+ch-o,width:cw,height:o,fill:ALIGN,'fill-opacity':.07}));
    }
    // Cut lines run edge to edge so a ruler can follow them.
    const cut={fill:'none',stroke:CUT,'stroke-width':.45};
    if(left)lines.appendChild(svgNode('path',Object.assign({d:'M '+m+' 0 V '+ph},cut)));
    if(top)lines.appendChild(svgNode('path',Object.assign({d:'M 0 '+m+' H '+pw},cut)));
    const align={fill:'none',stroke:ALIGN,'stroke-width':.45};
    const ax=m+cw-o,ay=m+ch-o;
    if(right){
      lines.appendChild(svgNode('path',Object.assign({d:'M '+ax+' 0 V '+ph},align)));
      [m+ch*.2,m+ch*.5,m+ch*.8].forEach(function(y){lines.appendChild(svgNode('path',{d:'M '+(ax-2.2)+' '+(y-1.6)+' L '+ax+' '+y+' L '+(ax-2.2)+' '+(y+1.6),fill:'none',stroke:ALIGN,'stroke-width':.4}))});
    }
    if(bottom){
      lines.appendChild(svgNode('path',Object.assign({d:'M 0 '+ay+' H '+pw},align)));
      [m+cw*.2,m+cw*.5,m+cw*.8].forEach(function(x){lines.appendChild(svgNode('path',{d:'M '+(x-1.6)+' '+(ay-2.2)+' L '+x+' '+ay+' L '+(x+1.6)+' '+(ay-2.2),fill:'none',stroke:ALIGN,'stroke-width':.4}))});
    }
    // Matching targets inside each overlap strip (same design position on both sheets).
    if(o>=4){
      const r=Math.min(3,o/2-1),fr=[.12,.32,.68,.88];
      if(left)fr.forEach(function(f){addTarget(marks,m+o/2,m+ch*f,r,CUT)});
      if(right)fr.forEach(function(f){addTarget(marks,m+cw-o/2,m+ch*f,r,ALIGN)});
      if(top)fr.forEach(function(f){addTarget(marks,m+cw*f,m+o/2,r,CUT)});
      if(bottom)fr.forEach(function(f){addTarget(marks,m+cw*f,m+ch-o/2,r,ALIGN)});
    }
    // Labels: in the discarded margin for cut lines, inside the strip for alignment lines.
    const inMargin=m>=5;
    if(left)label(marks,'✂ KES · '+left+' üzerine bindir',inMargin?m/2:m+o/2,ph/2,{rotate:-90,color:CUT,size:inMargin?Math.min(3,m*.45):2.4});
    if(top)label(marks,'✂ KES · '+top+' üzerine bindir',pw/2,inMargin?m/2:m+o/2,{color:CUT,size:inMargin?Math.min(3,m*.45):2.4});
    if(right&&o>=4)label(marks,right+' kesim kenarı bu çizgiye ▸',m+cw-o/2,m+ch/2,{rotate:-90,color:ALIGN,size:Math.min(2.6,o*.4)});
    if(bottom&&o>=4)label(marks,bottom+' kesim kenarı bu çizgiye ▾',m+cw/2,m+ch-o/2,{color:ALIGN,size:Math.min(2.6,o*.4)});
    g.appendChild(lay);g.appendChild(lines);g.appendChild(marks);
  }
  function drawSheetGuides(svg,page,info){
    const g=svgNode('g',{'aria-label':'Print guides'}),m=info.margin,pw=info.width,ph=info.height;
    if(state.showGuides){
      g.appendChild(svgNode('rect',{x:m,y:m,width:Math.max(0,info.cellW),height:Math.max(0,info.cellH),fill:'none',stroke:'#7899a8','stroke-width':.25,'stroke-dasharray':'2 1.5'}));
      [[5,5],[pw-5,5],[5,ph-5],[pw-5,ph-5]].forEach(function(p){addCross(g,p[0],p[1],1.3,'#334d58')});
      g.appendChild(svgNode('path',{d:'M '+m+' '+(m-1.7)+' v 3.4 M '+(pw-m)+' '+(m-1.7)+' v 3.4 M '+(m-1.7)+' '+m+' h 3.4 M '+(m-1.7)+' '+(ph-m)+' h 3.4',fill:'none',stroke:'#405d69','stroke-width':.3}));
    }
    drawJoinGuides(g,page,info);
    if(state.showLabels){
      g.appendChild(svgText({x:8,y:6,'font-family':'Arial, sans-serif','font-size':3.1,'font-weight':700,fill:'#263943','letter-spacing':.15},page.label));
    }
    if(state.showRuler&&page.index===0){
      const y=ph-5,x=Math.max(5,m),len=100;
      g.appendChild(svgNode('path',{d:'M '+x+' '+y+' h '+len+' M '+x+' '+(y-1.5)+' v 3 M '+(x+len)+' '+(y-1.5)+' v 3',fill:'none',stroke:'#263943','stroke-width':.38}));
      g.appendChild(svgText({x:x+len+3,y:y+1,'font-family':'Arial, sans-serif','font-size':2.6,fill:'#435963'},'100 mm'));
    }
    svg.appendChild(g);
  }
  function makeSheetSvg(page,info,printable){
    const svg=svgNode('svg',{xmlns:SVG,viewBox:'0 0 '+info.width+' '+info.height,role:'img','aria-label':'A4 sayfa '+page.label,preserveAspectRatio:'xMidYMid meet'});
    svg.appendChild(svgNode('rect',{x:0,y:0,width:info.width,height:info.height,fill:'#fff'}));
    // A nested viewport crops the design to this page's window without needing clipPath ids.
    const view=svgNode('svg',{x:info.margin,y:info.margin,width:info.cellW,height:info.cellH,viewBox:page.x+' '+page.y+' '+info.cellW+' '+info.cellH,overflow:'hidden'});
    drawArtwork(view);svg.appendChild(view);
    drawSheetGuides(svg,page,info);
    if(printable){svg.setAttribute('width',info.width+'mm');svg.setAttribute('height',info.height+'mm')}
    return svg;
  }
  function makeFullSvg(withGuides){
    const W=layout.W,H=layout.H,k=Math.min(W,H);
    const svg=svgNode('svg',{xmlns:SVG,viewBox:'0 0 '+W+' '+H,role:'img','aria-label':'Tam stencil yerleşimi'});
    svg.appendChild(svgNode('rect',{x:0,y:0,width:W,height:H,fill:'#fff'}));
    const view=svgNode('svg',{x:0,y:0,width:W,height:H,viewBox:'0 0 '+W+' '+H,overflow:'hidden'});drawArtwork(view);svg.appendChild(view);
    if(withGuides&&state.showGuides&&state.outputMode==='tile'&&!pageInfo.tooMany){
      const guide=svgNode('g',{fill:'none',stroke:'#4382a1','stroke-width':Math.max(.18,k/900),'stroke-dasharray':Math.max(1,k/75)+' '+Math.max(1,k/105)});
      pageInfo.pages.forEach(function(p){guide.appendChild(svgNode('rect',{x:p.x,y:p.y,width:pageInfo.cellW,height:pageInfo.cellH}))});svg.appendChild(guide);
      if(state.showLabels){
        const labs=svgNode('g',{fill:'#35718f','font-family':'Arial, sans-serif','font-size':Math.max(4,k/27),'font-weight':700});
        pageInfo.pages.forEach(function(p){labs.appendChild(svgText({x:p.x+Math.max(2,k/55),y:p.y+Math.max(5,k/22)},p.label))});
        svg.appendChild(labs);
      }
    }
    if(withGuides)svg.appendChild(svgNode('rect',{x:.2,y:.2,width:Math.max(0,W-.4),height:Math.max(0,H-.4),fill:'none',stroke:'#334650','stroke-width':Math.max(.25,k/600)}));
    return svg;
  }
  /* Overview sheet: the whole layout scaled onto one A4 with every page code, for assembly. */
  function makeMapSvg(info){
    const svg=svgNode('svg',{xmlns:SVG,viewBox:'0 0 '+info.width+' '+info.height,width:info.width+'mm',height:info.height+'mm'});
    svg.appendChild(svgNode('rect',{x:0,y:0,width:info.width,height:info.height,fill:'#fff'}));
    svg.appendChild(svgText({x:15,y:22,'font-family':'Arial, sans-serif','font-size':6,'font-weight':700,fill:'#15232b'},'Birleştirme haritası'));
    svg.appendChild(svgText({x:15,y:30,'font-family':'Arial, sans-serif','font-size':3.2,fill:'#526670'},
      Core.formatLength(layout.W,state.unit)+' × '+Core.formatLength(layout.H,state.unit)+' '+state.unit+' · '+info.cols+' sütun × '+info.rows+' satır · '+info.totalPages+' A4 · bindirme '+info.overlap+' mm'));
    const boxW=info.width-30,boxH=info.height-72;
    const spanW=Math.max(layout.W,(info.cols-1)*info.stepX+info.cellW),spanH=Math.max(layout.H,(info.rows-1)*info.stepY+info.cellH);
    const s=Math.min(boxW/spanW,boxH/spanH),ox=15+(boxW-spanW*s)/2,oy=40+(boxH-spanH*s)/2;
    const inner=makeFullSvg(false);inner.setAttribute('x',ox);inner.setAttribute('y',oy);inner.setAttribute('width',layout.W*s);inner.setAttribute('height',layout.H*s);svg.appendChild(inner);
    const g=svgNode('g',{fill:'none',stroke:'#c34a32','stroke-width':.35});
    const fs=Math.max(2.4,Math.min(7,Math.min(info.cellW,info.cellH)*s/6));
    info.pages.forEach(function(p){
      g.appendChild(svgNode('rect',{x:ox+p.x*s,y:oy+p.y*s,width:info.cellW*s,height:info.cellH*s}));
      svg.appendChild(svgText({x:ox+p.x*s+fs*.4,y:oy+p.y*s+fs*1.1,'font-family':'Arial, sans-serif','font-size':fs,'font-weight':700,fill:'#c34a32','fill-opacity':.85},p.label));
    });
    svg.appendChild(g);
    const steps=['1. Her sayfanın kırmızı ✂ çizgisini cetvelle kes; dışındaki gri şerit atılır.',
      '2. Kesilen kenarı komşu sayfadaki mavi çizgiye oturt (sağdaki sayfa soldakinin, alttaki üsttekinin üstüne gelir).',
      '3. Bindirme şeridindeki hedefleri ve harf çizgilerini üst üste getir, sonra bantla veya yapıştır.',
      '4. Sıra: önce her satırı A1 → A2 → … diye birleştir, sonra satırları üstten alta birleştir.'];
    steps.forEach(function(t,i){svg.appendChild(svgText({x:15,y:info.height-24+i*5,'font-family':'Arial, sans-serif','font-size':3,fill:'#263943'},t))});
    return svg;
  }

  /* ---------- UI ---------- */
  function setInput(id,value){$(id).value=value}
  function setSegment(id,value){$(id).querySelectorAll('button').forEach(function(b){const on=b.dataset.value===value;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))})}
  function syncControls(){
    setInput('textInput',state.text);setInput('fontSelect',state.font);setInput('weightSelect',String(state.weight));setInput('alignSelect',state.align);
    setInput('unitSelect',state.unit);setInput('widthInput',Core.formatLength(state.width,state.unit));setInput('heightInput',Core.formatLength(state.height,state.unit));
    ['widthInput','heightInput'].forEach(function(id){
      $(id).min=Core.formatLength(Core.LIMITS.width[0],state.unit);$(id).max=Core.formatLength(Core.LIMITS.width[1],state.unit);$(id).step='any';
    });
    document.querySelectorAll('.unitSuffix').forEach(function(x){x.textContent=state.unit==='in'?'inç':state.unit});
    setInput('textInset',state.textInset);setInput('letterSpacing',state.letterSpacing);setInput('lineSpacing',state.lineSpacing);
    setInput('orientation',state.orientation);setInput('outputMode',state.outputMode);setInput('pageMargin',state.pageMargin);setInput('overlap',state.overlap);
    ['showLabels','showGuides','showRuler','showOverlap','includeMap'].forEach(function(k){$(k).checked=state[k]});
    setSegment('lineModeSeg',state.lineMode);setSegment('inkModeSeg',state.inkMode);
    $('weightSelect').disabled=!hasBold();
  }
  function setMetric(id,value,small){
    const el=$(id);el.textContent=value;
    if(small){const s=document.createElement('small');s.textContent=' '+small;el.appendChild(s)}
  }
  function showWarning(message){const el=$('warningBox');el.textContent=message||'';el.classList.toggle('show',!!message)}
  function updateFontStatus(){
    const el=$('fontStatus'),src=fontSource();let message='',warn=false;
    const face=bundled(src);
    const entry=catalogEntry(src);
    if(face&&state.font===src)message=face.family+(entry?' — '+entry.note:'')+'. Uygulamayla gelir (SIL OFL), SVG dışa aktarımına gömülür.';
    else if(src==='local')message='USAAF Stencil bilgisayarında bulundu: '+localUsaafFamily+'. SVG dosyasına gömülemez; SVG’yi başka cihazda açarken fontun yüklü olması gerekir.';
    else if(src==='imported')message=(state.font==='usaaf'?'USAAF için ':'')+'yüklenen font kullanılıyor: '+imported.name;
    else{message='USAAF Stencil bu cihazda bulunamadı; yerine '+face.family+' gösteriliyor. USAAF’ın lisansı yalnızca kişisel kullanıma izin verdiği için siteye gömülemez: dosyayı “Font yükle” ile ekleyebilirsin, bu tarayıcıda saklanır.';warn=true}
    if(face){
      const missing=Core.missingChars(state.text,face.chars);
      if(missing.length){message+=' Bu fontta olmayan karakterler: '+missing.join(' ')+' — başka bir font seç.';warn=true}
    }
    el.classList.toggle('warn',warn);el.textContent='';
    const mark=document.createElement('span');mark.className='status-mark';mark.textContent=warn?'!':'✓';
    const text=document.createElement('span');text.textContent=message;
    el.appendChild(mark);el.appendChild(text);
    $('fontSelect').querySelector('option[value="custom"]').disabled=!imported;
    $('weightSelect').disabled=!hasBold();
  }
  function renderThumbs(){
    const list=$('thumbList');list.textContent='';
    if(pageInfo.tooMany){
      const d=document.createElement('div');d.className='thumb-empty';d.textContent='Önizleme performansı için sayfa listesi gizlendi ('+pageInfo.totalPages+' sayfa).';list.appendChild(d);return;
    }
    const frag=document.createDocumentFragment();
    pageInfo.pages.forEach(function(p){
      const button=document.createElement('button');button.type='button';button.className='thumb'+(selectedPage===p.index&&previewMode==='page'?' active':'');
      button.setAttribute('aria-label','Sayfa '+p.label+' önizlemesi');button.dataset.index=p.index;
      button.setAttribute('aria-pressed',String(selectedPage===p.index&&previewMode==='page'));
      button.appendChild(makeSheetSvg(p,pageInfo,false));
      const name=document.createElement('div');name.className='thumb-name';
      const a=document.createElement('span');a.textContent=p.label;const b=document.createElement('span');b.textContent=(p.index+1)+'/'+pageInfo.totalPages;
      name.appendChild(a);name.appendChild(b);button.appendChild(name);frag.appendChild(button);
    });
    list.appendChild(frag);
  }
  function syncThumbSelection(){
    document.querySelectorAll('#thumbList .thumb').forEach(function(button){
      const on=previewMode==='page'&&Number(button.dataset.index)===selectedPage;
      button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));
    });
  }
  function syncPreviewToggle(){document.querySelectorAll('#previewMode button').forEach(function(b){const on=b.dataset.value===previewMode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))})}
  function renderPreview(){
    const stage=$('previewStage');stage.textContent='';
    const style=getComputedStyle(stage);
    const avail=Math.max(1,stage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)),availH=Math.max(240,window.innerHeight*.7);
    const selected=pageInfo.pages[Math.min(selectedPage,pageInfo.pages.length-1)];
    $('zoomValue').textContent=Math.round(zoom*100)+'%';
    $('previousPage').disabled=!selected||selectedPage===0;
    $('nextPage').disabled=!selected||selectedPage>=pageInfo.pages.length-1;
    if(previewMode==='page'&&selected){
      const fit=Math.min(avail,availH*pageInfo.width/pageInfo.height);
      const wrap=document.createElement('div');wrap.className='sheet-wrap';wrap.style.width=Math.round(fit*zoom)+'px';
      wrap.appendChild(makeSheetSvg(selected,pageInfo,false));stage.appendChild(wrap);
      $('previewSub').textContent='Seçili A4 · '+selected.label;
      $('selectedPageCaption').textContent='Sayfa '+selected.label+' · '+(selected.index+1)+' / '+pageInfo.totalPages;
    }else{
      const fit=Math.min(avail,availH*layout.W/layout.H);
      const wrap=document.createElement('div');wrap.className='full-wrap';wrap.style.width=Math.round(fit*zoom)+'px';
      wrap.appendChild(makeFullSvg(true));stage.appendChild(wrap);
      $('previewSub').textContent=pageInfo.cols+' × '+pageInfo.rows+' A4 · tam yerleşim';
      $('selectedPageCaption').textContent=pageInfo.totalPages+' sayfa';
    }
  }
  function renderPrint(){
    const root=$('printRoot');root.textContent='';const p=Core.paperSize(state.orientation);
    $('dynamicPrintStyle').textContent='@page{size:'+p.width+'mm '+p.height+'mm;margin:0}.print-sheet{width:'+p.width+'mm;height:'+p.height+'mm}.print-sheet>svg{width:'+p.width+'mm;height:'+p.height+'mm}';
    if(collectWarning())return;
    function add(svg,extra){const wrap=document.createElement('div');wrap.className='print-sheet'+(extra?' '+extra:'');wrap.appendChild(svg);root.appendChild(wrap)}
    if(state.includeMap&&state.outputMode==='tile'&&pageInfo.totalPages>1)add(makeMapSvg(pageInfo),'print-map');
    pageInfo.pages.forEach(function(page){add(makeSheetSvg(page,pageInfo,true))});
  }
  function collectWarning(){
    if(pageInfo.invalid)return 'Kenar payı veya bindirme A4 iç alanına göre çok büyük. Kenar payını azalt veya bindirmeyi küçült.';
    if(pageInfo.tooLargeSingle)return 'Tasarım güvenli alan içinde tek A4’e sığmıyor. Gerçek ölçeği korumak için ölçüyü küçült veya “Gerekli A4’lere böl” seç.';
    const artwork=artworkWarning();if(artwork)return artwork;
    if(pageInfo.tooMany)return 'Bu ölçü '+pageInfo.totalPages+' sayfa oluşturuyor. Tek seferde en fazla '+Core.MAX_PAGES+' sayfa desteklenir; ölçüyü küçült veya pay değerlerini değiştir.';
    return '';
  }
  function artworkWarning(){
    if(layout.empty)return 'Şablon metni boş. Yazdırmak veya SVG indirmek için metin yaz.';
    if(layout.textAreaOverflow)return 'Yazı iç payı tasarım genişliğine veya yüksekliğine sığmıyor. İç payı azalt.';
    if(layout.trackOverflow)return 'Harf aralığı yazı alanını aşıyor. Harf aralığını küçült veya tasarım genişliğini artır.';
    return '';
  }
  function renderNow(){
    clearTimeout(renderTimer);
    pageInfo=Core.calculatePages(state);layout=computeLayout();
    selectedPage=Math.max(0,Math.min(selectedPage,pageInfo.pages.length-1));
    const warning=collectWarning();
    showWarning(warning);
    $('printBtn').disabled=!!warning;$('printBtnSide').disabled=!!warning;
    $('exportSvgBtn').disabled=!!artworkWarning();
    setMetric('metricSize',Core.formatLength(state.width,state.unit)+' × '+Core.formatLength(state.height,state.unit),state.unit==='in'?'inç':state.unit);
    setMetric('metricPages',String(pageInfo.totalPages),'A4');
    setMetric('metricGrid',pageInfo.cols+' × '+pageInfo.rows,'sütun × satır');
    setMetric('metricFont',layout.letterHeight?Core.formatLength(layout.letterHeight,state.unit==='in'?'in':'mm'):'—',layout.letterHeight?(state.unit==='in'?'inç':'mm'):'');
    $('lineCount').textContent=Core.getLines(state).length+' satır';
    $('pageListCaption').textContent=pageInfo.totalPages+' sayfa · A1’den başlayarak kodlanır';
    $('lineSpacingValue').textContent=state.lineSpacing+'%';
    updateFontStatus();renderPreview();renderThumbs();renderPrint();
    saveState();
  }
  function scheduleRender(){
    clearTimeout(renderTimer);
    renderTimer=setTimeout(async function(){try{await document.fonts.ready}catch(e){}renderNow()},40);
  }
  function update(key,value){state[key]=value;state=Core.sanitizeState(state);scheduleRender()}
  function bindInput(id,key,convert){
    const el=$(id);
    function handler(){
      const raw=el.value;
      if(el.type==='number'&&(raw===''||!Number.isFinite(Number(raw))))return; // wait for a complete number
      update(key,convert?convert(raw):raw);
    }
    el.addEventListener('input',handler);
    el.addEventListener('change',function(){handler();if(el.type==='number')syncControls()});
  }
  function bindSegment(id,key){$(id).addEventListener('click',function(e){const b=e.target.closest('button[data-value]');if(!b)return;setSegment(id,b.dataset.value);update(key,b.dataset.value)})}
  function selectPage(index){
    if(!pageInfo.pages[index])return;
    selectedPage=index;previewMode='page';syncPreviewToggle();renderPreview();syncThumbSelection();
  }
  function bindEvents(){
    bindInput('textInput','text');bindInput('weightSelect','weight',Number);bindInput('alignSelect','align');
    bindInput('textInset','textInset',Number);bindInput('letterSpacing','letterSpacing',Number);bindInput('lineSpacing','lineSpacing',Number);
    bindInput('orientation','orientation');bindInput('outputMode','outputMode');bindInput('pageMargin','pageMargin',Number);bindInput('overlap','overlap',Number);
    bindInput('widthInput','width',function(v){return Number(v)*MM_PER[state.unit]});
    bindInput('heightInput','height',function(v){return Number(v)*MM_PER[state.unit]});
    $('unitSelect').addEventListener('change',function(){state.unit=this.value;syncControls();scheduleRender()});
    bindSegment('lineModeSeg','lineMode');bindSegment('inkModeSeg','inkMode');
    $('fontSelect').addEventListener('change',function(){update('font',this.value);syncControls()});
    ['showLabels','showGuides','showRuler','showOverlap','includeMap'].forEach(function(id){$(id).addEventListener('change',function(){update(id,this.checked)})});
    document.querySelectorAll('.preset').forEach(function(b){b.addEventListener('click',function(){const v=b.dataset.size.split(',').map(Number);state.width=v[0];state.height=v[1];state.unit='cm';syncControls();scheduleRender()})});
    $('fontUploadBtn').addEventListener('click',function(){$('fontFile').click()});
    $('fontFile').addEventListener('change',async function(){
      const file=this.files&&this.files[0];this.value='';if(!file)return;
      if(!/\.(ttf|otf|woff2?)$/i.test(file.name)){showWarning('TTF, OTF, WOFF veya WOFF2 font dosyası seç.');return}
      if(await loadImportedFont(file,file.name)){await dbPut('stencil-font',{blob:file,name:file.name});state.font='custom';syncControls();scheduleRender()}
      else showWarning('Font yüklenemedi. Geçerli bir TTF, OTF veya WOFF dosyası seç.');
    });
    $('thumbList').addEventListener('click',function(e){
      const b=e.target.closest('.thumb');if(!b)return;
      selectPage(Number(b.dataset.index));
    });
    $('previousPage').addEventListener('click',function(){selectPage(selectedPage-1)});
    $('nextPage').addEventListener('click',function(){selectPage(selectedPage+1)});
    $('previewMode').addEventListener('click',function(e){const b=e.target.closest('button[data-value]');if(!b)return;previewMode=b.dataset.value;syncPreviewToggle();renderPreview();renderThumbs()});
    $('zoomOut').addEventListener('click',function(){zoom=Math.max(.5,Core.round(zoom-.25,2));renderPreview()});
    $('zoomIn').addEventListener('click',function(){zoom=Math.min(4,Core.round(zoom+.25,2));renderPreview()});
    $('zoomFit').addEventListener('click',function(){zoom=1;renderPreview()});
    $('printBtn').addEventListener('click',printNow);$('printBtnSide').addEventListener('click',printNow);
    $('exportSvgBtn').addEventListener('click',exportSvg);
    $('resetBtn').addEventListener('click',function(){if(!confirm('Mevcut taslağı varsayılan ölçü ve metne döndür?'))return;state=Object.assign({},Core.DEFAULTS);selectedPage=0;previewMode='full';zoom=1;syncControls();syncPreviewToggle();scheduleRender()});
    window.addEventListener('beforeprint',function(){if(layout)renderNow()});
    let resizeTimer=null;
    window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(function(){if(layout)renderPreview()},120)});
  }
  async function printNow(){
    try{await document.fonts.ready}catch(e){}
    renderNow();if(collectWarning())return;
    window.print();
  }

  /* ---------- export ---------- */
  function blobToDataUrl(blob){return new Promise(function(resolve,reject){const r=new FileReader();r.onload=function(){resolve(r.result)};r.onerror=reject;r.readAsDataURL(blob)})}
  async function embeddedFontCss(){
    const src=fontSource();
    const face=bundled(src);
    if(face){
      const w=String(fontWeight());
      return '@font-face{font-family:"'+face.family+'";font-weight:'+w+';src:url(data:font/woff2;base64,'+face.weights[w]+') format("woff2")}';
    }
    if(src==='imported'){
      const url=await blobToDataUrl(imported.blob);
      return '@font-face{font-family:"'+IMPORTED_FAMILY+'";src:url('+url+')}';
    }
    return '';
  }
  async function exportSvg(){
    try{await document.fonts.ready}catch(e){}
    renderNow();
    if(artworkWarning())return;
    const svg=makeFullSvg(false);
    svg.setAttribute('width',Core.round(layout.W,3)+'mm');svg.setAttribute('height',Core.round(layout.H,3)+'mm');
    const css=await embeddedFontCss();
    if(css){const style=svgNode('style');style.textContent=css;svg.insertBefore(style,svg.firstChild)}
    const source='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(svg);
    const blob=new Blob([source],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='stencil-'+Math.round(layout.W)+'x'+Math.round(layout.H)+'mm.svg';
    document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},1000);
  }

  async function start(){
    populateFontSelect();loadState();detectUsaaf();syncControls();syncPreviewToggle();bindEvents();
    await Promise.all([registerBundledFonts(),restoreFont()]);
    if(state.font==='custom'&&!imported)state.font='usaaf';
    if(state.font!=='usaaf'&&state.font!=='custom'&&!bundled(state.font))state.font=Core.DEFAULTS.font;
    syncControls();
    try{await document.fonts.ready}catch(e){}
    renderNow();
  }
  start();
})();
