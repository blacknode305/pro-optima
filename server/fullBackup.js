"use strict";
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {Readable}=require("stream");
const zlib=require("zlib");

// Read-only, streaming TAR.GZ containing the authoritative global database,
// metadata, branch credential hashes and all original declaration attachments.
// Must be called only AFTER both-factor server-side administrator checks.
function tarHeader(name,size,mtime=Math.floor(Date.now()/1000)){
  if(!/^[a-zA-Z0-9._/-]+$/.test(name)||name.includes("..")||
    Buffer.byteLength(name)>100||!Number.isSafeInteger(size)||size<0||
    size>=8**11)throw Error("Invalid archive member: "+name);
  const h=Buffer.alloc(512);
  const str=(value,offset,length)=>h.write(String(value),offset,length,"ascii");
  const oct=(value,offset,length)=>str(value.toString(8).padStart(length-1,"0")+"\0",offset,length);
  str(name,0,100);
  oct(0o600,100,8);oct(0,108,8);oct(0,116,8);
  oct(size,124,12);oct(mtime,136,12);
  h.fill(32,148,156);h[156]=48;
  str("ustar\0",257,6);str("00",263,2);
  let sum=0;for(const b of h)sum+=b;
  str(sum.toString(8).padStart(6,"0")+"\0 ",148,8);
  return h;
}
function attachmentPaths(root){
  const base=path.join(root,"declaration-files");
  if(!fs.existsSync(base))return [];
  const paths=[];
  const explore=(dir,prefix)=>{
    for(const dirent of fs.readdirSync(dir,{withFileTypes:true})){
      if(dirent.isSymbolicLink()||(!dirent.isDirectory()&&!dirent.isFile()))
        throw Error("Unsafe declaration file type");
      const name=prefix?prefix+"/"+dirent.name:dirent.name;
      const file=path.join(dir,dirent.name);
      if(dirent.isDirectory())explore(file,name);
      else paths.push({name:"declaration-files/"+name,file});
    }
  };
  explore(base,"");
  return paths.sort((a,b)=>a.name.localeCompare(b.name));
}
function createFullBackupStream(dataDir, revision=0){
  const root=path.resolve(dataDir);
  const files=["dashboardx.json","meta.json","access.json"].map(name=>{
    const content=fs.readFileSync(path.join(root,name));
    return {name,content,size:content.length};
  });
  for(const item of attachmentPaths(root)){
    const size=fs.statSync(item.file).size;
    files.push({...item,size});
  }
  const manifest={format:"dashboardx-optima-complete-backup-v1",revision,
    createdAt:new Date().toISOString(),files:[]};
  const zero=Buffer.alloc(512);
  async function* members(){
    for(const item of files){
      const digest=crypto.createHash("sha256");
      yield tarHeader(item.name,item.size);
      if(item.content){
        digest.update(item.content);
        yield item.content;
      }else{
        let count=0;
        for await(const chunk of fs.createReadStream(item.file,{highWaterMark:64*1024})){
          count+=chunk.length;digest.update(chunk);yield chunk;
        }
        if(count!==item.size)throw Error("Attachment changed during backup: "+item.name);
      }
      const tail=(512-item.size%512)%512;
      if(tail)yield Buffer.alloc(tail);
      manifest.files.push({path:item.name,size:item.size,sha256:digest.digest("hex")});
    }
    const json=Buffer.from(JSON.stringify(manifest,null,2),"utf8");
    yield tarHeader("manifest.json",json.length);
    yield json;
    const tail=(512-json.length%512)%512;if(tail)yield Buffer.alloc(tail);
    yield zero;yield zero;
  }
  const source=Readable.from(members());
  const gzip=zlib.createGzip({level:6});
  source.on("error",error=>gzip.destroy(error));
  source.pipe(gzip);
  return gzip;
}
module.exports={createFullBackupStream,tarHeader};
