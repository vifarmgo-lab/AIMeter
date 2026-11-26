import React, { useEffect, useState } from 'react';
import { apiService, type CopilotAuthStartResponse } from '../../../src/services/ApiService';

export function CopilotLogin({ onReady }: { onReady: (id: string) => void }) {
  const [flow, setFlow] = useState<CopilotAuthStartResponse>();
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');

  async function start() {
    setPending(true);
    setMessage('');
    try { setFlow(await apiService.startCopilotAuth()); }
    catch { setMessage('Chưa mở được đăng nhập GitHub. Anh thử lại nhé.'); }
    finally { setPending(false); }
  }

  useEffect(() => {
    if (!flow || ready) return;
    let active = true;
    let timer: number;
    const delay = Math.max(1000, flow.interval * 1000);
    const expires = Date.now() + flow.expiresIn * 1000;
    function restart() {
      setFlow(undefined);
      setMessage('Phiên xác nhận đã kết thúc. Anh có thể bắt đầu lại.');
    }
    async function check() {
      if (Date.now() >= expires) return restart();
      try {
        const result = await apiService.getCopilotAuthStatus(flow!.flowId);
        if (!active) return;
        if (result.status === 'authorized' && result.tempCredentialId) {
          setReady(true); onReady(result.tempCredentialId); return;
        }
        if (result.status === 'expired' || result.status === 'error') return restart();
        setMessage('');
      } catch {
        if (!active) return;
        setMessage('Đang thử lại kết nối với GitHub…');
      }
      timer = window.setTimeout(check,delay);
    }
    timer = window.setTimeout(check,delay);
    return () => {active = false; window.clearTimeout(timer);};
  },[flow,ready,onReady]);

  return <section className="setup-step">
    {ready ? <p role="status">GitHub đã xác nhận đăng nhập.</p> : flow ? <>
      <p>Nhập mã <strong>{flow.userCode}</strong> trên GitHub, rồi quay lại đây.</p>
      <a className="setup-primary" href={flow.verificationUri} target="_blank" rel="noopener noreferrer">Mở GitHub ↗</a>
      <p role="status">Đang chờ GitHub xác nhận…</p>
    </> : <button type="button" className="setup-primary" disabled={pending} onClick={start}>{pending ? 'Đang mở…' : 'Kết nối GitHub'}</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
