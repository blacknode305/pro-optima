(function(){
  if(window.__PRO_OPTIMA_ORDER_CARD_HISTORY_V2)return;window.__PRO_OPTIMA_ORDER_CARD_HISTORY_V2=true;
  const norm=s=>String(s??"").trim().toLocaleLowerCase("ru-RU");
  const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");
  const fd=v=>{if(!v)return"—";const[y,m,d]=String(v).split("-");return d&&m&&y?`${d}.${m}.${y}`:String(v)};
  const shortId=id=>{const s=String(id||"");return s.length>12?s.slice(-10):s||"—"};
  const statusText=o=>typeof historyStatusText==="function"?historyStatusText(o):({received:"Получена с производства",sent:"Ждёт подтверждения",confirmed:"Ожидается",expected:"Ожидается",done:"Исполнено",cancelled:"Отменено"}[String(o?.stage||"received")]||"Заявка");
  const localIso=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return`${y}-${m}-${day}`};
  function selectedRequestDate(dayIndex){
    const d=new Date();d.setHours(12,0,0,0);const delta=(Number(dayIndex)-d.getDay()+7)%7;d.setDate(d.getDate()+delta);return localIso(d);
  }
  function ensureStyle(){
    if(document.getElementById("poOrderCardStatusStyle"))return;
    const s=document.createElement("style");s.id="poOrderCardStatusStyle";s.textContent=`
      .po-card-submit{margin:8px 10px 9px 48px;border:1px solid #d7e0e5;border-radius:7px;background:#fafcfd;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .po-card-submit-main{display:flex;align-items:center;gap:8px;min-width:0}.po-card-submit-dot{width:10px;height:10px;border-radius:50%;background:#aab5bb;flex:0 0 auto}.po-card-submit.ok{background:#f1faf4;border-color:#b9dbc3}.po-card-submit.ok .po-card-submit-dot{background:#36a267}.po-card-submit.cancelled{background:#fff8ef;border-color:#e3c89e}.po-card-submit.cancelled .po-card-submit-dot{background:#d29234}.po-card-submit.none{background:#fafbfc;border-style:dashed}.po-card-submit-title{font-size:12px;font-weight:700;color:#34464f}.po-card-submit-meta{font-size:11px;color:#687982;margin-top:2px}.po-card-submit-open{padding:4px 7px;font-size:10px}
      .history-filters.po-date-filtered{grid-template-columns:170px 170px minmax(220px,1fr) 160px 160px auto}.po-date-reset{align-self:end;height:34px}
      html[data-theme="dark"] .po-card-submit{background:#202a30;border-color:#3a4a52}.po-card-submit.ok{background:#203328;border-color:#42634d}.po-card-submit.cancelled{background:#352d22;border-color:#665439}
      @media(max-width:980px){.history-filters.po-date-filtered{grid-template-columns:1fr 1fr}.history-filters.po-date-filtered .field{grid-column:auto}.history-filters.po-date-filtered .field:nth-child(3){grid-column:1/-1}.po-date-reset{height:auto}}
      @media(max-width:620px){.po-card-submit{margin:7px 0;width:100%}.history-filters.po-date-filtered{grid-template-columns:1fr}.history-filters.po-date-filtered .field:nth-child(3){grid-column:auto}}
    `;document.head.appendChild(s);
  }
  function rowsForDate(supplier,branch,date){
    if(typeof orderHistory==="undefined"||!Array.isArray(orderHistory))return[];
    return orderHistory.filter(o=>norm(o.supplier)===norm(supplier)&&norm(o.branch)===norm(branch)&&String(o.requestDate||"")===String(date||""))
      .sort((a,b)=>String(b.createdAt||b.updatedAt||"").localeCompare(String(a.createdAt||a.updatedAt||"")));
  }
  function statusHtml(rows,date){
    if(!rows.length)return `<div class="po-card-submit none"><div class="po-card-submit-main"><span class="po-card-submit-dot"></span><div><div class="po-card-submit-title">Заявка за ${esc(fd(date))} ещё не поступила</div><div class="po-card-submit-meta">Остатки по этому поставщику ещё не сняты / форма не отправлена.</div></div></div></div>`;
    const active=rows.find(o=>String(o.stage||"")!=="cancelled")||rows[0],cancelled=String(active.stage||"")==="cancelled",items=Array.isArray(active.items)?active.items.length:0;
    return `<div class="po-card-submit ${cancelled?"cancelled":"ok"}"><div class="po-card-submit-main"><span class="po-card-submit-dot"></span><div><div class="po-card-submit-title">${cancelled?"Заявка отменена":"✓ Остатки сняты · заявка подана"} · ${esc(fd(date))}</div><div class="po-card-submit-meta">№ ${esc(shortId(active.id))} · ${esc(statusText(active))} · товаров: ${items}${rows.length>1?` · заявок за день: ${rows.length}`:""}</div></div></div><button type="button" class="small secondary po-card-submit-open" data-order-id="${esc(active.id)}">Открыть</button></div>`;
  }
  function decorateCards(){
    ensureStyle();if(typeof buildOrderPlan!=="function")return;
    const plan=buildOrderPlan(),date=selectedRequestDate(plan.dayIndex),cards=[...document.querySelectorAll("#orderPlan .order-card")];
    cards.forEach((card,i)=>{card.querySelector(".po-card-submit")?.remove();card.querySelector(".po-card-history")?.remove();const r=plan.rows?.[i];if(!r)return;const holder=document.createElement("div");holder.innerHTML=statusHtml(rowsForDate(r.s?.name,plan.branch,date));const el=holder.firstElementChild,actions=card.querySelector(".order-card-actions");if(actions)card.insertBefore(el,actions);else card.appendChild(el);el.querySelector(".po-card-submit-open")?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();if(typeof editHistoryOrder==="function")editHistoryOrder(e.currentTarget.dataset.orderId)})});
  }
  function ensureDateFilters(){
    ensureStyle();const wrap=document.querySelector(".history-filters");if(!wrap)return;wrap.classList.add("po-date-filtered");
    if(!document.getElementById("historyDateFrom")){const f=document.createElement("div");f.className="field";f.innerHTML='<label>Дата заявки с</label><input id="historyDateFrom" type="date">';wrap.appendChild(f);f.querySelector("input").addEventListener("change",()=>window.renderHistory?.())}
    if(!document.getElementById("historyDateTo")){const f=document.createElement("div");f.className="field";f.innerHTML='<label>Дата заявки по</label><input id="historyDateTo" type="date">';wrap.appendChild(f);f.querySelector("input").addEventListener("change",()=>window.renderHistory?.())}
    if(!document.getElementById("historyDateReset")){const b=document.createElement("button");b.id="historyDateReset";b.type="button";b.className="secondary po-date-reset";b.textContent="Сбросить даты";b.addEventListener("click",()=>{document.getElementById("historyDateFrom").value="";document.getElementById("historyDateTo").value="";window.renderHistory?.()});wrap.appendChild(b)}
  }
  const basePlan=window.renderOrderPlan;if(typeof basePlan==="function")window.renderOrderPlan=function(...args){const out=basePlan.apply(this,args);decorateCards();return out};
  const baseHistory=window.renderHistory;if(typeof baseHistory==="function")window.renderHistory=function(...args){
    ensureDateFilters();const from=document.getElementById("historyDateFrom")?.value||"",to=document.getElementById("historyDateTo")?.value||"";
    if((!from&&!to)||typeof orderHistory==="undefined"||!Array.isArray(orderHistory))return baseHistory.apply(this,args);
    const full=orderHistory;orderHistory=full.filter(o=>(!from||String(o.requestDate||"")>=from)&&(!to||String(o.requestDate||"")<=to));
    try{return baseHistory.apply(this,args)}finally{orderHistory=full;const badge=document.getElementById("historyNavCount");if(badge&&typeof historyStatus==="function"){const active=full.filter(r=>["received","sent","expected","today"].includes(historyStatus(r))).length;badge.textContent=active}}
  };
  ensureDateFilters();decorateCards();
})();
