import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProviderModal } from '../../../src/components/common/ProviderModal';
import { initializeTheme } from '../../../src/theme';
import '../../../src/index.css';
import './portal.css';

function AccountSetup() {
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <main className="account-setup">
      <h1>Thêm tài khoản vào AIMeter</h1>
      <p>Chọn nền tảng để xem cách kết nối mà AIMeter hỗ trợ. Mỗi tài khoản có thể có cách xác thực riêng.</p>
      <button className="add-account" onClick={() => { setSaved(false); setAdding(true); }}>Thêm tài khoản</button>
      <a href="/" target="_blank" rel="noreferrer">Xem dashboard</a>
      <p role="status">{saved && 'Đã thêm tài khoản. Anh có thể xem số liệu trên dashboard hoặc thêm tài khoản tiếp theo.'}</p>
      {adding && <ProviderModal isOpen onClose={() => setAdding(false)} onSuccess={() => setSaved(true)} />}
    </main>
  );
}

initializeTheme();
createRoot(document.getElementById('root')!).render(<AccountSetup />);
