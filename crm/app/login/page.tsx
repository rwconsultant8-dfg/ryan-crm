import LoginForm from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="login-wrap">
      <div className="card">
        <h1>ZEST</h1>
        <p className="muted small">只限團隊成員使用。帳戶由主管開設。</p>
        <LoginForm initialError={error === "inactive" ? "帳戶已停用，請聯絡主管" : undefined} />
      </div>
    </div>
  );
}
