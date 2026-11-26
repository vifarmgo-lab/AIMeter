// This script runs on the same origin as the viewer after Google sign-in.
const status = document.getElementById('status');
const origin = location.origin;
let handled = false;
const openerWindow = window.opener;

async function openHere() {
  if (handled) return;
  handled = true;
  try {
    const result = await fetch('/connect/viewer/local',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if (!result.ok) throw Error();
    sessionStorage.setItem('aimeter_normal_authenticated','true');
    location.replace('/');
  } catch { status.textContent='Chưa mở được dashboard. Anh tải lại trang để thử lại.'; }
}
window.addEventListener('message', async event => {
  if (!openerWindow || event.source !== openerWindow || event.origin !== origin) return;
  if (event.data === 'wallet.viewer.done') {
    status.textContent='Dashboard đã mở trong Lark. Anh có thể đóng cửa sổ này.';
    window.close(); return;
  }
  if (event.data !== 'wallet.viewer.request' || handled) return;
  handled=true;
  try {
    const result=await fetch('/connect/viewer/ticket',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if (!result.ok) throw Error();
    const data=await result.json();
    openerWindow.postMessage({action:'wallet.viewer.ticket',ticket:data.ticket},origin);
    status.textContent='Đang mở dashboard trong cửa sổ vừa yêu cầu…';
  } catch {status.textContent='Chưa mở được dashboard. Anh tải lại trang để thử lại.';}
});
if (openerWindow) {
  openerWindow.postMessage('wallet.viewer.ready',origin);
  setTimeout(openHere,1800);
} else {void openHere();}
