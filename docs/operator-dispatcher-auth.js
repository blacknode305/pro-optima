(function(){
  const SESSION_KEY="proOptimaDispatcherSession_v2";
  const oldKey="proOptimaDispatcherToken_v1";
  const pinLabel=document.querySelector('#login label');
  if(pinLabel)pinLabel.textContent="PIN сменщицы";
  const input=document.getElementById("access");if(input){input.placeholder="Введите PIN";input.value=""}
  const hint=document.querySelector('#login .muted');if(hint)hint.textContent="Все филиалы: заявки, WhatsApp поставщику, подтверждение отгрузки и приёмка. Админский ключ не нужен.";

  async function call(path,opts={},useToken=true){
    const h={"Content-Type":"application/json",...(opts.headers||{})};if(useToken&&token)h.Authorization="Bearer "+token;
    const r=await fetch(API+path,{...opts,headers:h});let x={};try{x=await r.json()}catch{}
    if(!r.ok)throw Object.assign(new Error(x.error||`HTTP ${r.status}`),{status:r.status});return x;
  }

  login=async function(){
    const pin=document.getElementById("access")?.value.trim()||"";if(!pin)return;
    try{const x=await call("/api/dispatcher/login",{method:"POST",body:JSON.stringify({pin})},false);token=x.token;localStorage.setItem(SESSION_KEY,token);localStorage.removeItem(oldKey);document.getElementById("loginMsg").innerHTML="";await start()}
    catch(e){token="";document.getElementById("loginMsg").innerHTML=`<div class="msg err">${esc(e.message)}</div>`}
  };
  logout=function(){localStorage.removeItem(SESSION_KEY);localStorage.removeItem(oldKey);token="";DB=null;document.getElementById("app").style.display="none";document.getElementById("login").style.display="block";document.getElementById("access").value=""};
  start=async function(){document.getElementById("login").style.display="none";document.getElementById("app").style.display="block";await load()};
  load=async function(){try{const out=await call("/api/dispatcher/bootstrap");DB=out.data||{};revision=out.revision;document.getElementById("rev").textContent=`Заявки · revision ${revision}`;document.getElementById("online").textContent="онлайн";fillBranches();render()}catch(e){document.getElementById("online").textContent="ошибка";if(e.status===401)logout();else toast(e.message)}};
  mutate=async function(id,fn){
    const fresh=await call("/api/dispatcher/bootstrap"),data=fresh.data||{},history=structuredClone(data.history||[]),i=history.findIndex(x=>String(x.id)===String(id));
    if(i<0)throw Error("Заявка уже не найдена. Обновите список.");
    const row=history[i];fn(row,{...data,stocks:[]});
    await call("/api/dispatcher/orders/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({items:row.items,stage:row.stage,note:row.note,deliveryDate:row.deliveryDate})});
    await load();return order(id);
  };
  window.PRO_OPTIMA_REFRESH=load;
  token=localStorage.getItem(SESSION_KEY)||"";localStorage.removeItem(oldKey);
  if(token){if(input)input.value="";start()}else{
    DB=null;document.getElementById("app").style.display="none";document.getElementById("login").style.display="block";
    setTimeout(()=>{if(!localStorage.getItem(SESSION_KEY)){document.getElementById("app").style.display="none";document.getElementById("login").style.display="block"}},800);
  }
})();
