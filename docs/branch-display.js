"use strict";
(function(){
  const MAP={"ГОРНЯК":"Горняк","ЛОБОДЫ":"Лободы","НУРКЕН":"Нуркен","САРАНЬ":"Сарань","ПРИШАХТИНСК":"Пришахтинск"};
  const label=v=>MAP[String(v??"").trim().toLocaleUpperCase("ru-RU")]||String(v??"");
  function apply(){
    document.querySelectorAll("select").forEach(select=>{
      if(!/branch|филиал|производ/i.test(`${select.id} ${select.name||""} ${select.previousElementSibling?.textContent||""}`))return;
      [...select.options].forEach(o=>{const pretty=MAP[String(o.value||o.textContent).trim().toLocaleUpperCase("ru-RU")];if(pretty)o.textContent=pretty});
    });
    const bn=document.getElementById("bn");if(bn){const pretty=MAP[bn.textContent.trim().toLocaleUpperCase("ru-RU")];if(pretty)bn.textContent=pretty}
    document.querySelectorAll(".card .title,.history-head b,.date-request b").forEach(el=>{
      const parts=el.textContent.split(" · ");
      const pretty=MAP[String(parts[0]||"").trim().toLocaleUpperCase("ru-RU")];
      if(pretty){parts[0]=pretty;el.textContent=parts.join(" · ")}
    });
    const mt=document.getElementById("mt");
    if(mt){
      const parts=mt.textContent.split(" · ");let changed=false;
      for(let i=0;i<parts.length;i++){const pretty=MAP[String(parts[i]||"").trim().toLocaleUpperCase("ru-RU")];if(pretty){parts[i]=pretty;changed=true}}
      if(changed)mt.textContent=parts.join(" · ");
    }
  }
  window.PRO_OPTIMA_BRANCH_LABEL=label;
  apply();new MutationObserver(apply).observe(document.body,{childList:true,subtree:true});
})();
