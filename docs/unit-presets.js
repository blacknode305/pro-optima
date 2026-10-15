(function(){
  const DEFAULT_UNITS=["шт","кг","г","л","мл","м","см","мм","м²","м³","т","уп","пач","б","бут","бан","кор","ящ","меш","рул","лист","пара","компл","набор"];
  let units=[...DEFAULT_UNITS];
  const cfg=window.PRO_OPTIMA_CONFIG||{};
  const api=String(cfg.API_BASE||"").replace(/\/+$/,"");

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
  const html=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  function options(value){
    const current=String(value||"").trim();
    const list=[...units];
    if(current&&!list.includes(current))list.unshift(current);
    if(!list.length)list.push(current||"");
    return list.map(x=>`<option value="${html(x)}" ${x===current?"selected":""}>${html(x)||"—"}</option>`).join("");
  }
  function patchGlobalUnitOptions(){
    if(typeof window.unitOptions!=="function")return;
    const shared=function(value){return options(value)};
    shared.__unitPresetAware=true;
    window.unitOptions=shared;
  }
  function publish(list){
    units=clean(list);
    window.PRO_OPTIMA_GET_UNIT_PRESETS=()=>[...units];
    patchGlobalUnitOptions();
  }
  window.PRO_OPTIMA_DEFAULT_UNIT_PRESETS=[...DEFAULT_UNITS];
  window.PRO_OPTIMA_GET_UNIT_PRESETS=()=>[...units];
  window.PRO_OPTIMA_SET_UNIT_PRESETS=publish;

  async function load(){
    if(!api)return;
    try{
      const r=await fetch(api+"/api/db",{cache:"no-store"});
      const out=await r.json();
      if(!r.ok)return;
      const saved=out.data?.settings?.unitPresets;
      publish(Array.isArray(saved)?saved:DEFAULT_UNITS);
    }catch{}
  }
  window.addEventListener("pro-optima:db-changed",load);
  patchGlobalUnitOptions();
  load();
})();
