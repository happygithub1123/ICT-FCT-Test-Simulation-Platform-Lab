const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const port = Number(process.env.PORT) || 5173;
http.createServer((req,res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  const name = u === '/' ? 'index.html' : u.slice(1);
  const full = path.resolve(root,name);
  if(!full.startsWith(root + path.sep) && full !== root){res.writeHead(403);res.end('Forbidden');return;}
  fs.readFile(full,(err,data)=>{
    if(err){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
}).listen(port,'127.0.0.1',()=>console.log(`DiodeLab 3D: http://127.0.0.1:${port}/`));
