(function(){
  const DATE_KEY="proOptimaOperatorSelectedDate_v2";
  let waitingDate="";
  const today=()=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${m.year}-${m.month}-${m.day}`};
  const valid=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||""));
  const getDate=()=>{const v=document.getElementById("ld")?.value||localStorage.getItem(DATE_KEY)||today();return valid(v)?v:today()};
  const setDate=v=>{const d=valid(v)?String(v):today();localStorage.setItem(DATE_KEY,d);const el=document.getElementById("ld");if(el)el.value=d;return d};
  const pretty=s=>{const [y,m,d]=String(s).split("-");return d&&m&&y?`${d}.${m}.${y}`:s};
  const message=html=>{const el=document.getElementById("lm");if(el)el.innerHTML=html||""};

  function ensureDateField(){
    if(document.getElementById("ld"))return;
    const password=document.getElementById("lp");
    if(!password)return;
    const passwordLabel=password.previousElementSibling;
    const label=document.createElement("label");label.textContent="Дата заявок";label.htmlFor="ld";
    const input=document.createElement("input");input.type="date";input.id="ld";input.value=setDate(localStorage.getItem(DATE_KEY)||today());
    input.addEventListener("change",()=>setDate(input.value));
    password.parentNode.insertBefore(label,passwordLabel||password);
    password.parentNode.insertBefore(input,passwordLabel||password);
    const hint=document.createElement("div");hint.className="muted";hint.style.marginTop="5px";hint.textContent="Сегодня — вход сразу. Другая дата — после разрешения администратора.";
    input.insertAdjacentElement("afterend",hint);
  }

  function waitingHtml(date,status){
    const rejected=status==="rejected";
    return `<div class="msg" style="background:#fff3d9;color:#75581f"><b>${pretty(date)}</b><br>${rejected?"Запрос отклонён. Можно запросить повторно.":"Запрос отправлен администратору. После подтверждения форма откроется автоматически."}<button class="full ${rejected?"primary":""}" style="margin-top:8px" onclick="${rejected?"requestDateAccessAgain()":"checkDateAccess()"}">${rejected?"Запросить снова":"Проверить разрешение"}</button></div>`;
  }

  async function status(date,create){
    if(create)return api("/api/operator/date-access",{method:"POST",body:JSON.stringify({requestedDate:date})});
    return api("/api/operator/date-access?date="+encodeURIComponent(date));
  }

  function decorate(date){
    const orderTab=document.getElementById("to"),receiveTab=document.getElementById("tr");
    if(orderTab)orderTab.textContent=`Заявки ${pretty(date)}`;
    if(receiveTab)receiveTab.textContent=`Поставки ${pretty(date)}`;
    const first=document.querySelector("#so .chip");
    if(first)first.textContent=first.textContent.replace(/^Сегодня:/,`Дата ${pretty(date)}:`);
    const rec=document.querySelector("#sr .chip");
    if(rec)rec.textContent=rec.textContent.replace(/^Поставки сегодня:/,`Поставки ${pretty(date)}:`);
  }

  async function openSelected(date){
    waitingDate="";
    document.getElementById("login").style.display="none";
    document.getElementById("app").style.display="block";
    try{
      S=await api("/api/operator/bootstrap-date?date="+encodeURIComponent(date));
      branch=S.branch;
      localStorage.setItem(BK,branch);
      document.getElementById("bn").textContent=branch;
      document.getElementById("tl").textContent=`${S.dayName}, ${pretty(date)}`;
      document.getElementById("on").textContent=`rev ${S.revision}`;
      render();
      decorate(date);
    }catch(e){
      document.getElementById("app").style.display="none";
      document.getElementById("login").style.display="block";
      if(e.status===403||/подтвержд|отклон/i.test(String(e.message||""))){
        waitingDate=date;message(waitingHtml(date,e.data?.status||"pending"));
      }else message(`<div class="msg">${esc(e.message)}</div>`);
    }
  }

  const stableStart=window.start;
  const stableLoad=window.load;
  window.start=async function(){
    const date=setDate(getDate());
    if(date===today())return stableStart();
    try{
      const access=await status(date,true);
      if(access.approved||access.status==="approved")return openSelected(date);
      waitingDate=date;
      document.getElementById("app").style.display="none";
      document.getElementById("login").style.display="block";
      message(waitingHtml(date,access.status||"pending"));
    }catch(e){message(`<div class="msg">${esc(e.message)}</div>`)}
  };
  window.load=async function(){
    const date=getDate();
    if(date===today())return stableLoad();
    return openSelected(date);
  };
  window.checkDateAccess=async function(){
    const date=waitingDate||getDate();
    try{
      const access=await status(date,false);
      if(access.approved||access.status==="approved"){message("");return openSelected(date)}
      waitingDate=date;message(waitingHtml(date,access.status||"pending"));
    }catch(e){message(`<div class="msg">${esc(e.message)}</div>`)}
  };
  window.requestDateAccessAgain=async function(){
    const date=waitingDate||getDate();
    try{
      const access=await status(date,true);
      if(access.approved||access.status==="approved"){message("");return openSelected(date)}
      waitingDate=date;message(waitingHtml(date,access.status||"pending"));
    }catch(e){message(`<div class="msg">${esc(e.message)}</div>`)}
  };
  window.PRO_OPTIMA_REFRESH=async function(){
    if(waitingDate)return checkDateAccess();
    if(document.getElementById("app").style.display!=="none")return load();
  };

  ensureDateField();
  const d=getDate();
  if(d!==today()&&branch){
    status(d,false).then(access=>{
      if(access.approved||access.status==="approved")openSelected(d);
      else{
        waitingDate=d;
        document.getElementById("app").style.display="none";
        document.getElementById("login").style.display="block";
        message(waitingHtml(d,access.status||"pending"));
      }
    }).catch(()=>{});
  }
})();