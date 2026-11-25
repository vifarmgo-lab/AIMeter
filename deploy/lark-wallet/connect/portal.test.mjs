import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { cloudflareAccess } from './access.mjs';
import { createGateway, supportedRoute, validCreate } from './gateway.mjs';
import { Readable } from 'node:stream';

test('Access requires a current application token for the allowed mailbox', async () => {
  const issuer = 'https://example.cloudflareaccess.com';
  const audience = 'a'.repeat(64);
  const email = 'owner@example.org';
  const time = 2000000000;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {modulusLength:2048});
  const jwk = {...publicKey.export({format:'jwk'}),kid:'test'};
  const permitted = cloudflareAccess({issuer,audience,email,now:() => time * 1000,
    fetchImpl: async () => Response.json({keys:[jwk]})});
  function request(change) {
    const claims = {iss:issuer,aud:[audience],email,exp:time+60,...change};
    const encoded = [{alg:'RS256',kid:'test'},claims].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
    return {headers:{'cf-access-jwt-assertion': encoded + '.' + sign('RSA-SHA256',Buffer.from(encoded),privateKey).toString('base64url')}};
  }
  assert.equal(await permitted(request({})),true);
  for (const change of [{aud:['other']},{iss:'https://elsewhere.example'},{email:'another@example.org'},{exp:time},{nbf:time+60}]) {
    assert.equal(await permitted(request(change)),false);
  }
  assert.equal(await permitted({headers:{}}),false);
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
