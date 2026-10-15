(function(){
  if(typeof window.historyById!=="function"||typeof window.openModal!=="function")return;
  const DEFAULT_UNITS=["шт","кг","г","л","мл","м","см","мм","м²","м³","т","уп","пач","б","бут","бан","кор","ящ","меш","рул","лист","пара","компл","набор"];
  const currentUnits=()=>typeof window.PRO_OPTIMA_GET_UNIT_PRESETS==="function"?window.PRO_OPTIMA_GET_UNIT_PRESETS():[...DEFAULT_UNITS];
  const unitOptions=v=>{v=String(v||"").trim();const a=[...currentUnits()];if(v&&!a.includes(v))a.unshift(v);if(!a.length)a.push(v||"");return a.map(x=>`<option value="${window.esc(x)}" ${x===v?"selected":""}>${window.esc(x)||"—"}</option>`).join("")};
  const css=document.createElement("style");css.textContent=`.admin-order-edit-head,.admin-order-edit-row{display:grid;grid-template-columns:minmax(190px,1.6fr) 86px 72px 86px 72px 34px;gap:5px;align-items:center}.admin-order-edit-head{font-size:9px;text-transform:uppercase;color:#74838b;font-weight:700;padding:3px 0}.admin-order-edit-row{padding:5px 0;border-bottom:1px solid #e4e9ec}.admin-order-edit-row input,.admin-order-edit-row select{min-width:0}.admin-order-edit-row .ao-product{text-align:left}.po-copy-order{white-space:nowrap}@media(max-width:700px){.admin-order-edit-head,.admin-order-edit-row{grid-template-columns:minmax(115px,1.2fr) 58px 55px 58px 55px 30px;gap:3px}.admin-order-edit-row input,.admin-order-edit-row select{padding:6px 3px;font-size:11px}}`;document.head.appendChild(css);
  function q(v){if(String(v??"").trim()==="-")return"-";const n=Number(String(v??"").replace(",","."));return Number.isFinite(n)?n:0}
  function editRow(x,i){const key=x.productId?`id:${x.productId}`:`name:${window.normalize(x.product||"")}`;return `<div class="admin-order-edit-row" data-i="${i}" data-key="${window.esc(key)}"><input class="ao-product" value="${window.esc(x.product||"")}"><input class="ao-stock" inputmode="decimal" value="${window.esc(x.stock??0)}"><select class="ao-stock-unit">${unitOptions(x.stockUnit||x.unit||"")}</select><input class="ao-order" inputmode="decimal" value="${window.esc(x.expected??0)}"><select class="ao-order-unit">${unitOptions(x.unit||"")}</select><button class="small danger" onclick="this.closest('.admin-order-edit-row').remove()">×</button></div>`}
  window.editHistoryOrder=function(id){
    const r=window.historyById(id);if(!r)return;
    window.openModal("Редактирование заявки",`<div class="muted" style="margin-bottom:8px">Остаток и заказ имеют отдельные единицы измерения. После сохранения текст для WhatsApp поставщику автоматически копируется.</div><div class="admin-order-edit-head"><div>Товар</div><div>Остаток</div><div>Ед.</div><div>Заказ</div><div>Ед.</div><div></div></div><div id="historyEditRows">${(r.items||[]).map(editRow).join("")}</div><button class="small secondary" style="margin-top:7px" onclick="addAdminOrderEditRow()">＋ Позиция</button>`,
      `<button class="secondary" onclick="closeModal()">Отмена</button><button class="primary" onclick="saveHistoryOrderEdit('${window.esc(id)}')">Сохранить и копировать WhatsApp</button>`);
  };
  window.addAdminOrderEditRow=function(){const w=document.getElementById("historyEditRows");if(!w)return;const first=currentUnits()[0]||"";w.insertAdjacentHTML("beforeend",editRow({product:"",stock:0,stockUnit:first,expected:0,unit:first},w.children.length));if(typeof window.enhanceClearInputs==="function")window.enhanceClearInputs(w)};
  async function copyText(text){try{await navigator.clipboard.writeText(text);return true}catch{const t=document.createElement("textarea");t.value=text;document.body.appendChild(t);t.select();let ok=false;try{ok=document.execCommand("copy")}catch{}t.remove();return ok}}
  window.copySupplierOrderText=async function(id){const r=window.historyById(id);if(!r)return;const ok=await copyText(window.supplierOrderMessage(r));if(typeof window.show==="function")window.show("historyMsg",ok?"Текст заявки скопирован для WhatsApp.":"Браузер не разрешил копирование.",ok?"ok":"err")};
  function injectCopyButtons(){
    document.querySelectorAll('button[onclick^="editHistoryOrder("]').forEach(btn=>{
      const attr=btn.getAttribute("onclick")||"";const m=attr.match(/editHistoryOrder\(['\"]([^'\"]+)['\"]\)/);if(!m)return;
      if(btn.parentElement?.querySelector(`.po-copy-order[data-order-id="${CSS.escape(m[1])}"]`))return;
      const copy=document.createElement("button");copy.className="small secondary po-copy-order";copy.dataset.orderId=m[1];copy.textContent="Копировать заявку";copy.onclick=()=>window.copySupplierOrderText(m[1]);btn.insertAdjacentElement("afterend",copy);
    });
  }
  const originalRender=window.renderHistory;
  if(typeof originalRender==="function")window.renderHistory=function(...args){const out=originalRender.apply(this,args);setTimeout(injectCopyButtons,0);return out};
  window.saveHistoryOrderEdit=async function(id){
    const r=window.historyById(id),wrap=document.getElementById("historyEditRows");if(!r||!wrap)return;
    const oldByKey=new Map((r.items||[]).map(x=>[x.productId?`id:${x.productId}`:`name:${window.normalize(x.product||"")}`,x]));
    const next=[...wrap.querySelectorAll(".admin-order-edit-row")].map(row=>{
      const product=row.querySelector(".ao-product")?.value.trim();if(!product)return null;
      const old=oldByKey.get(row.dataset.key)||{};const stockRaw=row.querySelector(".ao-stock")?.value.trim()||"0",off=stockRaw==="-";
      const stock=off?"-":q(stockRaw),expected=off?0:q(row.querySelector(".ao-order")?.value);
      return {...old,productId:old.productId??null,product,used:!off,stock,stockUnit:row.querySelector(".ao-stock-unit")?.value||old.stockUnit||old.unit||currentUnits()[0]||"",expected,unit:row.querySelector(".ao-order-unit")?.value||old.unit||currentUnits()[0]||"",delivered:old.delivered??null,deliveredUnit:old.deliveredUnit||row.querySelector(".ao-order-unit")?.value||old.unit||currentUnits()[0]||""};
    }).filter(Boolean);
    r.items=next;r.updatedAt=new Date().toISOString();window.saveHistory();window.closeModal();window.renderHistory();
    const shouldCopy=(r.stage||"received")!=="done";if(!shouldCopy)return;
    const text=window.supplierOrderMessage(r),ok=await copyText(text);
    if(typeof window.show==="function")window.show("historyMsg",ok?"Заявка сохранена. Текст WhatsApp поставщику скопирован.":"Заявка сохранена, но браузер не разрешил копирование.",ok?"ok":"err");
  };
  if(typeof window.reloadRemote==="function")window.PRO_OPTIMA_REFRESH=()=>window.reloadRemote();
  setTimeout(injectCopyButtons,0);
})();
