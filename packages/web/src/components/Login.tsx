import { useState } from 'react';
import { api, type User } from '../api/client';

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');

  const submit = async (): Promise<void> => {
    setErr(null);
    try {
      const fn = mode === 'login' ? api.login : api.register;
      const { token, user } = await fn(username.trim(), password);
      localStorage.setItem('cmdtoken', token);
      onLogin(user);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>CollabMD</h1>
        <p className="sub">多人实时协作的 Markdown 技术文档平台</p>
        <label>用户名</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <label>密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {err && <div className="error-banner">{err}</div>}
        <div className="actions">
          <button className="primary" onClick={submit}>
            {mode === 'login' ? '登录' : '注册并登录'}
          </button>
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setErr(null);
            }}
          >
            {mode === 'login' ? '注册新账号' : '已有账号'}
          </button>
        </div>
        <div className="hint">
          演示账号（docker 启动后可用）：<br />
          owner / owner123 · editor / editor123<br />
          reviewer / reviewer123 · viewer / viewer123
        </div>
      </div>
    </div>
  );
}
