(function(){
  const DEFAULT_UNITS=["шт","кг","г","л","мл","м","см","мм","м²","м³","т","уп","пач","б","бут","бан","кор","ящ","меш","рул","лист","пара","компл","набор"];
  let units=[...DEFAULT_UNITS];
  let loading=false;

  const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  function clean(list){
    const out=[];
    for(const raw of Array.isArray(list)?list:[]){
      const value=String(raw??"").trim();
      if(!value)continue;
      if(out.some(x=>x.toLocaleLowerCase("ru-RU")===value.toLocaleLowerCase("ru-RU")))continue;
      out.push(value);
    }
    return out;
  }
  function fromSettings(settings){
    return Array.isArray(settings?.unitPresets)?clean(settings.unitPresets):[...DEFAULT_UNITS];
  }
  if(typeof window.PRO_OPTIMA_GET_UNIT_PRESETS!=="function")window.PRO_OPTIMA_GET_UNIT_PRESETS=()=>[...units];
  function publish(){if(typeof window.PRO_OPTIMA_SET_UNIT_PRESETS==="function")window.PRO_OPTIMA_SET_UNIT_PRESETS(units)}

  function patchGeneratedOrderForms(){
    const original=window.orderFormHtml;
    if(typeof original!=="function"||original.__unitPresetAware)return;
    const wrapped=function(...args){
      const list=[...units];
      const items=Array.isArray(args[3])?args[3]:[];
      for(const row of items){
        const value=String(row?.orderUnit||row?.p?.unit||"").trim();
        if(value&&!list.includes(value))list.unshift(value);
      }
      return original.apply(this,args).replace(/const units=\[[^\]]*\];const state=/,`const units=${JSON.stringify(list)};const state=`);
    };
    wrapped.__unitPresetAware=true;
    window.orderFormHtml=wrapped;
  }

  function msg(text,type=""){
    const el=document.getElementById("unitPresetMsg");if(!el)return;
    el.textContent=text||"";
    el.className="msg "+(type||"");
  }
  function render(){
    const list=document.getElementById("unitPresetList");if(!list)return;
    if(!units.length){
      list.innerHTML='<div class="muted">Список пуст. Текущие единицы в уже созданных заявках сохранятся, но для новых позиций лучше добавить хотя бы одну.</div>';
      return;
    }
    list.innerHTML=units.map((unit,i)=>`<span class="po-unit-chip"><b>${esc(unit)}</b><button type="button" class="po-unit-remove" data-i="${i}" title="Удалить ${esc(unit)}" aria-label="Удалить ${esc(unit)}">×</button></span>`).join("");
    list.querySelectorAll(".po-unit-remove").forEach(btn=>btn.addEventListener("click",()=>removeUnit(Number(btn.dataset.i))));
  }
  async function loadUnits(){
    if(loading||typeof window.remoteFetch!=="function")return;
    loading=true;
    try{
      const out=await window.remoteFetch("/api/db",{admin:false});
      units=fromSettings(out.data?.settings||{});
      publish();
      render();
    }catch(e){msg("Не удалось загрузить единицы: "+e.message,"err")}
    finally{loading=false}
  }
  async function persist(next,successText){
    if(typeof window.adminToken==="function"&&!window.adminToken()){
      if(typeof window.setAdminTokenPrompt==="function")window.setAdminTokenPrompt();
      if(!window.adminToken())return msg("Для изменения списка нужен Admin token.","err");
    }
    try{
      const fresh=await window.remoteFetch("/api/admin/db");
      const settings={...(fresh.data?.settings||{}),unitPresets:clean(next)};
      const out=await window.remoteFetch("/api/admin/db",{
        method:"PATCH",
        body:JSON.stringify({baseRevision:fresh.revision,changes:{settings}})
      });
      units=[...settings.unitPresets];
      publish();
      render();
      msg(`${successText} · revision ${out.revision}`,"ok");
    }catch(e){
      if(e.status===409){msg("База изменилась одновременно. Обновляю список — повторите действие.","err");await loadUnits();}
      else msg("Не удалось сохранить: "+e.message,"err");
    }
  }
  async function addUnit(){
    const input=document.getElementById("unitPresetInput");if(!input)return;
    const value=String(input.value||"").trim();
    if(!value)return msg("Введите единицу измерения.","err");
    if(units.some(x=>x.toLocaleLowerCase("ru-RU")===value.toLocaleLowerCase("ru-RU")))return msg("Такая единица уже есть.","err");
    await persist([...units,value],`Добавлена единица «${value}»`);
    input.value="";input.focus();
  }
  async function removeUnit(index){
    const value=units[index];if(value===undefined)return;
    await persist(units.filter((_,i)=>i!==index),`Единица «${value}» удалена из предустановленных`);
  }
  async function resetUnits(){
    if(!confirm("Вернуть стандартный набор единиц измерения?"))return;
    await persist(DEFAULT_UNITS,"Стандартный набор восстановлен");
  }

  function inject(){
    const grid=document.querySelector(".settings-grid");
    if(!grid){setTimeout(inject,250);return}
    if(document.getElementById("unitPresetSettings"))return;
    const style=document.createElement("style");
    style.textContent=`.po-unit-list{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px}.po-unit-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid #c8d3d9;background:#fff;border-radius:999px;padding:3px 4px 3px 9px;font-size:12px}.po-unit-remove{width:22px;height:22px;padding:0;border-radius:50%;line-height:18px;font-size:15px;background:#f5eded;border-color:#dfcaca;color:#875050}.po-unit-add{display:grid;grid-template-columns:minmax(120px,1fr) auto;gap:6px;align-items:end}.po-unit-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}`;
    document.head.appendChild(style);
    const box=document.createElement("div");box.className="settings-box";box.id="unitPresetSettings";
    box.innerHTML=`<h3>Единицы измерения</h3><p>Этот список используется в выпадающих меню заявок, подтверждения отгрузки и приёмки на всех устройствах. Удаление из списка не меняет единицы в старых заявках.</p><div id="unitPresetList" class="po-unit-list"><span class="muted">Загрузка...</span></div><div class="po-unit-add"><div><label for="unitPresetInput">Новая единица</label><input id="unitPresetInput" maxlength="20" placeholder="например, вед, пал, м.п."></div><button type="button" class="primary" id="unitPresetAdd">Добавить</button></div><div class="po-unit-actions"><button type="button" class="secondary" id="unitPresetReset">Вернуть стандартные</button></div><div id="unitPresetMsg" class="msg"></div>`;
    grid.appendChild(box);
    document.getElementById("unitPresetAdd").addEventListener("click",addUnit);
    document.getElementById("unitPresetReset").addEventListener("click",resetUnits);
    document.getElementById("unitPresetInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addUnit()}});
    patchGeneratedOrderForms();
    loadUnits();
  }

  window.addEventListener("pro-optima:db-changed",()=>loadUnits());
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",inject);else inject();
})();
