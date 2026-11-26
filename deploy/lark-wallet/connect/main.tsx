import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthType, UsageProvider as P, PROVIDER_NAMES } from '../../../src/types';
import { apiService } from '../../../src/services/ApiService';
import { credentialService } from '../../../src/services/CredentialService';
import { initializeTheme } from '../../../src/theme';
import { CopilotLogin } from './copilot-login';
import '../../../src/index.css';
import './portal.css';

type Platform = {id:string; label:string; page?:string; hint?:string};
const wallet:Platform[] = [
  {id:'codex',label:'ChatGPT / Codex', page:'https://chatgpt.com/codex/settings/usage',hint:'Theo dõi hạn mức Codex của từng tài khoản ChatGPT.'},
  {id:'claude',label:'Claude',page:'https://claude.ai/settings/usage'},
  {id:'google-ai',label:'Google AI Pro',page:'https://one.google.com/ai/credits',hint:'Xem credit AI trong Google One.'},
  {id:'grok',label:'Grok',page:'https://grok.com/'},
  {id:'runninghub',label:'RunningHub',page:'https://www.runninghub.ai/'},
  {id:'openrouter',label:'OpenRouter',page:'https://openrouter.ai/activity'},
  {id:'seedance',label:'Seedance',hint:'Mở ứng dụng nơi anh mua hoặc sử dụng Seedance để xem credit.'},
  {id:'kalodata',label:'Kalodata',page:'https://www.kalodata.com/'},
  {id:'copilot',label:'GitHub Copilot',page:'https://github.com/settings/copilot',hint:'Dùng cho tài khoản GitHub có Copilot.'},
];
const other:Platform[]=Object.values(P).filter(id=>id!==P.WALLET && !wallet.some(p=>p.id===id))
  .map(id=>({id,label:PROVIDER_NAMES[id]}));
const all=[...wallet,...other];

async function request(path:string, body?:unknown) {
  const response=await fetch('/connect/api/providers/wallet/'+path,{
    method:body===undefined?'GET':'POST',
    ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),
  });
  if (response.status===204) return {};
  const data=await response.json().catch(()=>({}));
  if (!response.ok) throw Error(data.message || (response.status===403?'Anh tải lại trang và đăng nhập Wallet bằng Google.':'Chưa thực hiện được. Anh thử lại nhé.'));
  return data;
}

function Codex({name,done,lock}:{name:string;done:(text:string)=>void;lock:(v:boolean)=>void}) {
  const [flow,setFlow]=useState<{flowId:string;code:string;url:string}>();
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);
  async function start() {
    setPending(true); lock(true); setError(''); setCopied(false);
    try {setFlow(await request('device/start',{name}));}
    catch(e){setError((e as Error).message);lock(false);}
    finally {setPending(false);}
  }
  useEffect(()=>{
    if(!flow) return;
    let active=true; let timer:number;
    async function check(){
      try {
        const result=await request('device/'+flow!.flowId);
        if(!active) return;
        if(result.status==='connected') {lock(false);done(result.quota?'Đã kết nối và nhận hạn mức Codex.':'Đã kết nối. AIMeter đang chờ số liệu hạn mức đầu tiên.');return;}
        if(['expired','failed'].includes(result.status)){setFlow(undefined);lock(false);setError('Phiên xác nhận đã kết thúc. Anh có thể lấy mã mới.');return;}
        setError('');
      } catch(e){if(active)setError((e as Error).message);}
      if(active) timer=window.setTimeout(check,3000);
    }
    timer=window.setTimeout(check,2500);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[flow,done,lock]);
  async function cancel(){if(!flow)return;try{await request('device/'+flow.flowId+'/cancel',{});setFlow(undefined);lock(false);}catch(e){setError((e as Error).message);}}
  return <section className="setup-step">{flow ? <>
    <p>Mã này đăng nhập Codex trên VPS. Nhập mã trên trang OpenAI bằng đúng tài khoản anh muốn theo dõi. Wallet tự lưu sau khi anh xác nhận.</p>
    <div className="setup-links"><strong className="device-code">{flow.code}</strong>
      <button onClick={async()=>{try{await navigator.clipboard.writeText(flow.code);setCopied(true);}catch{setError('Anh chọn mã và sao chép bằng tay.');}}}>{copied?'Đã sao chép':'Sao chép mã'}</button></div>
    <a className="setup-primary" href={flow.url} target="_blank" rel="noreferrer">Mở OpenAI để xác nhận ↗</a>
    <p role="status">Đang chờ OpenAI xác nhận…</p><button className="setup-options" onClick={cancel}>Hủy mã này</button>
  </> : <button className="setup-primary" disabled={pending} onClick={start}>{pending?'Đang lấy mã…':'Kết nối ChatGPT bằng mã'}</button>}
    <details><summary>Nếu OpenAI yêu cầu bật đăng nhập bằng mã</summary><p>Trong ChatGPT, mở Settings → Security và bật Device code authorization. Với gói Business, quản trị viên có thể cần bật tùy chọn này cho workspace.</p></details>
    {error && <p role="alert" className="setup-error">{error}</p>}</section>;
}

function Reading({platform,name,done}:{platform:Platform;name:string;done:(v:string)=>void}){
  const [unit,setUnit]=useState(['runninghub','seedance','google-ai','openrouter'].includes(platform.id)?'balance':'percent');
  const [balanceUnit,setBalanceUnit]=useState(platform.id==='openrouter'?'USD':'credit');
  const [used,setUsed]=useState(''), [total,setTotal]=useState('');
  const [saving,setSaving]=useState(false), [error,setError]=useState('');
  async function save(event:React.FormEvent){
    event.preventDefault();setSaving(true);setError('');
    try {await request('reading',{platform:platform.id,name,...(unit==='balance'?{balance:Number(used),unit:balanceUnit}:{used:Number(used),total:unit==='percent'?100:Number(total)})});done('Đã lưu số liệu tự nhập của '+name+'.');}
    catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  return <form className="setup-step" onSubmit={save}><p>Dashboard ghi thời điểm anh cập nhật. Lần sau chọn lại cùng tên để cập nhật số mới.</p>
    <label htmlFor="unit">Trang tài khoản hiển thị gì?</label><select id="unit" value={unit} onChange={e=>{setUnit(e.target.value);setUsed('');setTotal('');}}>
      <option value="balance">Số dư còn lại</option><option value="percent">Phần trăm đã dùng</option><option value="count">Số đã dùng và tổng hạn mức</option></select>
    <label htmlFor="used">{unit==='balance'?'Số còn lại':unit==='percent'?'Đã dùng (%)':'Số đã dùng'}</label>
    <input id="used" type="number" min="0" max={unit==='percent'?100:total||undefined} step="any" value={used} required onChange={e=>setUsed(e.target.value)}/>
    {unit==='balance' && <><label htmlFor="balance-unit">Đơn vị</label><select id="balance-unit" value={balanceUnit} onChange={e=>setBalanceUnit(e.target.value)}>{['credit','USD','lượt'].map(v=><option key={v}>{v}</option>)}</select></>}
    {unit==='count' && <><label htmlFor="total">Tổng hạn mức</label><input id="total" type="number" min="0" step="any" value={total} required onChange={e=>setTotal(e.target.value)}/></>}
    <button className="setup-primary" disabled={saving}>{saving?'Đang lưu…':'Lưu số liệu'}</button>
    {error && <p role="alert" className="setup-error">{error}</p>}</form>;
}

function Account({platform,done,lock}:{platform:Platform;done:(v:string)=>void;lock:(v:boolean)=>void}){
  const [alias,setAlias]=useState(''), [key,setKey]=useState(''), [manual,setManual]=useState(false);
  const [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [copilot,setCopilot]=useState('');
  const attempt=useRef('');
  const name=alias.trim() || platform.label;
  const automatic=['codex','copilot','openrouter'].includes(platform.id);
  useEffect(()=>{
    if(!copilot || attempt.current===copilot)return;
    attempt.current=copilot;
    void completeCopilot();
  },[copilot]);
  async function completeCopilot(){
    setBusy(true);lock(true);setError('');
    try {await apiService.completeCopilotAuth({tempCredentialId:copilot,name,refreshInterval:5});done('Đã kết nối '+name+'.');}
    catch{setError('Chưa lưu được. Nếu đã có tài khoản trùng tên, anh đổi tên hiển thị rồi thử lại.');}
    finally{setBusy(false);lock(false);}
  }
  async function saveKey(event:React.FormEvent){
    event.preventDefault();setBusy(true);lock(true);setError('');
    try{await credentialService.saveConfig(P.OPENROUTER,{provider:P.OPENROUTER,name,refreshInterval:5,credentials:{type:AuthType.API_KEY,value:key.trim()}});setKey('');done('Đã kết nối '+name+'.');}
    catch{setError('Chưa đọc được số dư. Anh kiểm tra quyền đọc cấp tổ chức và tên tài khoản rồi thử lại.');}
    finally{setBusy(false);lock(false);}
  }
  return <div className="setup-form">{platform.hint && <p>{platform.hint}</p>}
    <details><summary>Đặt tên để phân biệt nhiều tài khoản</summary><div className="setup-step">
      <label htmlFor="alias">Tên trên dashboard</label><input id="alias" maxLength={120} placeholder={platform.label} list="account-names" value={alias} disabled={busy} onChange={e=>setAlias(e.target.value)}/>
      <datalist id="account-names">{(platform.id==='codex'?['ChatGPT Business 1','ChatGPT Business 2','ChatGPT BOD']:platform.id==='grok'?['Grok công ty 1','Grok công ty 2','Grok BOD']:[]).map(v=><option key={v} value={v}/>)}</datalist></div></details>
    {automatic && !manual && (platform.id==='codex'?<Codex name={name} done={done} lock={lock}/>:platform.id==='copilot'?<>
      <CopilotLogin onReady={setCopilot}/>{copilot && error && <button className="setup-primary" disabled={busy} onClick={completeCopilot}>Thử lưu lại</button>}</>:
      <form className="setup-step" onSubmit={saveKey}><p>Trong OpenRouter, chọn <b>Read only</b> khi tạo khóa quản lý cấp tổ chức để đọc số dư.</p>
        <a className="setup-options" href="https://openrouter.ai/settings/management-keys" target="_blank" rel="noreferrer">Mở trang tạo khóa OpenRouter ↗</a>
        <label htmlFor="key">Khóa chỉ đọc</label><input id="key" type="password" required autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/>
        <button className="setup-primary" disabled={busy}>{busy?'Đang kiểm tra…':'Kết nối OpenRouter'}</button></form>)}
    {(!automatic || manual) && <section className="setup-step">
      <p>{automatic?'Anh đang chọn cập nhật bằng tay.':'Wallet chưa tự lấy hạn mức của nền tảng này.'}</p>
      {platform.page && <a className="setup-primary" href={platform.page} target="_blank" rel="noreferrer">Mở tài khoản {platform.label} ↗</a>}
      <details open={manual || undefined}><summary>Ghi số liệu vào Wallet</summary><Reading platform={platform} name={name} done={done}/></details>
    </section>}
    {automatic && <button disabled={busy} className="setup-options mode-switch" onClick={()=>setManual(!manual)}>{manual?'Quay lại kết nối tự động':'Cập nhật bằng tay'}</button>}
    {error && <p className="setup-error" role="alert">{error}</p>}
  </div>;
}

function App(){
  const [id,setId]=useState('codex'),[busy,setBusy]=useState(false),[saved,setSaved]=useState('');
  const platform=all.find(p=>p.id===id)!;
  return <main className="account-setup"><a href="/connect/dashboard" className="setup-back">← Dashboard AIMeter</a><h1>Thêm tài khoản AI</h1>
    {saved?<section className="setup-card"><p role="status">{saved}</p><a className="setup-primary" href="/connect/dashboard">Xem dashboard</a>
      <button className="setup-alternate" onClick={()=>setSaved('')}>Thêm tài khoản khác</button></section>:
    <section className="setup-card"><label htmlFor="platform">Anh muốn thêm tài khoản nào?</label>
      <div className="setup-picker"><select id="platform" disabled={busy} value={id} onChange={e=>setId(e.target.value)}>
        <optgroup label="AIKING AI Wallet">{wallet.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
        <optgroup label="Nền tảng khác">{other.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</optgroup></select></div>
      <Account key={id} platform={platform} done={setSaved} lock={setBusy}/></section>}</main>;
}
initializeTheme();
createRoot(document.getElementById('root')!).render(<App/>);
