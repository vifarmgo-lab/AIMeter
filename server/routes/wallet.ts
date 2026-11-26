import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { AuthType, UsageProvider as P, type UsageSnapshot } from '../../src/types/index.js';
import { storage } from '../storage.js';
import { requireAdminRole } from '../middleware/auth.js';
import { newProfile, openClient, removeProfile, usageSnapshot } from '../services/codex-device.mjs';

const router = Router();
router.use((req, res, next) => { if (requireAdminRole(req, res)) next(); });

type State = 'pending' | 'saving' | 'connected' | 'expired' | 'failed';
type Flow = { name:string; status:State; stop?:()=>void; quota:boolean };
const flows = new Map<string, Flow>();
const expiry = 15 * 60_000;

function nameOf(value:unknown) {
  return typeof value === 'string' && value.trim().length <= 120 ? value.trim() : '';
}

router.post('/device/start', async (req, res) => {
  const name = nameOf(req.body?.name);
  if (!name) return res.status(400).json({message:'Tên tài khoản chưa hợp lệ.'});
  if (!process.env.AIMETER_CODEX_DEVICE_DIR) return res.status(503).json({message:'Máy chủ chưa bật đăng nhập bằng mã.'});
  const active = [...flows.values()].filter(f => ['pending','saving'].includes(f.status));
  if (active.length >= 8) return res.status(429).json({message:'Đang có nhiều phiên đăng nhập. Anh thử lại sau.'});
  const flowId = randomUUID();
  const flow:Flow = {name, status:'pending', quota:false};
  if (active.some(f=>f.name===name)) return res.status(409).json({message:'Tên này đang được kết nối. Anh có thể dùng tên khác.'});
  flows.set(flowId, flow);
  let handle:string | undefined;
  let client:Awaited<ReturnType<typeof openClient>> | undefined;
  let loginId:string | undefined;
  let saved = false;
  let timer:ReturnType<typeof setTimeout> | undefined;
  async function finish(status:State) {
    if (timer) clearTimeout(timer);
    flow.status=status;
    client?.close();
    if (!saved && handle) await removeProfile(handle).catch(()=>{});
    setTimeout(()=>flows.delete(flowId), 3*60_000).unref();
  }
  try {
    if (await storage.getProviderByName(P.CODEX,name)) {
      flows.delete(flowId);
      return res.status(409).json({message:'Tên này đã có trên dashboard. Anh đặt tên khác cho tài khoản mới.'});
    }
    handle = await newProfile();
    client = await openClient(handle, (notice:any) => {
      if (!loginId || notice?.loginId !== loginId || flow.status !== 'pending') return;
      flow.status='saving';
      if (timer) clearTimeout(timer);
      void (async () => {
        if (!notice.success) return finish('failed');
        const created = await storage.createProvider(P.CODEX, {provider:P.CODEX,name,refreshInterval:5,
          credentials:{type:AuthType.DEVICE,value:handle!}});
        saved=true;
        try {
          const snapshot = usageSnapshot(await client!.limits()) as UsageSnapshot;
          await storage.recordUsage(created.id,snapshot);
          flow.quota=true;
        } catch { /* The scheduled refresh can retry when quota becomes available. */ }
        await finish('connected');
      })().catch(()=>finish('failed'));
    });
    const login = await client.login() as {loginId:string;verificationUrl:string;userCode:string};
    if (!login?.loginId || !login.userCode || new URL(login.verificationUrl).origin !== 'https://auth.openai.com') throw Error();
    loginId=login.loginId;
    flow.stop = () => { if (flow.status==='pending') void finish('expired'); };
    timer=setTimeout(flow.stop,expiry);
    return res.json({flowId,code:login.userCode,url:login.verificationUrl});
  } catch {
    await finish('failed');
    return res.status(503).json({message:'Chưa lấy được mã từ OpenAI. Anh thử lại hoặc mở trang hạn mức chính thức.'});
  }
});

router.get('/device/:id', (req,res) => {
  const flow=flows.get(req.params.id);
  return res.json({status:flow?.status || 'expired', quota:flow?.quota || false});
});
router.post('/device/:id/cancel',(req,res)=>{
  flows.get(req.params.id)?.stop?.();
  return res.sendStatus(204);
});

const platforms = new Set(['claude','google-ai','grok','seedance','runninghub','kalodata','openrouter','codex','copilot','aliyun','antigravity','kimi','minimax','zai','ollama','opencode','cursor']);
const writing = new Set<string>();
router.post('/reading', async (req,res)=>{
  const {platform, used, total, balance, unit} = req.body || {};
  const label=nameOf(req.body?.name);
  const balanceOnly = balance !== undefined;
  const valid = balanceOnly ? Number.isFinite(balance) && balance>=0 && ['credit','USD','lượt'].includes(unit)
    : Number.isFinite(used) && Number.isFinite(total) && used>=0 && total>0 && used<=total;
  if (!platforms.has(platform) || !label || !valid)
    return res.status(400).json({message:'Kiểm tra lại tên, số đã dùng và tổng hạn mức.'});
  const name=label+' · '+platform+' · tự nhập';
  if (writing.has(name)) return res.status(409).json({message:'Đang lưu số liệu cho tài khoản này.'});
  writing.add(name);
  try {
    const found=await storage.getProviderByName(P.WALLET,name);
    const account=found || await storage.createProvider(P.WALLET,{provider:P.WALLET,name,refreshInterval:0,credentials:{type:AuthType.MANUAL,value:'manual'}});
    const snapshot:UsageSnapshot = {provider:P.WALLET,progress:[],updatedAt:new Date()};
    if (balanceOnly) snapshot.identity={walletBalance:{value:balance,unit}};
    else {
      const percent=100*(used/total);
      snapshot.progress=[{name:'Đã dùng · tự nhập',used,limit:total,usedPercent:percent,remainingPercent:100-percent}];
    }
    await storage.recordUsage(account.id,snapshot);
    return res.json({saved:true});
  } catch {return res.status(503).json({message:'Chưa lưu được số liệu. Anh có thể thử lại với cùng tên.'});}
  finally {writing.delete(name);}
});
export default router;
