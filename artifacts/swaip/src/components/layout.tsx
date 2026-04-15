import { Link, useLocation } from "wouter";
import { Home, Search, MessageSquare, User, Zap } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { mode, changeMode } = useAuth();

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground flex flex-col max-w-md mx-auto relative shadow-2xl overflow-hidden">
      {/* Background ambient effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-secondary flex items-center justify-center text-black font-bold tracking-tighter">
            S
          </div>
          <span className="font-bold text-xl tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70">
            SWAIP
          </span>
        </div>

        <div className="flex items-center gap-3 bg-black/40 rounded-full px-3 py-1.5 border border-white/5">
          <Label htmlFor="mode-switch" className={`text-xs font-medium cursor-pointer transition-colors ${mode === "pro" ? "text-primary" : "text-muted-foreground"}`}>
            PRO
          </Label>
          <Switch 
            id="mode-switch" 
            checked={mode === "scene"}
            onCheckedChange={(checked) => changeMode(checked ? "scene" : "pro")}
            className="data-[state=checked]:bg-secondary data-[state=unchecked]:bg-primary"
          />
          <Label htmlFor="mode-switch" className={`text-xs font-medium cursor-pointer transition-colors ${mode === "scene" ? "text-secondary" : "text-muted-foreground"}`}>
            SCENE
          </Label>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20 scroll-smooth">
        {children}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 w-full max-w-md mx-auto glass-panel border-t border-white/5 px-6 py-4 z-50">
        <ul className="flex items-center justify-between">
          <li>
            <Link href="/" className={`flex flex-col items-center gap-1 transition-colors ${location === "/" ? "text-primary" : "text-muted-foreground hover:text-white"}`}>
              <Home className="w-6 h-6" />
            </Link>
          </li>
          <li>
            <Link href="/search" className={`flex flex-col items-center gap-1 transition-colors ${location === "/search" ? "text-primary" : "text-muted-foreground hover:text-white"}`}>
              <Search className="w-6 h-6" />
            </Link>
          </li>
          <li>
            <Link href="/messages" className={`flex flex-col items-center gap-1 transition-colors ${location.startsWith("/messages") ? "text-secondary" : "text-muted-foreground hover:text-white"}`}>
              <MessageSquare className="w-6 h-6" />
            </Link>
          </li>
          <li>
            <Link href="/me" className={`flex flex-col items-center gap-1 transition-colors ${location === "/me" ? "text-secondary" : "text-muted-foreground hover:text-white"}`}>
              <User className="w-6 h-6" />
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
