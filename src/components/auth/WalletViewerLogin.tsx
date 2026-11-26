import React, {useEffect,useRef,useState} from 'react';
import {apiService} from '../../services/ApiService';

export function WalletViewerLogin({unlock}:{unlock:()=>void}){
  const popup=useRef<Window|null>(null);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    async function receive(event:MessageEvent){
      const other=popup.current;
      if(!other || event.origin!==location.origin || event.source!==other) return;
      if(event.data==='wallet.viewer.ready'){other.postMessage('wallet.viewer.request',location.origin);return;}
      if(event.data?.action!=='wallet.viewer.ticket'||typeof event.data.ticket!=='string')return;
      try{
        const response=await fetch('/connect/viewer/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket:event.data.ticket})});
        if(!response.ok || !(await apiService.getAuthStatus()).authenticated)throw Error();
        sessionStorage.setItem('aimeter_normal_authenticated','true');
        other.postMessage('wallet.viewer.done',location.origin);
        unlock();
      }catch{setMessage('Chưa mở được trong Lark. Anh có thể mở dashboard ở thẻ riêng.');}
    }
    window.addEventListener('message',receive);
    return ()=>window.removeEventListener('message',receive);
  },[unlock]);
  return <div className="mb-4 space-y-2"><button type="button" className="btn-primary w-full" onClick={()=>{
    if(window.top===window.self){location.assign('/connect/dashboard');return;}
    popup.current=window.open('/connect/dashboard','_blank','popup,width=600,height=680');
    setMessage(popup.current?'Xác nhận Google trong cửa sổ vừa mở.':'Trình duyệt đang chặn cửa sổ. Anh có thể mở dashboard ở thẻ riêng.');
  }}>Mở dashboard bằng Google</button>
    {message && <p role="status" className="text-sm">{message} <a className="underline" href="/connect/dashboard" target="_blank" rel="noreferrer">Mở thẻ riêng</a></p>}</div>;
}
