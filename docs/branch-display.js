"use strict";
(function(){
  const MAP={"ГОРНЯК":"Горняк","ЛОБОДЫ":"Лободы","НУРКЕН":"Нуркен","САРАНЬ":"Сарань","ПРИШАХТИНСК":"Пришахтинск"};
  const label=v=>MAP[String(v??"").trim().toLocaleUpperCase("ru-RU")]||String(v??"");
  function replaceText(el,pairs){
    if(!el)return;
    el.childNodes.forEach(node=>{
      if(node.nodeType!==Node.TEXT_NODE)return;
      let value=node.nodeValue;
      pairs.forEach(([from,to])=>{value=value.replace(from,to)});
      if(value!==node.nodeValue)node.nodeValue=value;
    });
  }
  function adminTerms(){
    if(!document.documentElement.classList.contains("page-admin"))return;
    document.querySelectorAll(".settings-box h3,.settings-box p").forEach(el=>replaceText(el,[
      [/Обновление прайсов \/ предложений/g,"Обновление прайсов / каталога"],
      [/каталог предложений/gi,"каталог"]
    ]));
    document.querySelectorAll("#viewProposals .empty").forEach(el=>{if(el.textContent.trim()==="Предложения не найдены.")el.textContent="В каталоге ничего не найдено."});
    document.querySelectorAll("#viewProposals button").forEach(el=>{if(el.textContent.trim()==="Использовать")el.textContent="В наименования"});
    document.querySelectorAll("#compareSummary b").forEach(el=>{
      if(el.textContent.trim()==="Используемые")el.textContent="Наименования";
      if(el.textContent.trim()==="Неиспользуемые")el.textContent="Не используются";
    });
    document.querySelectorAll(".offer-sub,.msg,.empty").forEach(el=>replaceText(el,[
      [/предложения без цены/gi,"позиции без цены"],
      [/единственное предложение с ценой/gi,"единственная позиция с ценой"],
      [/закреплённых используемых товаров/gi,"закреплённых наименований"]
    ]));
  }
  function apply(){
    document.querySelectorAll("select").forEach(select=>{
      if(!/branch|филиал|производ/i.test(`${select.id} ${select.name||""} ${select.previousElementSibling?.textContent||""}`))return;
      [...select.options].forEach(o=>{
        const pretty=MAP[String(o.value||o.textContent).trim().toLocaleUpperCase("ru-RU")];
        if(pretty&&o.textContent!==pretty)o.textContent=pretty;
      });
    });
    const bn=document.getElementById("bn");
    if(bn){const pretty=MAP[bn.textContent.trim().toLocaleUpperCase("ru-RU")];if(pretty&&bn.textContent!==pretty)bn.textContent=pretty}
    document.querySelectorAll(".card .title,.history-head b,.date-request b").forEach(el=>{
      const parts=el.textContent.split(" · ");
      const pretty=MAP[String(parts[0]||"").trim().toLocaleUpperCase("ru-RU")];
      if(pretty){parts[0]=pretty;const next=parts.join(" · ");if(next!==el.textContent)el.textContent=next}
    });
    const mt=document.getElementById("mt");
    if(mt){
      const parts=mt.textContent.split(" · ");let changed=false;
      for(let i=0;i<parts.length;i++){
        const pretty=MAP[String(parts[i]||"").trim().toLocaleUpperCase("ru-RU")];
        if(pretty&&parts[i]!==pretty){parts[i]=pretty;changed=true}
      }
      if(changed)mt.textContent=parts.join(" · ");
    }
    adminTerms();
  }
  let scheduled=false;
  function scheduleApply(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;apply()});
  }
  window.PRO_OPTIMA_BRANCH_LABEL=label;
  apply();
  new MutationObserver(scheduleApply).observe(document.body,{childList:true,subtree:true});
})();
