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
    orientation:'portrait',outputMode:'tile',pageMargin:10,overlap:15,inkMode:'solid',
    showLabels:true,showGuides:true,showRuler:true,showOverlap:true,includeMap:true
  });

  const LIMITS={
    width:[1,100000],height:[1,100000],textInset:[0,500],letterSpacing:[-5,20],
    lineSpacing:[80,150],pageMargin:[0,50],overlap:[0,100]
  };
  const CHOICES={
    lineMode:['single','multi'],weight:[400,700],
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
    // Font ids come from the generated catalog; the app falls back when an id is unknown.
    out.font=typeof src.font==='string'&&/^[a-z0-9]{1,32}$/.test(src.font)?src.font:DEFAULTS.font;
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

  /* Characters of `text` (ignoring whitespace) that are not in `supported`. */
  function missingChars(text,supported){
    const seen={},out=[];
    Array.from(String(text||'')).forEach(function(c){
      if(/\s/.test(c)||seen[c])return;seen[c]=1;
      if(supported.indexOf(c)<0)out.push(c);
    });
    return out;
  }

  /* Fits text lines inside the design box.
     measure(line) must return metrics at a font size of 1 unit:
       {advances:[x offset of each char], width, ascent, descent, bounds:[{left,right}|null]}
     Optional bounds describe each character's ink relative to its own origin; null
     characters (spaces) have no ink. Without bounds, advance boxes are used.
     where ascent/descent are the actual ink extents of the line. `ref` gives the same for a
     reference string and sets the line pitch, so empty lines still take up space. */
  function fitText(state,lines,measure,ref){
    const W=Math.max(1,num(state.width,1)),H=Math.max(1,num(state.height,1));
    const inset=Math.max(0,num(state.textInset,0));
    const innerW=W-2*inset,innerH=H-2*inset;
    const track=num(state.letterSpacing,0),spacing=num(state.lineSpacing,100)/100;
    const refH=Math.max(.3,ref.ascent+ref.descent);
    const metrics=lines.map(function(line){
      if(!/\S/.test(line))return null;
      const m=measure(line);
      const ink=m.advances.map(function(a,i){
        const b=m.bounds?m.bounds[i]:{left:0,right:(i+1<m.advances.length?m.advances[i+1]:m.width)-a};
        return b?{left:a+b.left,right:a+b.right,index:i}:null;
      }).filter(Boolean);
      if(!ink.length)return null;
      return{chars:m.advances.length,advances:m.advances,width:m.width,
        ink:ink,
        ascent:m.ascent>0||m.descent>0?m.ascent:ref.ascent,descent:m.ascent>0||m.descent>0?m.descent:ref.descent};
    });
    const empty=metrics.every(function(m){return !m});
    const result={W:W,H:H,inset:inset,innerW:innerW,innerH:innerH,lines:lines,fontSize:0,
      glyphs:[],empty:empty,track:track,
      textAreaOverflow:innerW<=0||innerH<=0,trackOverflow:false};
    if(empty||result.textAreaOverflow)return result;

    // Every right ink edge must be within innerW of every left edge.
    // Each constraint is linear in font size, even when negative tracking
    // makes character origins cross. Keep the complete feasible interval.
    let fsMin=0,fsMax=Infinity;
    metrics.forEach(function(m){
      if(!m)return;
      m.ink.forEach(function(right){m.ink.forEach(function(left){
        const span=right.right-left.left,available=innerW-(right.index-left.index)*track;
        if(span>0)fsMax=Math.min(fsMax,available/span);
        else if(span<0)fsMin=Math.max(fsMin,available/span);
        else if(available<0)result.trackOverflow=true;
      })});
    });

    // Include every line's ink; an accent or descender on an intermediate
    // line can extend beyond the first/last line at tight line spacing.
    const pitch=refH*spacing;
    let top=Infinity,bottom=-Infinity;
    metrics.forEach(function(m,i){if(m){top=Math.min(top,i*pitch-m.ascent);bottom=Math.max(bottom,i*pitch+m.descent)}});
    const heightPerFs=bottom-top;
    fsMax=Math.min(fsMax,innerH/heightPerFs);
    if(result.trackOverflow||fsMax<=0||fsMax<fsMin){result.trackOverflow=true;return result}
    const fs=fsMax;
    result.fontSize=fs;
    result.letterHeight=fs*Math.max.apply(null,metrics.filter(Boolean).map(function(m){return m.ascent+m.descent}));

    const inkTop=(H-heightPerFs*fs)/2;
    const firstBaseline=inkTop-top*fs;
    metrics.forEach(function(m,i){
      if(!m)return;
      const baseline=firstBaseline+i*pitch*fs;
      const left=Math.min.apply(null,m.ink.map(function(b){return b.left*fs+b.index*track}));
      const right=Math.max.apply(null,m.ink.map(function(b){return b.right*fs+b.index*track}));
      const lineWidth=right-left;
      let x0=inset+(innerW-lineWidth)/2;
      if(state.align==='left')x0=inset;
      if(state.align==='right')x0=W-inset-lineWidth;
      const xs=m.advances.map(function(a,k){return round(x0-left+a*fs+k*track,4)});
      result.glyphs.push({line:i,text:lines[i],baseline:round(baseline,4),xs:xs,width:lineWidth});
    });
    return result;
  }

  function formatLength(mm,unit){
    const u=MM_PER[unit]?unit:'mm';
    const places=u==='mm'?3:u==='cm'?4:5;
    return round(mm/MM_PER[u],places)+'';
  }

  return{MM_PER:MM_PER,MAX_PAGES:MAX_PAGES,DEFAULTS:DEFAULTS,LIMITS:LIMITS,clamp:clamp,round:round,
    sanitizeState:sanitizeState,rowName:rowName,pageName:pageName,paperSize:paperSize,
    calculatePages:calculatePages,getLines:getLines,fitText:fitText,missingChars:missingChars,formatLength:formatLength};
});
