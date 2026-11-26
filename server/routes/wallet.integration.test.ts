import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

test('wallet readings use actual SQLite and the normal dashboard read route', async()=>{
  // Configure only this test process and use a fresh database with a synthetic encryption key.
  const tmp=await mkdtemp(join(tmpdir(),'aimeter-test-'));
  process.env.AIMETER_DATABASE_ENGINE='sqlite';
  process.env.AIMETER_DATABASE_CONNECTION=join(tmp,'wallet.db');
  process.env.AIMETER_ENCRYPTION_KEY=randomBytes(32).toString('hex');
  const {initDatabase}=await import('../database.js');
  await initDatabase();
  const wallet=(await import('./wallet.js')).default;
  const proxy=(await import('./proxy.js')).default;
  const {storage}=await import('../storage.js');
  const app=express();
  app.use(express.json());
  app.use('/write', (req,res,next)=>{res.locals.authRole='admin';next();},wallet);
  app.use('/read',proxy);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const addr=server.address() as {port:number};
  async function post(path:string,body:unknown){
    const result=await fetch('http://127.0.0.1:'+addr.port+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    return {status:result.status,data:await result.json()};
  }
  try {
    const item={platform:'runninghub',name:'Test Wallet'};
    assert.equal((await post('/write/reading',{...item,used:5,total:0})).status,400);
    assert.equal((await post('/write/reading',{...item,used:4,total:20})).status,200);
    assert.equal((await post('/write/reading',{...item,used:7,total:20})).status,200);
    const providers=await storage.listProviders();
    assert.equal(providers.length,1);
    assert.equal((await storage.getLatestUsage(providers[0].id))?.progress?.items[0].usedPercent,35);
    const result=await post('/read/latest',{});
    assert.equal(result.status,200);
    assert.match(JSON.stringify(result.data), /"usedPercent":35/);
    assert.equal((await post('/write/reading',{...item,balance:9.5,unit:'credit'})).status,200);
    const balance=await post('/read/latest',{});
    assert.match(JSON.stringify(balance.data), /"walletBalance":\{"value":9.5,"unit":"credit"\}/);
    assert.equal((await storage.listProviders()).length,1);
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(tmp,{recursive:true,force:true});
  }
});
