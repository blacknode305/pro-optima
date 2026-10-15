(function(){
  if(window.__PRO_OPTIMA_STOCK_ORDERED_V2)return;window.__PRO_OPTIMA_STOCK_ORDERED_V2=true;
  const base=window.stockDisplay;if(typeof base!=="function")return;
  const n=s=>String(s??"").trim().toLocaleLowerCase("ru-RU");
  const num=v=>{const x=Number(String(v??"").replace(",","."));return Number.isFinite(x)?x:null};
  const fmt=v=>Number.isInteger(v)?String(v):String(Math.round(v*1000)/1000).replace(".",",");
  function itemFor(order,p){return (order.items||[]).find(x=>(x.productId&&Number(x.productId)===Number(p.id))||n(x.product)===n(p.name))||null}
  function lastSnapshot(p,branch,date){
    const rows=[];for(const o of (orderHistory||[])){if(n(o.branch)!==n(branch)||String(o.requestDate||"")>String(date||"9999-12-31")||String(o.stage||"")==="cancelled")continue;const it=itemFor(o,p);if(!it||it.stock===undefined||it.stock===null||it.stock==="")continue;rows.push({o,it})}
    rows.sort((a,b)=>String(b.o.requestDate||"").localeCompare(String(a.o.requestDate||""))||String(b.o.createdAt||b.o.updatedAt||"").localeCompare(String(a.o.createdAt||a.o.updatedAt||"")));return rows[0]||null;
  }
  window.stockDisplay=function(p,branch,date){
    const fallback=base.apply(this,arguments),snap=lastSnapshot(p,branch,date);if(!snap)return fallback;
    const value=snap.it.stock;if(value==="-"||snap.it.used===false)return{text:"−",cls:"stock-na",title:"Последний снятый остаток: не используется"};
    const q=num(value);if(q===null)return fallback;const unit=String(snap.it.stockUnit||p.unit||"").trim(),snapTime=String(snap.o.createdAt||snap.o.updatedAt||""),snapDate=String(snap.o.requestDate||"");let ordered=0,otherUnits=false;
    for(const o of (orderHistory||[])){if(n(o.branch)!==n(branch)||String(o.stage||"")==="cancelled")continue;const d=String(o.requestDate||"");if(d<snapDate||d>String(date||"9999-12-31"))continue;if(d===snapDate&&snapTime&&String(o.createdAt||o.updatedAt||"")&&String(o.createdAt||o.updatedAt||"")<snapTime&&String(o.id)!==String(snap.o.id))continue;const it=itemFor(o,p);if(!it||it.used===false)continue;const oq=num(it.expected);if(oq===null||oq<=0)continue;const ou=String(it.unit||p.unit||"").trim();if(unit&&ou&&n(unit)!==n(ou)){otherUnits=true;continue}ordered+=oq}
    const u=unit?` ${unit}`:"",plus=ordered>0?` (+${fmt(ordered)}${u})`:"";return{text:`${fmt(q)}${u}${plus}`,cls:q===0?"stock-zero":"",title:`Последний остаток: ${snapDate||"—"}. Заказано после снятия: ${fmt(ordered)}${u}${otherUnits?". Заказы в других единицах не суммированы.":""}`};
  };
  function ensureStyle(){if(document.getElementById("poStockOrderedStyle"))return;const s=document.createElement("style");s.id="poStockOrderedStyle";s.textContent='.stock-ordered-plus{color:#23834f;font-weight:800}html[data-theme="dark"] .stock-ordered-plus{color:#75d49b}';document.head.appendChild(s)}
  function decorate(){ensureStyle();document.querySelectorAll("#stockTableWrap .stock-table td").forEach(td=>{const text=td.textContent||"",m=text.match(/^(.*?)(\s*\(\+[^)]+\))$/);if(!m)return;td.textContent="";td.append(document.createTextNode(m[1]));const span=document.createElement("span");span.className="stock-ordered-plus";span.textContent=m[2];td.append(span)})}
  const renderBase=window.renderStocks;if(typeof renderBase==="function")window.renderStocks=function(...args){const out=renderBase.apply(this,args);decorate();return out};
  if(typeof window.renderStocks==="function")window.renderStocks();
})();
