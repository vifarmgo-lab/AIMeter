import { apiService } from '../../../src/services/ApiService';
import { AuthType, UsageProvider, type Credential } from '../../../src/types';

export const loginProviders = {
  [UsageProvider.CODEX]: {
    label: 'OpenAI',
    hint: 'Đăng nhập tài khoản ChatGPT dùng cho Codex. Sau đó quay lại đây.',
    finish: 'Dán địa chỉ localhost trên thanh địa chỉ sau khi đăng nhập, kể cả khi trang đó không mở được.',
    start: () => apiService.generateCodexOAuthUrl(),
    exchange: (id: string, code: string, state?: string) => apiService.exchangeCodexOAuthCode(id, code, state),
  },
  [UsageProvider.CLAUDE]: {
    label: 'Claude',
    hint: 'Luồng Claude của AIMeter xin cả quyền sử dụng mô hình và tạo khóa API. Chỉ tiếp tục nếu anh muốn cấp các quyền đó.',
    finish: 'Dán mã hoặc địa chỉ mà Claude hiển thị sau khi anh xác nhận.',
    start: () => apiService.generateClaudeOAuthUrl(),
    exchange: (id: string, code: string, state?: string) => apiService.exchangeClaudeOAuthCode(id, code, state),
  },
  [UsageProvider.ANTIGRAVITY]: {
    label: 'Google',
    hint: 'Kết nối này dành cho Antigravity và yêu cầu quyền Google Cloud. Hãy kiểm tra quyền trên màn hình Google.',
    finish: 'Dán địa chỉ localhost trên thanh địa chỉ sau khi đăng nhập, kể cả khi trang đó không mở được.',
    start: () => apiService.generateAntigravityOAuthUrl(),
    exchange: (id: string, code: string, state?: string) => apiService.exchangeAntigravityOAuthCode(id, code, state),
  },
};

export type LoginProvider = keyof typeof loginProviders;
export type LoginLink = { authUrl: string; sessionId: string };
export const usesLogin = (provider: UsageProvider): provider is LoginProvider => Object.prototype.hasOwnProperty.call(loginProviders, provider);

export class LoginInputError extends Error {}

export function parseLoginResult(provider: LoginProvider, link: LoginLink, input: string) {
  const value = input.trim();
  const auth = new URL(link.authUrl);
  const expected = new URL(auth.searchParams.get('redirect_uri') || '');
  const expectedState = auth.searchParams.get('state');
  let code = '';
  let state: string | undefined;
  if (/^https?:\/\//i.test(value)) {
    const result = new URL(value);
    if (result.origin !== expected.origin || result.pathname !== expected.pathname) throw new LoginInputError('Địa chỉ chưa đúng. Anh hãy dán địa chỉ của trang cuối cùng sau khi đăng nhập.');
    if (result.searchParams.has('error')) throw new LoginInputError('Anh chưa cấp quyền. Hãy mở lại trang đăng nhập khi muốn kết nối.');
    code = result.searchParams.get('code') || '';
    state = result.searchParams.get('state') || undefined;
  } else if (provider === UsageProvider.CLAUDE) {
    const parts = value.split('#');
    if (parts.length <= 2) [code, state] = parts;
  }
  if (!code || /\s/.test(code)) throw new LoginInputError('Chưa thấy mã xác nhận. Anh hãy dán kết quả mà nền tảng trả về sau khi đăng nhập.');
  if ((provider !== UsageProvider.CLAUDE || state) && expectedState && state !== expectedState) throw new LoginInputError('Kết quả này thuộc một lần đăng nhập khác. Hãy dùng liên kết đang mở trên form này.');
  return { code, state };
}

export async function exchangeLogin(provider: LoginProvider, link: LoginLink, input: string): Promise<Credential> {
  const {code, state} = parseLoginResult(provider, link, input);
  const tokens = await loginProviders[provider].exchange(link.sessionId, code, state);
  return {type: AuthType.OAUTH, ...tokens};
}
