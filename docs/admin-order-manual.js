
"use strict";
(function(){
  if(typeof buildOrderPlan!=="function"||typeof openModal!=="function")return;
  const escH=v=>esc(v), norm=v=>String(v??"").trim().toLocaleLowerCase("ru-RU");
  const same=(a,b)=>norm(a)===norm(b);
  const today=()=>{const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const p=k=>parts.find(x=>x.type===k)?.value||"";return p("year")+"-"+p("month")+"-"+p("day")};
  const weekday=iso=>new Date(iso+"T12:00:00Z").getUTCDay();
  const plusDays=(iso,n)=>{const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
  const nextDate=d=>{const t=today();return plusDays(t,(Number(d)-weekday(t)+7)%7)};
  const status=stage=>({received:"Получена",new:"Не заполнена",sent:"Подана в обработку",confirmed:"Подтверждена оператором",expected:"Подтверждена оператором",done:"Исполнено",cancelled:"Отменена"}[stage]||"Не заполнена");
  const locked=stage=>["confirmed","expected","done","cancelled"].includes(String(stage||""));
  const UNITS=["шт","кг","г","л","мл","м","см","мм","м²","м³","т","уп","пач","б","бут","бан","кор","ящ","меш","рул","лист","пара","компл","набор"];
  let state=null,saving=false;
  const style=document.createElement("style");style.id="poManualOrderStyle";style.textContent=`
    #modalBackdrop.po-manual-open .modal{width:min(1250px,calc(100vw - 22px))!important;max-width:calc(100vw - 22px)!important;max-height:95vh!important;display:flex;flex-direction:column;overflow:hidden}
    #modalBackdrop.po-manual-open .modal-head,#modalBackdrop.po-manual-open .modal-footer{flex:none}
    #modalBackdrop.po-manual-open .modal-body{min-height:0;overflow:auto;flex:1}
    #modalBackdrop.po-manual-open #modalTitle{overflow-wrap:anywhere}
    .po-manual-details{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}
    .po-manual-details span{font-size:11px;color:var(--po-text,#344b58);border-radius:7px;padding:6px 8px;border:1px solid var(--po-line,#d8e3e9);background:var(--po-surface-soft,#f4f8fa)}
    .po-manual-panel{border:1px solid var(--po-line,#dae3e8);background:var(--po-surface,#fff);border-radius:11px;overflow:hidden;min-width:0}
    .po-manual-panel-title{font-size:14px;font-weight:750;padding:12px;background:var(--po-surface-soft,#f6f9fa);border-bottom:1px solid var(--po-line,#dae3e8)}
    .po-manual-muted{font-size:11px;color:var(--po-muted,#6b7c85)}
    .po-manual-form{padding:10px}
    .po-manual-dates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:10px}
    .po-manual-dates label{display:block;margin:0 0 5px}
    .po-manual-dates input{width:100%;min-width:0}
    .po-manual-header,.po-manual-row{display:grid;grid-template-columns:minmax(190px,1.75fr) minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:center}
    .po-manual-header{font-size:11px;font-weight:750;color:var(--po-muted,#6e7f88);padding:8px 3px}
    .po-manual-row{border-top:1px solid var(--po-line,#e5eaed);padding:10px 3px}
    .po-manual-name{font-size:13px;font-weight:650;overflow-wrap:anywhere;line-height:1.4;min-width:0}
    .po-manual-price{display:block;font-size:11px;font-weight:600;line-height:1.45;color:var(--po-muted,#627e8d);margin-top:4px;white-space:normal}
    .po-manual-index{display:inline-block;margin-right:7px;color:var(--po-muted,#7a8a93);font-weight:500;font-size:11px}
    .po-manual-qty{display:grid;grid-template-columns:minmax(0,1fr) 68px;gap:4px;min-width:0}
    .po-manual-qty input,.po-manual-qty select{width:100%;min-width:0;height:36px;padding:5px;text-align:center;font-size:12px}
    .po-manual-row.unused{opacity:.58;background:var(--po-surface-soft,#f6f8fa)}
    .po-manual-msg{font-size:12px;line-height:1.45;margin-top:10px;padding:10px;border-radius:8px;background:#edf3f6;color:#35536a}
    .po-manual-msg.bad{background:#fee8e8;color:#8f3535}.po-manual-msg.ok{background:#eaf6ed;color:#297043}
    html[data-theme="dark"] .po-manual-msg{background:#293a44;color:#d9e8f0}
    @media(max-width:780px){.po-manual-qty{grid-template-columns:minmax(0,1fr)}.po-manual-qty input,.po-manual-qty select{height:33px}.po-manual-header,.po-manual-row{grid-template-columns:minmax(110px,1.45fr) minmax(0,1fr) minmax(0,1fr);gap:6px}.po-manual-name{font-size:12px}}
  `;document.head.appendChild(style);
  const options=u=>[...new Set([u,...(typeof window.PRO_OPTIMA_GET_UNIT_PRESETS==="function"?window.PRO_OPTIMA_GET_UNIT_PRESETS():UNITS)].filter(Boolean))]
    .map(v=>`<option value="${escH(v)}" ${v===u?"selected":""}>${escH(v)}</option>`).join("");
  const currentFor=(branch,supplier,date,history)=>(history||[])
    .filter(o=>same(o.branch,branch)&&o.requestDate===date&&(String(o.supplierId||"")===String(supplier.id)||same(o.supplier,supplier.name)))
    .sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")))[0]||null;
  function itemsFor(planItems,old){
    const list=planItems.map(x=>({id:x.p.id,name:x.p.name,unit:x.orderUnit||x.p.unit||"шт",product:x.p,offer:x.o||null}));
    for(const x of old?.items||[]){
      if(list.some(e=>(e.id!=null&&String(e.id)===String(x.productId))||same(e.name,x.product)))continue;
      list.push({id:x.productId||null,name:x.product||"Товар",unit:x.unit||"шт",product:null,legacy:true});
    }
    return list;
  }
  function previous(item,order){
    return (order?.items||[]).find(x=>item.id!=null&&String(x.productId||"")===String(item.id))||
      (order?.items||[]).find(x=>same(x.product,item.name))||{};
  }
  function msg(text,bad=false){
    const el=document.getElementById("poManualMsg");if(!el)return;
    el.textContent=text;el.className="po-manual-msg"+(bad?" bad":"");
  }
  function nextDelivery(date){
    const d=new Date(date+"T12:00:00");return Number.isFinite(d.getTime())&&typeof nearestDeliveryDate==="function"?nearestDeliveryDate(d,state.supplier,state.branch):date;
  }
  function formRow(x,index,old){
    const p=previous(x,old),unit=p.unit||x.unit,stockUnit=p.stockUnit||x.product?.unit||unit;
    const excluded=p.used===false||String(p.stock??"").trim()==="-";
    const stock=excluded?"-":p.stock??"",ordered=excluded?"0":p.expected??"";
    return `<div class="po-manual-row ${excluded?"unused":""}" data-index="${index}">
      <div class="po-manual-name"><span class="po-manual-index">${index+1}.</span>${escH(x.name)}${x.offer&&hasPrice(x.offer)?`<span class="po-manual-price">Цена: ${escH(money(x.offer.price))}${typeof offerUnit==="function"&&offerUnit(x.offer)?` / ${escH(offerUnit(x.offer))}`:""}</span>`:""}${x.legacy?'<div class="po-manual-muted">Ранее сохранённый товар</div>':""}</div>
      <div class="po-manual-qty"><input class="po-manual-stock" aria-label="Остаток ${escH(x.name)}" inputmode="decimal" value="${escH(stock)}" placeholder="0 / -"><select class="po-manual-stock-unit" aria-label="Единица остатка">${options(stockUnit)}</select></div>
      <div class="po-manual-qty"><input class="po-manual-order" aria-label="Заказ ${escH(x.name)}" inputmode="decimal" value="${escH(ordered)}" placeholder="0" ${excluded?"disabled":""}><select class="po-manual-order-unit" aria-label="Единица заказа" ${excluded?"disabled":""}>${options(unit)}</select></div>
    </div>`;
  }
  function refill(old){
    if(!state||!document.getElementById("poManualRows"))return;
    state.existing=old;state.entries=itemsFor(state.items,old);
    document.getElementById("poManualRows").innerHTML=state.entries.map((x,i)=>formRow(x,i,old)).join("");
    if(old?.deliveryDate)document.getElementById("poManualDelivery").value=old.deliveryDate;
    else document.getElementById("poManualDelivery").value=nextDelivery(document.getElementById("poManualDate").value);
    const isLocked=locked(old?.stage);
    document.getElementById("poManualStatus").textContent=status(old?.stage);
    document.getElementById("poManualSave").disabled=isLocked;
    document.querySelectorAll("#poManualRows input,#poManualRows select").forEach(x=>{if(isLocked)x.disabled=true});
    msg(isLocked?"Эта заявка уже подтверждена или исполнена. Доступен только просмотр.":"Остаток «-» — товар не используется. Нажмите «Сохранить заявку», чтобы отправить данные в Railway.");
  }
  function open(supplierId){
    const plan=buildOrderPlan(),r=plan.rows.find(x=>String(x.s.id)===String(supplierId));
    if(!r||r.excluded)return;
    const date=nextDate(plan.dayIndex),old=currentFor(plan.branch,r.s,date,orderHistory);
    state={branch:plan.branch,dayIndex:plan.dayIndex,supplier:r.s,items:r.items,existing:old,entries:[]};
    const body=`<div class="po-manual-details"><span>Производство: <b>${escH(plan.branch)}</b></span><span>Поставщик: <b>${escH(r.s.name)}</b></span><span>Позиций: <b>${r.items.length}</b></span><span id="poManualStatus">${escH(status(old?.stage))}</span></div>
      <section class="po-manual-panel"><div class="po-manual-panel-title">Товары и заявка</div><div class="po-manual-form">
        <div class="po-manual-dates"><div><label for="poManualDate">Дата заявки</label><input id="poManualDate" type="date" value="${date}"></div>
        <div><label for="poManualDelivery">Дата поставки</label><input id="poManualDelivery" type="date"></div></div>
        <div class="po-manual-header"><div>Наименование</div><div>Остаток / ед.</div><div>Заказ / ед.</div></div><div id="poManualRows"></div><div id="poManualMsg" class="po-manual-msg"></div>
      </div></section>`;
    openModal("Заявка",body,'<button class="secondary" type="button" onclick="closeModal()">Закрыть</button><button class="primary" id="poManualSave" type="button">Сохранить заявку</button>');
    document.getElementById("modalBackdrop").classList.add("po-manual-open");
    refill(old);
    document.getElementById("poManualSave").addEventListener("click",save);
    document.getElementById("poManualRows").addEventListener("input",e=>{
      if(!e.target.matches(".po-manual-stock"))return;
      const row=e.target.closest(".po-manual-row"),off=e.target.value.trim()==="-";
      row.classList.toggle("unused",off);
      row.querySelector(".po-manual-order").disabled=off;row.querySelector(".po-manual-order-unit").disabled=off;
      if(off)row.querySelector(".po-manual-order").value="0";
    });
    document.getElementById("poManualDate").addEventListener("change",()=>{
      const d=document.getElementById("poManualDate").value;if(!d)return;
      refill(currentFor(state.branch,state.supplier,d,orderHistory));
    });
    // Remove widened modal styling when any closing route runs (button, Escape, overlay).
    const modal=document.getElementById("modalBackdrop");
    const observer=new MutationObserver(()=>{if(!modal.classList.contains("open")){modal.classList.remove("po-manual-open");state=null;observer.disconnect()}});
    observer.observe(modal,{attributes:true,attributeFilter:["class"]});
  }
  function readNumber(value,label,dash){
    const t=String(value??"").trim();if(dash&&t==="-")return "-";if(!t)return 0;
    if(!/^\d+(?:[.,]\d+)?$/.test(t))throw Error("Некорректное количество: "+label);
    const n=Number(t.replace(",","."));if(!Number.isFinite(n)||n<0)throw Error("Недопустимое количество: "+label);return n;
  }
  function collect(){
    const date=document.getElementById("poManualDate").value,delivery=document.getElementById("poManualDelivery").value;
    if(!/^\d{4}-\d\d-\d\d$/.test(date)||!/^\d{4}-\d\d-\d\d$/.test(delivery)||!Number.isFinite(Date.parse(date))||!Number.isFinite(Date.parse(delivery)))throw Error("Укажите даты заявки и поставки.");
    if(weekday(date)!==state.dayIndex)throw Error("Дата заявки не соответствует выбранному дню недели. Укажите соответствующую дату.");
    if(delivery<date)throw Error("Поставка не может быть раньше заявки.");
    const items=[...document.querySelectorAll("#poManualRows .po-manual-row")].map((row,i)=>{
      const x=state.entries[i],old=previous(x,state.existing);
      const stock=readNumber(row.querySelector(".po-manual-stock").value,"остаток: "+x.name,true),off=stock==="-";
      const expected=off?0:readNumber(row.querySelector(".po-manual-order").value,"заказ: "+x.name,false);
      const unit=row.querySelector(".po-manual-order-unit").value||x.unit,stockUnit=row.querySelector(".po-manual-stock-unit").value||x.unit;
      return {...old,productId:x.id??old.productId??null,product:x.name,stock,stockUnit,expected,unit,used:!off,delivered:old.delivered??null,deliveredUnit:old.deliveredUnit||unit};
    });
    if(!items.length)throw Error("У поставщика не настроены товары для заявки.");
    if(items.every(x=>(x.stock===0||x.stock==="-")&&x.expected===0))throw Error("Заполните хотя бы один остаток или заказ.");
    return {requestDate:date,deliveryDate:delivery,items};
  }
  async function save(){
    if(saving||!state)return;
    const formState=state,button=document.getElementById("poManualSave");
    try{
      const values=collect();
      if(!adminToken()){setAdminTokenPrompt();if(!adminToken())throw Error("Для сохранения нужен администраторский ключ Railway.");}
      if(!REMOTE_READY||remoteSaving||remotePending.size)throw Error("Сначала завершите сохранение других изменений админки.");
      if(locked(formState.existing?.stage))throw Error("Подтверждённую заявку редактировать нельзя.");
      saving=true;button.disabled=true;msg("Сохранение в Railway...");
      const fresh=await remoteFetch("/api/admin/db"),data=fresh.data;
      if(!data||!Array.isArray(data.history)||!Array.isArray(data.stocks))throw Error("Не удалось прочитать базу Railway.");
      const history=structuredClone(data.history),stocks=structuredClone(data.stocks);
      const live=currentFor(formState.branch,formState.supplier,values.requestDate,history);
      if(formState.existing){
        if(!live||String(live.id)!==String(formState.existing.id)||locked(live.stage))throw Error("Заявка уже изменилась или подтверждена оператором. Обновите страницу.");
        if(Number(live.revision||1)!==Number(formState.existing.revision||1)||String(live.updatedAt||"")!==String(formState.existing.updatedAt||""))throw Error("Другая форма обновила заявку. Откройте её снова.");
      }else if(live)throw Error("Заявка на эту дату уже существует. Откройте её заново.");
      const now=new Date().toISOString(),id=live?.id||"ord_admin_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);
      const order={...live,id,requestDate:values.requestDate,deliveryDate:values.deliveryDate,
        branch:formState.branch,supplier:formState.supplier.name,supplierId:formState.supplier.id,
        period:DAY_LONG[weekday(values.requestDate)]+" → "+DAY_LONG[weekday(values.deliveryDate)],
        items:values.items,stage:"sent",sentAt:live?.sentAt||now,revision:Number(live?.revision||0)+1,
        note:live?.note||"",source:live?.source||"admin-manual",createdAt:live?.createdAt||now,updatedAt:now};
      if(live){const index=history.findIndex(x=>String(x.id)===String(id));if(index<0)throw Error("Заявка пропала из базы.");history[index]=order}
      else history.push(order);
      const nextStocks=stocks.filter(x=>String(x.sourceOrderId||"")!==String(id));
      values.items.forEach(x=>{
        const p=products.find(p=>String(p.id)===String(x.productId))||products.find(p=>same(p.name,x.product));
        if(!p)return;
        nextStocks.push({id:"stock_admin_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,9),
          branch:formState.branch,productId:p.id,date:values.requestDate,value:x.stock,unit:x.stockUnit,
          sourceSupplier:formState.supplier.name,sourceOrderId:id,createdAt:now});
      });
      const out=await remoteFetch("/api/admin/db",{method:"PATCH",body:JSON.stringify({baseRevision:fresh.revision,changes:{history,stocks:nextStocks}})});
      if(!Number.isFinite(Number(out?.revision)))throw Error("Railway не подтвердил сохранение.");
      await reloadRemote();closeModal();state=null;
      show("historyMsg","Заявка сохранена в Railway: "+formState.supplier.name+" · "+values.requestDate+" · "+values.items.length+" товаров.","ok");
    }catch(e){
      msg(e?.status===409?"Версия базы изменилась. Откройте заявку заново.":String(e?.message||e),true);
      console.error("[PRO OPTIMA manual admin order]",e);
    }finally{saving=false;if(button&&document.contains(button)&&!locked(formState.existing?.stage))button.disabled=false}
  }
  window.previewOrderItems=open;
})();
