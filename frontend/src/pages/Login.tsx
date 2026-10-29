import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { BrandMark } from "../components/BrandMark";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@local");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      navigate("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-[#0A0A0A] p-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(800px 420px at 20% 20%, rgba(255,90,0,0.28), transparent 55%), radial-gradient(700px 500px at 90% 80%, rgba(255,90,0,0.12), transparent 50%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />
      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-white p-7 shadow-lift"
      >
        <BrandMark to={null} subtitle="Test Management" />
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
        <p className="mt-1 mb-5 text-sm text-mute">QA workspace for your project teams.</p>
        {error ? <p className="mb-3 text-sm text-bad">{error}</p> : null}
        <label className="field mb-3">
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="text" autoComplete="username" required />
        </label>
        <label className="field mb-4">
          <span>Password</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </label>
        <button className="btn-primary w-full" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="mt-4 text-xs text-mute">Demo: admin@local / admin123 · qa@local / qa123 · viewer@local / viewer123</p>
      </form>
    </div>
  );
}
