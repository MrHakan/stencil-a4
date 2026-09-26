(function(){
  'use strict';
  const Core=window.StencilCore;
  const MM_PER=Core.MM_PER;
  const SVG='http://www.w3.org/2000/svg';
  const STORAGE_KEY='stencil-maker-project';
  const IMPORTED_FAMILY='ImportedStencil';
  const STARDOS_FAMILY='Stardos Stencil';
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
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));$('saveStatus').textContent='Taslak kaydedildi'}
    catch(e){$('saveStatus').textContent='Bu tarayıcıda kayıt yapılamadı'}
  }
  function loadState(){
    try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved)state=Core.sanitizeState(saved)}catch(e){}
  }

  /* ---------- fonts ---------- */
  function base64ToBytes(b64){const bin=atob(b64),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
  async function registerBundledFonts(){
    const data=window.StencilFonts&&window.StencilFonts.stardos;if(!data)return;
    await Promise.all(Object.keys(data).map(async function(weight){
      try{const face=new FontFace(STARDOS_FAMILY,base64ToBytes(data[weight]).buffer,{weight:weight,style:'normal'});await face.load();document.fonts.add(face)}catch(e){}
    }));
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
    return 'stardos';
  }
  function fontFamily(){
    const src=fontSource();
    return src==='imported'?IMPORTED_FAMILY:src==='local'?localUsaafFamily:STARDOS_FAMILY;
  }
  function fontWeight(){return fontSource()==='stardos'?Number(state.weight):400}
  function cssFont(size){return fontWeight()+' '+size+'px "'+fontFamily()+'"'}

  /* ---------- measuring ---------- */
  function computeLayout(){
    const ctx=document.createElement('canvas').getContext('2d'),S=1000;
    ctx.font=cssFont(S);
    function measure(line){
      const chars=Array.from(line),advances=[];let prefix='';
      for(let i=0;i<chars.length;i++){advances.push(i?ctx.measureText(prefix).width/S:0);prefix+=chars[i]}
      const m=ctx.measureText(line);
      return{advances:advances,width:m.width/S,ascent:(m.actualBoundingBoxAscent||0)/S,descent:(m.actualBoundingBoxDescent||0)/S};
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
      fill:outline?'none':INK,stroke:outline?INK:'none','stroke-width':outline?.42:0,'stroke-linejoin':'round'
    });
    layout.glyphs.forEach(function(g){
      // Explicit per-character x positions keep kerning and tracking identical in every renderer.
      group.appendChild(svgText({x:g.xs.join(' '),y:g.baseline,'xml:space':'preserve'},g.text));
    });
    parent.appendChild(group);
  }
  function addCross(parent,x,y,size,color){
    parent.appendChild(svgNode('path',{d:'M '+(x-size)+' '+y+' H '+(x+size)+' M '+x+' '+(y-size)+' V '+(y+size),fill:'none',stroke:color||'#30444e','stroke-width':.32}));
  }
  function drawOverlapZones(g,page,info){
    if(!state.showOverlap||state.outputMode!=='tile'||info.overlap<=0)return;
    const m=info.margin,o=info.overlap,zone={fill:'#c34a32','fill-opacity':.07,stroke:'none'},edge={fill:'none',stroke:'#c34a32','stroke-width':.25,'stroke-dasharray':'.8 1.2','stroke-opacity':.7};
    const zones=[];
    if(page.col>0)zones.push([m,m,o,info.cellH,'M '+(m+o)+' '+m+' v '+info.cellH]);
    if(page.col<info.cols-1)zones.push([m+info.cellW-o,m,o,info.cellH,'M '+(m+info.cellW-o)+' '+m+' v '+info.cellH]);
    if(page.row>0)zones.push([m,m,info.cellW,o,'M '+m+' '+(m+o)+' h '+info.cellW]);
    if(page.row<info.rows-1)zones.push([m,m+info.cellH-o,info.cellW,o,'M '+m+' '+(m+info.cellH-o)+' h '+info.cellW]);
    zones.forEach(function(z){
      g.appendChild(svgNode('rect',Object.assign({x:z[0],y:z[1],width:z[2],height:z[3]},zone)));
      g.appendChild(svgNode('path',Object.assign({d:z[4]},edge)));
    });
  }
  function neighbourLabel(page,dr,dc){
    const r=page.row+dr,c=page.col+dc;
    if(r<0||c<0||r>=pageInfo.rows||c>=pageInfo.cols)return '';
    return Core.pageName(r,c);
  }
  function drawSheetGuides(svg,page,info){
    const g=svgNode('g',{'aria-label':'Print guides'}),m=info.margin,pw=info.width,ph=info.height;
    if(state.showGuides){
      g.appendChild(svgNode('rect',{x:m,y:m,width:Math.max(0,info.cellW),height:Math.max(0,info.cellH),fill:'none',stroke:'#7899a8','stroke-width':.25,'stroke-dasharray':'2 1.5'}));
      [[5,5],[pw-5,5],[5,ph-5],[pw-5,ph-5]].forEach(function(p){addCross(g,p[0],p[1],1.3,'#334d58')});
      g.appendChild(svgNode('path',{d:'M '+m+' '+(m-1.7)+' v 3.4 M '+(pw-m)+' '+(m-1.7)+' v 3.4 M '+(m-1.7)+' '+m+' h 3.4 M '+(m-1.7)+' '+(ph-m)+' h 3.4',fill:'none',stroke:'#405d69','stroke-width':.3}));
    }
    drawOverlapZones(g,page,info);
    if(state.showLabels){
      g.appendChild(svgText({x:8,y:6,'font-family':'Arial, sans-serif','font-size':3.1,'font-weight':700,fill:'#263943','letter-spacing':.15},page.label));
      if(state.outputMode==='tile'&&pageInfo.totalPages>1){
        const n={font:'Arial, sans-serif',size:2.2,fill:'#6a7f89'};
        const around=[['↑',neighbourLabel(page,-1,0),pw/2,m>4?m-1.2:3,'middle'],['↓',neighbourLabel(page,1,0),pw/2,ph-(m>4?m-3:1.5),'middle'],['←',neighbourLabel(page,0,-1),4,ph/2,'start'],['→',neighbourLabel(page,0,1),pw-4,ph/2,'end']];
        around.forEach(function(a){if(a[1])g.appendChild(svgText({x:a[2],y:a[3],'font-family':n.font,'font-size':n.size,fill:n.fill,'text-anchor':a[4]},a[0]+' '+a[1]))});
      }
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
    const boxW=info.width-30,boxH=info.height-60;
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
    return svg;
  }

  /* ---------- UI ---------- */
  function setInput(id,value){$(id).value=value}
  function setSegment(id,value){$(id).querySelectorAll('button').forEach(function(b){const on=b.dataset.value===value;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))})}
  function syncControls(){
    setInput('textInput',state.text);setInput('fontSelect',state.font);setInput('weightSelect',String(state.weight));setInput('alignSelect',state.align);
    setInput('unitSelect',state.unit);setInput('widthInput',Core.round(state.width/MM_PER[state.unit],2));setInput('heightInput',Core.round(state.height/MM_PER[state.unit],2));
    document.querySelectorAll('.unitSuffix').forEach(function(x){x.textContent=state.unit==='in'?'inç':state.unit});
    setInput('textInset',state.textInset);setInput('letterSpacing',state.letterSpacing);setInput('lineSpacing',state.lineSpacing);
    setInput('orientation',state.orientation);setInput('outputMode',state.outputMode);setInput('pageMargin',state.pageMargin);setInput('overlap',state.overlap);
    ['showLabels','showGuides','showRuler','showOverlap','includeMap'].forEach(function(k){$(k).checked=state[k]});
    setSegment('lineModeSeg',state.lineMode);setSegment('inkModeSeg',state.inkMode);
    $('weightSelect').disabled=fontSource()!=='stardos';
  }
  function setMetric(id,value,small){
    const el=$(id);el.textContent=value;
    if(small){const s=document.createElement('small');s.textContent=' '+small;el.appendChild(s)}
  }
  function showWarning(message){const el=$('warningBox');el.textContent=message||'';el.classList.toggle('show',!!message)}
  function updateFontStatus(){
    const el=$('fontStatus'),src=fontSource();let message='',warn=false;
    if(state.font==='stardos')message='Stardos Stencil hazır. Uygulamanın içinde gelir, SVG dışa aktarımına gömülür.';
    else if(src==='local')message='USAAF Stencil bilgisayarında bulundu: '+localUsaafFamily+'. SVG dosyasına gömülemez; SVG’yi başka cihazda açarken fontun yüklü olması gerekir.';
    else if(src==='imported')message=(state.font==='usaaf'?'USAAF için ':'')+'yüklenen font kullanılıyor: '+imported.name;
    else{message='USAAF Stencil bu tarayıcıda bulunamadı. Önizleme Stardos Stencil ile gösteriliyor; .ttf/.otf dosyasını yükleyince gerçek font uygulanır.';warn=true}
    el.classList.toggle('warn',warn);el.textContent='';
    const mark=document.createElement('span');mark.className='status-mark';mark.textContent=warn?'!':'✓';
    const text=document.createElement('span');text.textContent=message;
    el.appendChild(mark);el.appendChild(text);
    $('fontSelect').querySelector('option[value="custom"]').disabled=!imported;
    $('weightSelect').disabled=src!=='stardos';
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
      button.appendChild(makeSheetSvg(p,pageInfo,false));
      const name=document.createElement('div');name.className='thumb-name';
      const a=document.createElement('span');a.textContent=p.label;const b=document.createElement('span');b.textContent=(p.index+1)+'/'+pageInfo.totalPages;
      name.appendChild(a);name.appendChild(b);button.appendChild(name);frag.appendChild(button);
    });
    list.appendChild(frag);
  }
  function syncPreviewToggle(){document.querySelectorAll('#previewMode button').forEach(function(b){const on=b.dataset.value===previewMode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))})}
  function renderPreview(){
    const stage=$('previewStage');stage.textContent='';
    const avail=Math.max(200,stage.clientWidth-48),availH=Math.max(240,window.innerHeight*.7);
    const selected=pageInfo.pages[Math.min(selectedPage,pageInfo.pages.length-1)];
    $('zoomValue').textContent=Math.round(zoom*100)+'%';
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
    if(pageInfo.tooMany||pageInfo.invalid)return;
    function add(svg){const wrap=document.createElement('div');wrap.className='print-sheet';wrap.appendChild(svg);root.appendChild(wrap)}
    if(state.includeMap&&state.outputMode==='tile'&&pageInfo.totalPages>1)add(makeMapSvg(pageInfo));
    pageInfo.pages.forEach(function(page){add(makeSheetSvg(page,pageInfo,true))});
  }
  function collectWarning(){
    if(pageInfo.invalid)return 'Kenar payı veya bindirme A4 iç alanına göre çok büyük. Kenar payını azalt veya bindirmeyi küçült.';
    if(pageInfo.tooLargeSingle)return 'Tasarım güvenli alan içinde tek A4’e sığmıyor. Gerçek ölçeği korumak için ölçüyü küçült veya “Gerekli A4’lere böl” seç.';
    if(layout.textAreaOverflow)return 'Yazı iç payı tasarım genişliğine veya yüksekliğine sığmıyor. İç payı azalt.';
    if(layout.trackOverflow)return 'Harf aralığı yazı alanını aşıyor. Harf aralığını küçült veya tasarım genişliğini artır.';
    if(pageInfo.tooMany)return 'Bu ölçü '+pageInfo.totalPages+' sayfa oluşturuyor. Tek seferde en fazla '+Core.MAX_PAGES+' sayfa desteklenir; ölçüyü küçült veya pay değerlerini değiştir.';
    return '';
  }
  function renderNow(){
    pageInfo=Core.calculatePages(state);layout=computeLayout();
    selectedPage=Math.max(0,Math.min(selectedPage,pageInfo.pages.length-1));
    const warning=collectWarning();
    showWarning(warning);
    $('printBtn').disabled=!!warning;$('printBtnSide').disabled=!!warning;
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
      selectedPage=Number(b.dataset.index);previewMode='page';syncPreviewToggle();renderPreview();
      document.querySelectorAll('.thumb').forEach(function(t){t.classList.toggle('active',t===b)});
    });
    $('previewMode').addEventListener('click',function(e){const b=e.target.closest('button[data-value]');if(!b)return;previewMode=b.dataset.value;syncPreviewToggle();renderPreview();renderThumbs()});
    $('zoomOut').addEventListener('click',function(){zoom=Math.max(.5,Core.round(zoom-.25,2));renderPreview()});
    $('zoomIn').addEventListener('click',function(){zoom=Math.min(4,Core.round(zoom+.25,2));renderPreview()});
    $('zoomFit').addEventListener('click',function(){zoom=1;renderPreview()});
    $('printBtn').addEventListener('click',printNow);$('printBtnSide').addEventListener('click',printNow);
    $('exportSvgBtn').addEventListener('click',exportSvg);
    $('resetBtn').addEventListener('click',function(){if(!confirm('Mevcut taslağı varsayılan ölçü ve metne döndür?'))return;state=Object.assign({},Core.DEFAULTS);selectedPage=0;previewMode='full';zoom=1;syncControls();syncPreviewToggle();scheduleRender()});
    window.addEventListener('beforeprint',function(){if(layout)renderPrint()});
    let resizeTimer=null;
    window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(function(){if(layout)renderPreview()},120)});
  }
  async function printNow(){
    if($('printBtn').disabled)return;
    try{await document.fonts.ready}catch(e){}
    renderNow();window.print();
  }

  /* ---------- export ---------- */
  function blobToDataUrl(blob){return new Promise(function(resolve,reject){const r=new FileReader();r.onload=function(){resolve(r.result)};r.onerror=reject;r.readAsDataURL(blob)})}
  async function embeddedFontCss(){
    const src=fontSource();
    if(src==='stardos'){
      const w=String(fontWeight()),data=window.StencilFonts.stardos[w];
      return '@font-face{font-family:"'+STARDOS_FAMILY+'";font-weight:'+w+';src:url(data:font/ttf;base64,'+data+') format("truetype")}';
    }
    if(src==='imported'){
      const url=await blobToDataUrl(imported.blob);
      return '@font-face{font-family:"'+IMPORTED_FAMILY+'";src:url('+url+')}';
    }
    return '';
  }
  async function exportSvg(){
    renderNow();
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
    loadState();detectUsaaf();syncControls();syncPreviewToggle();bindEvents();
    await Promise.all([registerBundledFonts(),restoreFont()]);
    if(state.font==='custom'&&!imported)state.font='usaaf';
    syncControls();
    try{await document.fonts.ready}catch(e){}
    renderNow();
  }
  start();
})();
