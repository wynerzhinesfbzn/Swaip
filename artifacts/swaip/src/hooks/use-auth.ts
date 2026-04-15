import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { nanoid } from "nanoid";

export type AppMode = "pro" | "scene";

export interface AuthState {
  hash: string;
  mode: AppMode;
  isLoggedIn: boolean;
  isLoading: boolean;
  changeMode: (m: AppMode) => void;
  generateKey: () => string;
  enterWithKey: (key: string) => boolean;
  logout: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuthState(): AuthState {
  const [hash, setHash] = useState<string>("");
  const [mode, setMode] = useState<AppMode>("pro");
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const storedHash = localStorage.getItem("swaip_hash");
    if (storedHash) {
      setHash(storedHash);
      setIsLoggedIn(true);
    }
    const storedMode = localStorage.getItem("swaip_mode") as AppMode;
    if (storedMode === "pro" || storedMode === "scene") {
      setMode(storedMode);
    }
    setIsLoading(false);
  }, []);

  const generateKey = useCallback((): string => {
    const newHash = nanoid(32);
    localStorage.setItem("swaip_hash", newHash);
    setHash(newHash);
    setIsLoggedIn(true);
    return newHash;
  }, []);

  const enterWithKey = useCallback((key: string): boolean => {
    const trimmed = key.trim();
    if (!trimmed) return false;
    localStorage.setItem("swaip_hash", trimmed);
    setHash(trimmed);
    setIsLoggedIn(true);
    return true;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("swaip_hash");
    setHash("");
    setIsLoggedIn(false);
  }, []);

  const changeMode = useCallback((newMode: AppMode) => {
    setMode(newMode);
    localStorage.setItem("swaip_mode", newMode);
  }, []);

  return { hash, mode, isLoggedIn, isLoading, changeMode, generateKey, enterWithKey, logout };
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
