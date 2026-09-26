/* Pure layout and tiling math. No DOM access, so it runs in the browser and in Node tests. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.StencilCore=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const MM_PER={mm:1,cm:10,in:25.4};
  const MAX_PAGES=240;
  const PAPER={portrait:{width:210,height:297},landscape:{width:297,height:210}};

  const DEFAULTS=Object.freeze({
    text:'ADVANTAGE SPRING',lineMode:'single',font:'usaaf',weight:400,align:'center',
    width:600,height:120,unit:'cm',textInset:5,letterSpacing:0,lineSpacing:100,
    orientation:'portrait',outputMode:'tile',pageMargin:10,overlap:10,inkMode:'solid',
    showLabels:true,showGuides:true,showRuler:true,showOverlap:true,includeMap:false
  });

  const LIMITS={
    width:[1,100000],height:[1,100000],textInset:[0,500],letterSpacing:[-5,20],
    lineSpacing:[80,150],pageMargin:[0,50],overlap:[0,100]
  };
  const CHOICES={
    lineMode:['single','multi'],font:['usaaf','stardos','custom'],weight:[400,700],
    align:['center','left','right'],unit:['mm','cm','in'],orientation:['portrait','landscape'],
    outputMode:['tile','single'],inkMode:['solid','outline']
  };

  function clamp(n,min,max){return Math.min(max,Math.max(min,n))}
  function round(n,places){const p=Math.pow(10,places||0);return Math.round(Number(n)*p)/p}
  function num(value,fallback){const n=Number(value);return Number.isFinite(n)?n:fallback}

  /* Coerce any stored or user-provided state into a valid one. */
  function sanitizeState(input){
    const src=input&&typeof input==='object'?input:{};
    const out=Object.assign({},DEFAULTS);
    out.text=typeof src.text==='string'?src.text.slice(0,500):DEFAULTS.text;
    Object.keys(LIMITS).forEach(function(k){
      const r=LIMITS[k];out[k]=clamp(num(src[k],DEFAULTS[k]),r[0],r[1]);
    });
    Object.keys(CHOICES).forEach(function(k){
      const v=k==='weight'?Number(src[k]):src[k];
      out[k]=CHOICES[k].indexOf(v)>=0?v:DEFAULTS[k];
    });
    ['showLabels','showGuides','showRuler','showOverlap','includeMap'].forEach(function(k){
      out[k]=typeof src[k]==='boolean'?src[k]:DEFAULTS[k];
    });
    return out;
  }

  /* Spreadsheet-style row names: A..Z, AA, AB... */
  function rowName(index){
    let n=index+1,s='';
    while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)}
    return s;
  }
  function pageName(row,col){return rowName(row)+(col+1)}

  function paperSize(orientation){return PAPER[orientation]||PAPER.portrait}

  /* Splits the design (W x H mm) into A4 cells. Each page shows the design window
     [x, x+cellW] x [y, y+cellH]; neighbours share `overlap` mm. */
  function calculatePages(state){
    const p=paperSize(state.orientation);
    const m=Math.max(0,num(state.pageMargin,0));
    const cellW=p.width-2*m,cellH=p.height-2*m;
    const overlap=Math.max(0,num(state.overlap,0));
    const W=Math.max(1,num(state.width,1)),H=Math.max(1,num(state.height,1));
    const invalid=cellW<=0||cellH<=0||overlap>=Math.min(cellW,cellH);
    const stepX=Math.max(1,cellW-overlap),stepY=Math.max(1,cellH-overlap);
    const single=state.outputMode==='single';
    const cols=single||invalid?1:Math.max(1,Math.ceil(Math.max(0,W-cellW)/stepX)+1);
    const rows=single||invalid?1:Math.max(1,Math.ceil(Math.max(0,H-cellH)/stepY)+1);
    const totalPages=cols*rows,pages=[];
    // A single sheet centres the design in the safe area; tiles start at the design's top-left.
    const offX=single?(W-cellW)/2:0,offY=single?(H-cellH)/2:0;
    if(totalPages<=MAX_PAGES){
      for(let i=0;i<totalPages;i++){
        const r=Math.floor(i/cols),c=i%cols;
        pages.push({index:i,row:r,col:c,x:c*stepX+offX,y:r*stepY+offY,label:pageName(r,c)});
      }
    }
    return{
      width:p.width,height:p.height,margin:m,cellW:cellW,cellH:cellH,stepX:stepX,stepY:stepY,
      overlap:overlap,cols:cols,rows:rows,totalPages:totalPages,pages:pages,
      invalid:invalid,tooMany:totalPages>MAX_PAGES,
      tooLargeSingle:single&&(W>cellW+1e-9||H>cellH+1e-9)
    };
  }

  function getLines(state){
    const raw=String(state.text||'');
    if(state.lineMode==='single')return [raw.replace(/[\r\n]+/g,' ').trim()];
    return raw.replace(/\r/g,'').split('\n');
  }

  /* Fits text lines inside the design box.
     measure(line) must return metrics at a font size of 1 unit:
       {advances:[x offset of each char], width, ascent, descent}
     where ascent/descent are the actual ink extents of the line. `ref` gives the same for a
     reference string and sets the line pitch, so empty lines still take up space. */
  function fitText(state,lines,measure,ref){
    const W=Math.max(1,num(state.width,1)),H=Math.max(1,num(state.height,1));
    const inset=Math.max(0,num(state.textInset,0));
    const innerW=W-2*inset,innerH=H-2*inset;
    const track=num(state.letterSpacing,0),spacing=num(state.lineSpacing,100)/100;
    const refH=Math.max(.3,ref.ascent+ref.descent);
    const metrics=lines.map(function(line){
      if(!line)return null;
      const m=measure(line);
      return{chars:m.advances.length,advances:m.advances,width:m.width,
        ascent:m.ascent>0||m.descent>0?m.ascent:ref.ascent,descent:m.ascent>0||m.descent>0?m.descent:ref.descent};
    });
    const empty=metrics.every(function(m){return !m});
    const result={W:W,H:H,inset:inset,innerW:innerW,innerH:innerH,lines:lines,fontSize:0,
      glyphs:[],empty:empty,track:track,
      textAreaOverflow:innerW<=0||innerH<=0,trackOverflow:false};
    if(empty||result.textAreaOverflow)return result;

    // Width constraint per line: fs*width + (chars-1)*track <= innerW
    let fsW=Infinity;
    metrics.forEach(function(m){
      if(!m)return;
      const trackSpan=Math.max(0,m.chars-1)*track;
      if(innerW-trackSpan<=0){result.trackOverflow=true;return}
      if(m.width>0)fsW=Math.min(fsW,(innerW-trackSpan)/m.width);
    });
    if(result.trackOverflow)return result;

    // Height constraint: ink of first line top to ink of last line bottom.
    const first=metrics.findIndex(function(m){return m}),last=metrics.length-1-metrics.slice().reverse().findIndex(function(m){return m});
    const pitch=refH*spacing;
    const heightPerFs=metrics[first].ascent+(last-first)*pitch+metrics[last].descent;
    const fs=Math.max(.1,Math.min(fsW,innerH/heightPerFs));
    result.fontSize=fs;
    result.letterHeight=fs*Math.max.apply(null,metrics.filter(Boolean).map(function(m){return m.ascent+m.descent}));

    const inkTop=(H-heightPerFs*fs)/2;
    const firstBaseline=inkTop+metrics[first].ascent*fs;
    metrics.forEach(function(m,i){
      if(!m)return;
      const baseline=firstBaseline+(i-first)*pitch*fs;
      const lineWidth=m.width*fs+Math.max(0,m.chars-1)*track;
      let x0=inset+(innerW-lineWidth)/2;
      if(state.align==='left')x0=inset;
      if(state.align==='right')x0=W-inset-lineWidth;
      const xs=m.advances.map(function(a,k){return round(x0+a*fs+k*track,4)});
      result.glyphs.push({line:i,text:lines[i],baseline:round(baseline,4),xs:xs,width:lineWidth});
    });
    return result;
  }

  function formatLength(mm,unit){
    const u=MM_PER[unit]?unit:'mm';
    const places=u==='mm'?0:u==='cm'?1:2;
    return round(mm/MM_PER[u],places)+'';
  }

  return{MM_PER:MM_PER,MAX_PAGES:MAX_PAGES,DEFAULTS:DEFAULTS,LIMITS:LIMITS,clamp:clamp,round:round,
    sanitizeState:sanitizeState,rowName:rowName,pageName:pageName,paperSize:paperSize,
    calculatePages:calculatePages,getLines:getLines,fitText:fitText,formatLength:formatLength};
});
