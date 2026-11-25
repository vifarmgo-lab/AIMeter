import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { googleAccess } from './access.mjs';
import { createGateway, supportedRoute, validCreate } from './gateway.mjs';
import { Readable } from 'node:stream';

test('Google login binds the allowed verified address to this client, browser and one-time challenge', async () => {
  const {publicKey,privateKey} = await generateKeyPair('RS256');
  const clientId='123-test.apps.googleusercontent.com';
  const email='owner@gmail.com';
  const origin='https://wallet.example';
  const handle=googleAccess({clientId,email,origin,keys:publicKey});
  function response(){
    return {headers:{},status:200,setHeader(k,v){this.headers[k]=v;},writeHead(n){this.status=n;},end(b){this.body=b;}};
  }
  const page=response();
  assert.equal(await handle({method:'GET',url:'/connect',headers:{}},page),false);
  const nonce=page.body.match(/data-nonce="([^"]+)"/)[1];
  const cookie=page.headers['set-cookie'].split(';')[0];
  async function send(changes, browserCookie=cookie) {
    const credential=await new SignJWT({email,email_verified:true,nonce,...changes}).setProtectedHeader({alg:'RS256'})
      .setIssuer('https://accounts.google.com').setAudience(clientId).setSubject('sample').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const req=Readable.from([Buffer.from(JSON.stringify({credential}))]);
    Object.assign(req,{method:'POST',url:'/connect/sign-in',headers:{cookie:browserCookie,origin,'content-type':'application/json'}});
    const res=response();await handle(req,res);return res;
  }
  assert.equal((await send({email:'other@gmail.com'})).status,403);
  assert.equal((await send({email_verified:false})).status,403);
  assert.equal((await send({nonce:'different'})).status,403);
  assert.equal((await send({},'')).status,403);
  const accepted=await send({});
  assert.equal(accepted.status,204);
  const session=accepted.headers['set-cookie'][1].split(';')[0];
  assert.equal(await handle({method:'GET',url:'/connect',headers:{cookie:session}},response()),true);
  assert.equal((await send({})).status,403);
  const blocked=response();await handle({method:'GET',url:'/connect/api/providers',headers:{}},blocked);
  assert.equal(blocked.status,403);
});

test('the account portal only exposes the native add workflow', () => {
  assert.ok(supportedRoute('POST','/api/providers'));
  assert.ok(supportedRoute('POST','/api/providers/claude/oauth/generate-auth-url'));
  assert.ok(supportedRoute('GET','/api/providers/copilot/auth/status/ticket'));
  assert.equal(supportedRoute('GET','/api/providers/credentials'),false);
  assert.equal(supportedRoute('PUT','/api/providers/example'),false);
  assert.equal(supportedRoute('POST','/api/auth/admin/setup'),false);
  const input = {provider:'claude',authType:'oauth',name:'Sample',credentials:'sample'};
  assert.ok(validCreate(input));
  assert.equal(validCreate({...input,region:'custom'}),false);
});

test('normal add requests keep native authentication on the server', async () => {
  const calls = [];
  const origin = 'https://wallet.example';
  const fetchImpl = async (url, init) => {
    calls.push({url,init});
    if (url.pathname === '/api/auth/admin/verify') return new Response('{}',{headers:{'set-cookie':'aimeter_admin_session=test; HttpOnly'}});
    return Response.json({success:true,data:{id:'sample'}});
  };
  const gateway = createGateway({origin,upstream:'http://native',password:'test password',fetchImpl});
  const res = {headers:{},writeHead(status,headers) {this.status=status;this.headers=headers;},end(body) {this.body=body;}};
  const req = Readable.from([Buffer.from(JSON.stringify({provider:'codex',authType:'oauth',name:'Test',credentials:'sample'}))]);
  Object.assign(req,{method:'POST',url:'/connect/api/providers',headers:{origin,'content-type':'application/json'}});
  await gateway(req,res);
  assert.equal(res.status,200);
  assert.equal(JSON.parse(res.body).data.id,'sample');
  assert.equal(calls[1].init.headers.cookie,'aimeter_admin_session=test');
  assert.equal(res.headers['set-cookie'],undefined);
  const initReq = Readable.from([]);
  Object.assign(initReq,{method:'POST',url:'/connect/api/providers/codex/oauth/generate-auth-url',headers:{origin}});
  await gateway(initReq,res);
  assert.equal(res.status,200);
  assert.equal(calls.length,3);
});
