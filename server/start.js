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

const originalCreateServer=http.createServer.bind(http);
http.createServer=function(...args){
  const listenerIndex=args.findIndex(x=>typeof x==="function");
  if(listenerIndex>=0){
    const listener=args[listenerIndex];
    args[listenerIndex]=async(req,res)=>{
      const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
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
