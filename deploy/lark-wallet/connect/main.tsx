import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { ProviderModal } from '../../../src/components/common/ProviderModal';
import { ProviderLogo } from '../../../src/components/common/ProviderLogo';
import { AuthType, UsageProvider as P, PROVIDER_NAMES, getRegionsForProvider, type Credential } from '../../../src/types';
import { apiService } from '../../../src/services/ApiService';
import { credentialService } from '../../../src/services/CredentialService';
import { initializeTheme } from '../../../src/theme';
import { exchangeLogin, LoginInputError, loginProviders, usesLogin, type LoginLink } from './linked-login';
import { CopilotLogin } from './copilot-login';
import '../../../src/index.css';
import './portal.css';

const platforms = [P.CODEX, P.CLAUDE, P.OPENROUTER, ...Object.values(P).filter(p => p !== P.CODEX && p !== P.CLAUDE && p !== P.OPENROUTER).sort((a,b)=>PROVIDER_NAMES[a].localeCompare(PROVIDER_NAMES[b]))];
const keyProviders = new Set([P.OPENROUTER, P.MINIMAX, P.ZAI]);

function AccountForm({provider, onSave, onBusy}: {provider: P; onSave: (name: string) => void; onBusy: (busy: boolean) => void}) {
  const isLink = usesLogin(provider);
  const method = usesLogin(provider) ? loginProviders[provider] : undefined;
  const isKey = keyProviders.has(provider);
  const manual = !method && !isKey && provider !== P.COPILOT;
  const regions = getRegionsForProvider(provider);
  const [region, setRegion] = useState(regions[0]?.id || '');
  const [alias, setAlias] = useState('');
  const name = alias.trim() || PROVIDER_NAMES[provider];
  const [options, setOptions] = useState(false);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [link, setLink] = useState<LoginLink>();
  const [generation, setGeneration] = useState(0);
  const [opened, setOpened] = useState(false);
  const [input, setInput] = useState('');
  const confirmed = useRef<Credential>();
  const [copilotId, setCopilotId] = useState('');
  const aliasBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!method) return;
    let active = true;
    setLink(undefined); setLinkError(false);
    method.start().then(value=>{if(active) setLink(value);},()=>{if(active) setLinkError(true);});
    return () => {active = false;};
  }, [method, generation]);

  function newLink() {
    setInput(''); setOpened(false); setError(''); confirmed.current = undefined;
    setGeneration(v=>v+1);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); onBusy(true); setError('');
    let exchanging = false;
    try {
      if (provider === P.COPILOT) {
        if (!copilotId) return;
        await apiService.completeCopilotAuth({tempCredentialId:copilotId,name,refreshInterval:5});
      } else {
        let credentials: Credential;
        if (isLink) {
          if (!link) return;
          if (!confirmed.current) {
            exchanging = true;
            confirmed.current = await exchangeLogin(provider, link, input);
            exchanging = false;
            setInput('');
          }
          credentials = confirmed.current;
        } else if (isKey && input.trim()) {
          credentials = {type:AuthType.API_KEY,value:input.trim()};
        } else return;
        await credentialService.saveConfig(provider,{provider,name,credentials,refreshInterval:5,
          region:region || undefined,claudeAuthMode:provider === P.CLAUDE ? 'oauth' : undefined});
      }
      confirmed.current = undefined; setInput(''); onSave(name);
    } catch (e) {
      const detail = axios.isAxiosError(e) ? e.response?.data?.error?.code : undefined;
      if (detail === 'DUPLICATE_NAME') {
        setOptions(true);setError('Tên này đã được dùng. Anh đổi tên hiển thị rồi bấm lưu lại.');
        requestAnimationFrame(()=>aliasBox.current?.focus());
      } else if (axios.isAxiosError(e) && [401,403].includes(e.response?.status || 0)) {
        setError('Phiên AIMeter có thể đã hết hạn. Anh tải lại trang và đăng nhập lại.');
      } else if (e instanceof LoginInputError) {
        setError(e.message);
      } else {
        setError(exchanging ? 'Chưa xác nhận được kết quả. Anh kiểm tra nội dung vừa dán hoặc lấy liên kết mới.' : 'AIMeter chưa xác nhận được việc lưu. Anh kiểm tra dashboard trước khi thử lại.');
      }
    } finally {saving.current = false; setBusy(false); onBusy(false);}
  }

  const canSave = !busy && (isLink ? Boolean(confirmed.current || (link && opened && input.trim())) : provider === P.COPILOT ? Boolean(copilotId) : isKey && Boolean(input.trim()));
  return <>
    <form onSubmit={save} className="setup-form">
      {method && <section className="setup-step">
        <p>{method.hint}</p>
        {!opened && (link ? <a className="setup-primary" href={link.authUrl} target="_blank" rel="noopener noreferrer" onClick={()=>setOpened(true)}>Đăng nhập {method.label} ↗</a>
          : linkError ? <button className="setup-primary" type="button" onClick={newLink}>Thử tạo lại liên kết</button> : <p role="status">Đang chuẩn bị đăng nhập…</p>)}
        {opened && !confirmed.current && <>
          <label htmlFor="result">Kết quả đăng nhập</label>
          <p id="result-hint">{method.finish}</p>
          <input id="result" type="password" aria-describedby="result-hint" autoComplete="off" value={input} disabled={busy}
            placeholder="Dán kết quả vào đây" onChange={e=>setInput(e.target.value)}/>
          <div className="setup-links"><a href={link?.authUrl} target="_blank" rel="noopener noreferrer">Mở lại trang đăng nhập</a>
          <button type="button" disabled={busy} onClick={newLink}>Lấy liên kết mới</button></div>
        </>}
        {confirmed.current && <p role="status">Đã xác nhận đăng nhập. Anh có thể thử lưu lại.</p>}
      </section>}
      {provider === P.COPILOT && <CopilotLogin onReady={setCopilotId}/>}
      {isKey && <section className="setup-step">
        <label htmlFor="api-key">Khóa API của {PROVIDER_NAMES[provider]}</label>
        {provider === P.OPENROUTER && <p>Wallet chỉ dùng khóa có quyền đọc. Nếu chưa có loại khóa này, anh có thể chọn nền tảng khác.</p>}
        <input type="password" autoComplete="off" id="api-key" value={input} disabled={busy} onChange={e=>setInput(e.target.value)} placeholder="Dán khóa API"/>
      </section>}
      {manual && <section className="setup-step"><p>AIMeter hiện chỉ hỗ trợ kết nối {PROVIDER_NAMES[provider]} thủ công.</p>
        <button className="setup-primary" type="button" onClick={()=>setFull(true)}>Mở biểu mẫu {PROVIDER_NAMES[provider]}</button></section>}
      {!manual && <>
        <button type="button" className="setup-options" aria-expanded={options} aria-controls="account-options" disabled={busy} onClick={()=>setOptions(!options)}>
          {options ? 'Ẩn tùy chọn' : 'Đổi tên hiển thị' + (regions.length ? ' hoặc khu vực' : '')}
        </button>
        {options && <div id="account-options" className="setup-step"><label htmlFor="nickname">Tên trên dashboard</label>
          <input id="nickname" ref={aliasBox} maxLength={255} placeholder={PROVIDER_NAMES[provider]} value={alias} disabled={busy} onChange={e=>setAlias(e.target.value)} />
          {regions.length>0 && <><label htmlFor="region">Khu vực tài khoản</label><select id="region" value={region} disabled={busy} onChange={e=>setRegion(e.target.value)}>
            {regions.map(r=><option key={r.id} value={r.id}>{r.displayName}</option>)}</select></>}
        </div>}
        {(!isLink || opened) && <button className="setup-primary" type="submit" disabled={!canSave}>{busy ? 'Đang kết nối…' : 'Lưu tài khoản'}</button>}
      </>}
      {error && <p className="setup-error" role="alert">{error}</p>}
    </form>
    {!manual && <button className="setup-alternate" type="button" disabled={busy} onClick={()=>setFull(true)}>Biểu mẫu đầy đủ</button>}
    {full && <ProviderModal isOpen initialProvider={provider} initialName={name} onClose={()=>setFull(false)} onSuccess={()=>onSave('')}/>}
  </>;
}

function AccountSetup() {
  const [provider,setProvider] = useState<P>(P.CODEX);
  const [busy,setBusy] = useState(false);
  const [saved,setSaved] = useState<string|null>(null);
  return <main className="account-setup"><a href="/" className="setup-back">← Dashboard AIMeter</a>
    <h1>Thêm tài khoản AI</h1>
    {saved!==null ? <section className="setup-card"><p role="status">{saved ? 'Đã thêm tài khoản ' + saved + '.' : 'Đã thêm tài khoản.'}</p>
      <a className="setup-primary" href="/">Xem dashboard</a><button className="setup-alternate" onClick={()=>setSaved(null)}>Thêm tài khoản khác</button></section>
    : <section className="setup-card"><label htmlFor="provider">Nền tảng</label>
      <div className="setup-picker"><ProviderLogo provider={provider} size={30}/><select id="provider" value={provider} disabled={busy}
        onChange={e=>setProvider(e.target.value as P)}>{platforms.map(p=><option key={p} value={p}>{PROVIDER_NAMES[p]}</option>)}</select></div>
      <AccountForm key={provider} provider={provider} onBusy={setBusy} onSave={setSaved}/></section>}
  </main>;
}

initializeTheme();
createRoot(document.getElementById('root')!).render(<AccountSetup />);
