"use strict";

const http=require("http");
const fs=require("fs");
const path=require("path");
const {WebSocketServer,WebSocket}=require("ws");
const {handleExtraApi}=require("./date-access.js");
const {handle:handleDispatcherApi}=require("./dispatcher.js");

const DATA_DIR=process.env.SOPTIMA_DATA_DIR||"/var/data";
const META_FILE=path.join(DATA_DIR,"meta.json");
const clients=new Set();

function metaSnapshot(){
  try{const x=JSON.parse(fs.readFileSync(META_FILE,"utf8"));return{revision:Number(x.revision||0),updatedAt:x.updatedAt||null}}
  catch{return{revision:0,updatedAt:null}}
}
function broadcastDbChanged(){
  const meta=metaSnapshot(),payload=JSON.stringify({type:"db-changed",revision:meta.revision,updatedAt:meta.updatedAt});
  for(const ws of clients){if(ws.readyState===WebSocket.OPEN)try{ws.send(payload)}catch{}}
}
function blockLegacySupplierUpdate(req,res,url){
  if(url.pathname!=="/api/admin/apply-update"||req.method!=="POST")return false;
  const payload=JSON.stringify({error:"Legacy supplier UPDATE endpoint is disabled. Reload Admin and use the revision-protected updater."});
  res.writeHead(410,{
    "Content-Type":"application/json; charset=utf-8",
    "Content-Length":Buffer.byteLength(payload),
    "Access-Control-Allow-Origin":"*",
    "Cache-Control":"no-store"
  });
  res.end(payload);
  return true;
}


/* Read-only frontend backup on the Railway domain.
 * Exact allowlist: never expose server files, repository internals or stored data.
 * GitHub Pages stays the primary site; these routes work if github.io is blocked.
 */
const CLIENT_ASSETS=Object.freeze({
  "/form.html":"form.html",
  "/operator.html":"operator.html",
  "/config.js":"config.js",
  "/pro-optima-ui.css":"pro-optima-ui.css",
  "/form-date-native.js":"form-date-native.js",
  "/form-stock-carryover.js":"form-stock-carryover.js",
  "/operator-dispatcher-auth.js":"operator-dispatcher-auth.js",
  "/unit-presets.js":"unit-presets.js",
  "/branch-display.js":"branch-display.js",
  "/realtime.js":"realtime.js",
  "/favicon.ico":"favicon.ico"
});
const CLIENT_ROOT=path.resolve(__dirname,"../docs");
const CLIENT_MIME={
  html:"text/html; charset=utf-8",
  js:"text/javascript; charset=utf-8",
  css:"text/css; charset=utf-8",
  ico:"image/x-icon"
};
function serveClientBackup(req,res,pathname){
  const file=Object.prototype.hasOwnProperty.call(CLIENT_ASSETS,pathname)?CLIENT_ASSETS[pathname]:null;
  if(!file||!(req.method==="GET"||req.method==="HEAD"))return false;
  const type=file.slice(file.lastIndexOf(".")+1);
  try{
    const buffer=fs.readFileSync(path.join(CLIENT_ROOT,file));
    res.writeHead(200,{
      "Content-Type":CLIENT_MIME[type]||"application/octet-stream",
      "Content-Length":buffer.length,
      "Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff",
      "Referrer-Policy":"strict-origin-when-cross-origin"
    });
    res.end(req.method==="HEAD"?undefined:buffer);
  }catch(e){
    console.error("[PRO OPTIMA] Backup form asset unavailable:",file,e.message);
    const error="Форма временно недоступна на сервере.";
    res.writeHead(503,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});
    res.end(req.method==="HEAD"?undefined:error);
  }
  return true;
}

const originalCreateServer=http.createServer.bind(http);
http.createServer=function(...args){
  const listenerIndex=args.findIndex(x=>typeof x==="function");
  if(listenerIndex>=0){
    const listener=args[listenerIndex];
    args[listenerIndex]=async(req,res)=>{
      const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
      if(serveClientBackup(req,res,url.pathname))return;
      if(blockLegacySupplierUpdate(req,res,url))return;
      if(await handleDispatcherApi(req,res,url))return;
      if(await handleExtraApi(req,res))return;
      return listener(req,res);
    };
  }
  const server=originalCreateServer(...args);
  const wss=new WebSocketServer({noServer:true});
  server.on("upgrade",(req,socket,head)=>{
    let pathname="";try{pathname=new URL(req.url,"http://localhost").pathname}catch{}
    if(pathname!=="/ws"){socket.destroy();return}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws,req));
  });
  wss.on("connection",ws=>{
    clients.add(ws);
    const meta=metaSnapshot();
    try{ws.send(JSON.stringify({type:"hello",revision:meta.revision,updatedAt:meta.updatedAt}))}catch{}
    ws.on("close",()=>clients.delete(ws));ws.on("error",()=>clients.delete(ws));
  });
  return server;
};

const originalRenameSync=fs.renameSync.bind(fs);
fs.renameSync=function(src,dst){
  const out=originalRenameSync(src,dst);
  if(path.resolve(String(dst))===path.resolve(META_FILE))setImmediate(broadcastDbChanged);
  return out;
};

require("./server.js");
