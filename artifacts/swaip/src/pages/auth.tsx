import { useState, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";

export default function Auth() {
  const { generateKey, enterWithKey } = useAuth();
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [inputKey, setInputKey] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = () => {
    const key = generateKey();
    setGeneratedKey(key);
  };

  const handleCopy = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEnterWithKey = () => {
    const ok = enterWithKey(inputKey);
    if (!ok) {
      setError("Введи действительный ключ");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-between bg-background overflow-hidden relative">
      {/* Neon glow background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[480px] h-[480px] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute bottom-0 left-1/4 w-[320px] h-[320px] rounded-full bg-violet-600/10 blur-[100px]" />
      </div>

      {/* Top spacer */}
      <div />

      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-sm px-6">

        {/* Logo */}
        <div className="mb-6 w-32 h-32 rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(0,255,255,0.2)]">
          <img
            src="/swaip-logo.png"
            alt="SWAIP"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Brand */}
        <h1 className="text-4xl font-black tracking-tight text-white mb-1">SWAIP</h1>
        <p className="text-sm text-cyan-400 font-medium mb-10 tracking-widest uppercase">
          1 свайп — 4 жизни
        </p>

        {!generatedKey && !pasteMode && (
          <div className="flex flex-col w-full gap-3">
            <button
              onClick={handleGenerate}
              className="w-full py-4 rounded-2xl font-bold text-base text-background bg-cyan-400 hover:bg-cyan-300 active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(0,255,255,0.35)]"
            >
              Сгенерировать мастер-ключ
            </button>

            <button
              onClick={() => setPasteMode(true)}
              className="w-full py-4 rounded-2xl font-semibold text-base text-foreground bg-white/5 border border-white/10 hover:bg-white/10 active:scale-[0.98] transition-all backdrop-blur-md"
            >
              У меня уже есть аккаунт
            </button>
          </div>
        )}

        {/* Generated key — show and confirm */}
        {generatedKey && !pasteMode && (
          <div className="flex flex-col w-full gap-4">
            <div className="rounded-2xl border border-cyan-500/30 bg-white/5 backdrop-blur-md p-4">
              <p className="text-xs text-muted-foreground mb-2 uppercase tracking-widest">Твой мастер-ключ</p>
              <p className="font-mono text-sm text-cyan-300 break-all leading-relaxed select-all">
                {generatedKey}
              </p>
            </div>

            <p className="text-xs text-muted-foreground text-center px-2">
              Сохрани этот ключ — он единственный способ войти снова.
              Никаких почт. Никаких паролей.
            </p>

            <button
              onClick={handleCopy}
              className="w-full py-3 rounded-2xl font-semibold text-sm text-cyan-400 border border-cyan-500/40 bg-white/5 hover:bg-white/10 transition-all backdrop-blur-md"
            >
              {copied ? "Скопировано!" : "Скопировать ключ"}
            </button>

            <button
              onClick={() => {}} // already logged in after generateKey()
              className="w-full py-4 rounded-2xl font-bold text-base text-background bg-cyan-400 hover:bg-cyan-300 active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(0,255,255,0.35)]"
            >
              Я здесь!
            </button>
          </div>
        )}

        {/* Paste existing key */}
        {pasteMode && (
          <div className="flex flex-col w-full gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden">
              <input
                ref={inputRef}
                type="text"
                value={inputKey}
                onChange={e => { setInputKey(e.target.value); setError(""); }}
                placeholder="Вставь свой мастер-ключ..."
                className="w-full bg-transparent px-4 py-4 text-sm text-foreground placeholder:text-muted-foreground outline-none font-mono"
                autoFocus
                onKeyDown={e => e.key === "Enter" && handleEnterWithKey()}
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 text-center">{error}</p>
            )}

            <button
              onClick={handleEnterWithKey}
              className="w-full py-4 rounded-2xl font-bold text-base text-background bg-cyan-400 hover:bg-cyan-300 active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(0,255,255,0.35)]"
            >
              Я здесь!
            </button>

            <button
              onClick={() => { setPasteMode(false); setInputKey(""); setError(""); }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center py-2"
            >
              Назад
            </button>
          </div>
        )}
      </div>

      {/* Bottom */}
      <div className="relative z-10 pb-10 text-center">
        <p className="text-xs text-muted-foreground tracking-wide">
          Никаких почт. Никаких телефонов.
        </p>
      </div>
    </div>
  );
}
