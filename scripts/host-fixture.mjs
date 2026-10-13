import http from 'node:http';

const port=Number(process.env.HOST_FIXTURE_PORT||4320),target=new URL(process.env.BLOG_TARGET||'http://127.0.0.1:4310'),mount=process.env.BLOG_BASE_PATH||'/blog';
const server=http.createServer((req,res)=>{
  if(req.url===mount||req.url.startsWith(mount+'/')){
    // Forward the mount intact, including Authorization, cookies, ranges and uploads.
    const upstream=http.request(new URL(req.url,target),{method:req.method,headers:{...req.headers,host:target.host}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    upstream.on('error',()=>{res.writeHead(502);res.end('Blog service unavailable.');});req.pipe(upstream);return;
  }
  if(req.url==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain'});res.end(`User-agent: *\nAllow: /\nDisallow: ${mount}/admin/\nDisallow: ${mount}/api/\nSitemap: http://127.0.0.1:${port}/sitemap.xml\n`);return;}
  if(req.url==='/sitemap.xml'){res.writeHead(200,{'Content-Type':'application/xml'});res.end(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>http://127.0.0.1:${port}${mount}/sitemap.xml</loc></sitemap></sitemapindex>`);return;}
  if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><html lang="en"><title>Independent website fixture</title><main><h1>An independent website</h1><p>This host serves its own homepage and forwards the mounted blog.</p><a href="${mount}/">Read the blog</a></main></html>`);return;}
  res.writeHead(404);res.end('Page not found.');
});
server.listen(port,'127.0.0.1',()=>console.log(`Host fixture at http://127.0.0.1:${port}`));
