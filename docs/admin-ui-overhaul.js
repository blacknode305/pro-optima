"use strict";

(function(){
  const PO_BRANCHES=["Горняк","Лободы","Нуркена"];
  const PO_BRANCH_LABELS={"ГОРНЯК":"Горняк","ЛОБОДЫ":"Лободы","НУРКЕН":"Нуркена","НУРКЕНА":"Нуркена"};
  const PO_DAYS=["Понедельник","Вторник","Среда","Четверг","Пятница","Суббота","Воскресенье"];
  const PO_DAY_SHORT={"Понедельник":"Пн","Вторник":"Вт","Среда":"Ср","Четверг":"Чт","Пятница":"Пт","Суббота":"Сб","Воскресенье":"Вс"};
  const branchLabel=value=>PO_BRANCH_LABELS[String(value??"").trim().toLocaleUpperCase("ru-RU")]||String(value??"").trim();
  const branchKey=value=>{const key=normalize(value);return key==="нуркен"||key==="нуркена"?"нуркена":key};
  const canonicalBranch=value=>{const key=branchKey(value);return key==="горняк"?"Горняк":key==="лободы"?"Лободы":key==="нуркена"?"Нуркена":""};
  window.displayBranchName=window.displayBranchName||branchLabel;

  function removeGeneratedClearControls(root=document){
    root.querySelectorAll(".clear-wrap").forEach(wrap=>{
      const input=wrap.querySelector("input");
      if(input&&wrap.parentNode){wrap.parentNode.insertBefore(input,wrap);wrap.remove()}
    });
    root.querySelectorAll(".clear-btn").forEach(x=>x.remove());
  }
  window.enhanceClearInputs=removeGeneratedClearControls;
  window.updateClearInput=function(){};

  function setNavLabel(id,text){
    const button=document.getElementById(id);if(!button)return;
    const badge=button.querySelector(".count-badge");
    [...button.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).forEach(n=>n.remove());
    button.insertBefore(document.createTextNode(text+" "),badge||button.firstChild);
  }
  function renameStaticUi(){
    setNavLabel("navProducts","Наименования");
    setNavLabel("navProposals","Каталог");
    setNavLabel("navOffers","Заказник");
    const headings=[...document.querySelectorAll("h2")];
    headings.forEach(h=>{
      const t=h.textContent.trim();
      if(t==="Используемые товары")h.textContent="Наименования";
      if(t==="Предложения из прайс-листов")h.textContent="Каталог прайс-листов";
      if(t==="Товары поставщиков")h.textContent="Заказник";
    });
    const viewProposals=document.getElementById("viewProposals");
    const hint=viewProposals?.querySelector(".muted");
    if(hint)hint.textContent="Полный каталог поставщиков. Непривязанные позиции остаются в каталоге и не становятся рабочими наименованиями автоматически. Привязка создаёт аналог нашего товара, но не добавляет позицию в «Наименования».";
    const usage=document.getElementById("compareUsageFilter");
    if(usage){
      const used=[...usage.options].find(x=>x.value==="used"),unused=[...usage.options].find(x=>x.value==="unused");
      if(used)used.textContent="Наименования";
      if(unused)unused.textContent="Не используются";
    }
  }

  function selectedDays(value){
    return new Set(String(value||"").split(/[,;/]+/).map(x=>normalize(x)).filter(Boolean));
  }
  function dayButtons(key,value=""){
    const selected=selectedDays(value);
    return `<div class="po-day-picker" data-key="${esc(key)}">${PO_DAYS.map(day=>`<button type="button" class="po-day ${selected.has(normalize(day))?"active":""}" data-day="${esc(day)}" title="${esc(day)}">${PO_DAY_SHORT[day]}</button>`).join("")}</div>`;
  }
  function scheduleCard(branch,row=null,options={}){
    const editable=!!options.editableBranch;
    const active=options.enabled===true||!!row;
    const value=row?.branch||branch||"";
    return `<div class="po-schedule ${active?"":"is-disabled"}" data-had-schedule="${row?"1":"0"}">
      <div class="po-schedule-head">
        <label class="po-schedule-enable"><input type="checkbox" data-key="enabled" ${active?"checked":""}> <span>${esc(branchLabel(value)||"Новый филиал")}</span></label>
        ${editable?`<input class="po-branch-input" data-key="branch" value="${esc(value)}" placeholder="Название филиала">`:`<input type="hidden" data-key="branch" value="${esc(value)}">`}
      </div>
      <div class="po-schedule-days">
        <div><label>Дни заявки</label>${dayButtons("order",row?.order||"")}</div>
        <div><label>Дни поставки</label>${dayButtons("delivery",row?.delivery||"")}</div>
      </div>
      <div class="po-schedule-note"><label>Примечание</label><input data-key="note" value="${esc(row?.note||"")}" placeholder="Например: поставка на следующий день"></div>
    </div>`;
  }
  function updateScheduleState(card){
    const enabled=card?.querySelector('[data-key="enabled"]');
    card?.classList.toggle("is-disabled",enabled&&!enabled.checked);
  }
  function bindScheduleRoot(root){
    if(!root||root.dataset.poBound==="1")return;
    root.dataset.poBound="1";
    root.addEventListener("click",event=>{
      const btn=event.target.closest(".po-day");if(!btn)return;
      event.preventDefault();btn.classList.toggle("active");
      const card=btn.closest(".po-schedule"),enabled=card?.querySelector('[data-key="enabled"]');
      if(enabled)enabled.checked=true;updateScheduleState(card);
    });
    root.addEventListener("change",event=>{
      if(event.target.matches('[data-key="enabled"]'))updateScheduleState(event.target.closest(".po-schedule"));
    });
    root.addEventListener("input",event=>{
      if(!event.target.matches('[data-key="note"],.po-branch-input'))return;
      const card=event.target.closest(".po-schedule"),enabled=card?.querySelector('[data-key="enabled"]');
      if(enabled&&String(event.target.value||"").trim())enabled.checked=true;updateScheduleState(card);
      if(event.target.matches(".po-branch-input")){
        const label=card?.querySelector(".po-schedule-enable span");if(label)label.textContent=branchLabel(event.target.value)||"Новый филиал";
      }
    });
  }
  function readScheduleRoot(root){
    const rows=[],seen=new Set();
    for(const card of root.querySelectorAll(".po-schedule")){
      if(!card.querySelector('[data-key="enabled"]')?.checked)continue;
      const rawBranch=card.querySelector('[data-key="branch"]')?.value.trim()||"";
      const branch=canonicalBranch(rawBranch);
      const days=key=>[...card.querySelectorAll(`.po-day-picker[data-key="${key}"] .po-day.active`)].map(x=>x.dataset.day).join(", ");
      const order=days("order"),delivery=days("delivery"),note=card.querySelector('[data-key="note"]')?.value.trim()||"";
      if(!rawBranch)throw new Error("Укажите название филиала.");
      if(!branch)throw new Error("Допустимы только филиалы: Горняк, Лободы, Нуркена.");
      const key=branchKey(branch);
      if(seen.has(key))throw new Error(`Филиал «${branchLabel(branch)}» указан дважды.`);
      seen.add(key);
      if(!order)throw new Error(`Для «${branchLabel(branch)}» выберите хотя бы один день заявки.`);
      if(!delivery)throw new Error(`Для «${branchLabel(branch)}» выберите хотя бы один день поставки.`);
      rows.push({branch,order:canonicalDayList(order),delivery:canonicalDayList(delivery),note});
    }
    return rows;
  }

  function installAddSupplierBuilder(){
    const card=document.getElementById("addSupplierCard"),body=card?.querySelector(".details-body");if(!body)return;
    const old=document.getElementById("messageText");
    if(old){
      const label=old.previousElementSibling;
      if(label&&label.tagName==="LABEL")label.remove();
      old.remove();
    }
    let root=document.getElementById("poNewSupplierSchedules");
    if(!root){
      root=document.createElement("div");root.id="poNewSupplierSchedules";root.className="po-schedule-grid";
      const title=document.createElement("div");title.className="po-schedule-title";title.textContent="Графики по филиалам";
      const help=document.createElement("div");help.className="muted po-schedule-help";help.textContent="Отметьте филиалы, выберите кнопками дни заявки и дни поставки. Примечание сохраняется отдельно для каждого филиала.";
      const actions=body.querySelector(".actions");
      body.insertBefore(title,actions);body.insertBefore(help,actions);body.insertBefore(root,actions);
    }
    root.innerHTML=PO_BRANCHES.map(x=>scheduleCard(x,null,{enabled:false})).join("");
    bindScheduleRoot(root);
  }

  window.addSupplierMessage=function(){
    const name=document.getElementById("supplier")?.value.trim()||"";
    const contact=document.getElementById("contact")?.value.trim()||"";
    const phone=document.getElementById("phone")?.value.trim()||"";
    if(!name)return show("supplierMsg","Введите название поставщика.","err");
    let rows;
    try{rows=readScheduleRoot(document.getElementById("poNewSupplierSchedules"))}catch(e){return show("supplierMsg",e.message,"err")}
    if(!rows.length)return show("supplierMsg","Выберите хотя бы один филиал и его график.","err");
    let supplier=db.find(x=>normalize(x.name)===normalize(name));
    if(!supplier){supplier={id:uid("s"),name,contact,phone,schedules:[]};db.push(supplier)}else{supplier.contact=contact;supplier.phone=phone}
    let added=0,updated=0;
    rows.forEach(row=>{
      const old=supplier.schedules.find(x=>branchKey(x.branch)===branchKey(row.branch));
      if(old){Object.assign(old,row);updated++}else{supplier.schedules.push(row);added++}
    });
    saveSuppliers();window.clearSupplierForm();updateBranchFilter();renderSuppliers();
    show("supplierMsg",`«${name}»: добавлено ${added}, обновлено ${updated}.`,"ok");
  };
  window.clearSupplierForm=function(){
    ["supplier","contact","phone"].forEach(id=>{const x=document.getElementById(id);if(x)x.value=""});
    installAddSupplierBuilder();
  };

  window.editSupplier=function(si){
    const supplier=db[si];if(!supplier)return;
    const byBranch=new Map((supplier.schedules||[]).map(r=>[branchKey(r.branch),r]));
    const known=PO_BRANCHES.map(branch=>scheduleCard(branch,byBranch.get(branchKey(branch))||null,{enabled:byBranch.has(branchKey(branch))}));
    const custom=[];
    openModal("Редактирование поставщика",`<div id="modalError" class="modal-error"></div>
      <div class="modal-field"><label>Название</label><input id="editSupplierName" value="${esc(supplier.name)}"></div>
      <div class="modal-grid"><div class="modal-field"><label>Контакт</label><input id="editSupplierContact" value="${esc(supplier.contact)}"></div><div class="modal-field"><label>Телефон</label><input id="editSupplierPhone" value="${esc(supplier.phone)}"></div></div>
      <div class="po-schedule-title">Графики по филиалам</div>
      <div id="poEditSupplierSchedules" class="po-schedule-grid">${known.join("")}${custom.join("")}</div>`,
      `<button class="secondary" onclick="closeModal()">Отмена</button><button class="primary" onclick="saveSupplierEdit(${si})">Сохранить</button>`);
    bindScheduleRoot(document.getElementById("poEditSupplierSchedules"));
    removeGeneratedClearControls(document.getElementById("modalBody"));
  };
  window.addScheduleField=function(){
    const root=document.getElementById("poEditSupplierSchedules");if(!root)return;
    const holder=document.createElement("div");holder.innerHTML=scheduleCard("",null,{editableBranch:true,enabled:true});
    root.appendChild(holder.firstElementChild);bindScheduleRoot(root);
  };
  window.saveSupplierEdit=async function(si){
    const supplier=db[si],name=document.getElementById("editSupplierName")?.value.trim()||"";if(!supplier)return;
    if(!name)return modalError("Введите название.");
    if(db.some((x,i)=>i!==si&&normalize(x.name)===normalize(name)))return modalError("Такой поставщик уже есть.");
    const root=document.getElementById("poEditSupplierSchedules");
    const removing=[...root.querySelectorAll('.po-schedule[data-had-schedule="1"]')].some(card=>!card.querySelector('[data-key="enabled"]')?.checked);
    if(removing&&!(await requestProtectedPassword("delete")))return;
    let schedules;try{schedules=readScheduleRoot(root)}catch(e){return modalError(e.message)}
    const oldName=supplier.name;
    supplier.name=name;supplier.contact=document.getElementById("editSupplierContact")?.value.trim()||"";supplier.phone=document.getElementById("editSupplierPhone")?.value.trim()||"";supplier.schedules=schedules;
    products.forEach(product=>productOrderLinks(product).forEach(link=>{
      if(link.supplierId===supplier.id||(!link.supplierId&&normalize(link.supplier)===normalize(oldName))){link.supplierId=supplier.id;link.supplier=name}
    }));
    saveSuppliers();saveProducts();updateBranchFilter();renderSuppliers();renderProducts();refreshOfferSelectors();renderSupplierOffers();closeModal();
  };

  const baseRenderSupplierOffers=window.renderSupplierOffers;
  if(typeof baseRenderSupplierOffers==="function"){
    window.renderSupplierOffers=function(){
      const branch=document.getElementById("offerBranch")?.value||"*";
      if(branch==="*")return baseRenderSupplierOffers();
      const original=supplierOffers;
      supplierOffers=original.filter(offer=>{
        const product=productById(offer.productId);
        return !product||productUsedOnBranch(product,branch);
      });
      try{return baseRenderSupplierOffers()}finally{supplierOffers=original}
    };
  }
  const baseSaveSupplierOffer=window.saveSupplierOffer;
  if(typeof baseSaveSupplierOffer==="function"){
    window.saveSupplierOffer=function(){
      const branch=document.getElementById("offerBranch")?.value||"*",product=resolveProductInput?.();
      if(branch!=="*"&&product&&!productUsedOnBranch(product,branch))return show("offerMsg",`«${product.name}» не используется в филиале ${branchLabel(branch)} и не может быть добавлен в заказник этого филиала.`,"err");
      return baseSaveSupplierOffer();
    };
  }
  const baseSaveProductEdit=window.saveProductEdit;
  if(typeof baseSaveProductEdit==="function"){
    window.saveProductEdit=function(i){
      const out=baseSaveProductEdit(i);
      try{renderSupplierOffers();renderStocks();renderOrderPlan()}catch{}
      return out;
    };
  }

  function postRenderLabels(){
    document.querySelectorAll("select").forEach(select=>{
      if(!/branch|production|производ|филиал/i.test(`${select.id} ${select.name||""}`))return;
      [...select.options].forEach(option=>{const label=PO_BRANCH_LABELS[String(option.value||option.textContent).trim().toLocaleUpperCase("ru-RU")];if(label)option.textContent=label});
    });
    document.querySelectorAll(".bname,.schedule-line b,.stock-table th,.stat b").forEach(el=>{
      const label=PO_BRANCH_LABELS[el.textContent.trim().toLocaleUpperCase("ru-RU")];if(label)el.textContent=label;
    });
    document.querySelectorAll(".product-meta").forEach(el=>{
      if(!/^Не используется:/i.test(el.textContent.trim()))return;
      let text=el.textContent;
      for(const [raw,label] of Object.entries(PO_BRANCH_LABELS))text=text.replaceAll(raw,label);
      if(text!==el.textContent)el.textContent=text;
    });
  }

  installAddSupplierBuilder();renameStaticUi();removeGeneratedClearControls();postRenderLabels();
  const observer=new MutationObserver(()=>{removeGeneratedClearControls();postRenderLabels()});
  observer.observe(document.body,{subtree:true,childList:true});
})();