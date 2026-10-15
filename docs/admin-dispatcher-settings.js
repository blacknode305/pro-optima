(function(){
  function box(){
    if(document.getElementById("dispatcherAccessBox"))return document.getElementById("dispatcherAccessBox");
    const anchor=document.getElementById("accessList")?.closest(".admin-panel")||document.getElementById("accessList")?.parentElement;if(!anchor)return null;
    const el=document.createElement("div");el.id="dispatcherAccessBox";el.className=anchor.className||"admin-panel";el.innerHTML='<h3>Сменщица · заявки</h3><div class="muted">Отдельный PIN только для мобильной страницы заявок. Админский ключ сменщице не выдаётся.</div><div style="display:grid;grid-template-columns:minmax(180px,320px) auto;gap:7px;align-items:end;margin-top:8px"><div><label>Новый PIN</label><input id="dispatcherPin" type="password" inputmode="numeric" placeholder="Минимум 4 символа"></div><button class="small primary" onclick="saveDispatcherPin()">Сохранить PIN</button></div><div id="dispatcherAccessState" class="muted" style="margin-top:6px"></div>';
    anchor.insertAdjacentElement("afterend",el);return el;
  }
  async function refresh(){if(!box()||typeof window.remoteFetch!=="function"||typeof window.adminToken!=="function"||!window.adminToken())return;try{const x=await window.remoteFetch("/api/admin/dispatcher-access"),s=document.getElementById("dispatcherAccessState");if(s)s.textContent=x.configured?`PIN задан${x.updatedAt?" · изменён "+new Date(x.updatedAt).toLocaleString("ru-RU"):""}`:"PIN ещё не задан"}catch(e){const s=document.getElementById("dispatcherAccessState");if(s)s.textContent=e.message}}
  window.saveDispatcherPin=async function(){const i=document.getElementById("dispatcherPin"),pin=i?.value||"";if(pin.length<4){if(typeof window.show==="function")window.show("settingsMsg","PIN сменщицы должен быть минимум 4 символа.","err");return}try{await window.remoteFetch("/api/admin/dispatcher-access",{method:"PUT",body:JSON.stringify({pin})});i.value="";await refresh();if(typeof window.show==="function")window.show("settingsMsg","PIN сменщицы сохранён. Старые сеансы автоматически отключены.","ok")}catch(e){if(typeof window.show==="function")window.show("settingsMsg",e.message,"err")}};
  const base=window.loadAdminPanels;if(typeof base==="function")window.loadAdminPanels=async function(...a){const r=await base.apply(this,a);await refresh();return r};
  box();refresh();
})();
