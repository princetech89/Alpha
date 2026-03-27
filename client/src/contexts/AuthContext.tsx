import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface ProfileUser {
  loginId:   number;
  name:      string;
  email:     string;
  phone:     string;
  createdAt: string;
}

interface AuthCtx {
  user:          ProfileUser | null;
  loading:       boolean;
  login:         (data: { email: string; password: string }) => Promise<void>;
  register:      (data: { name: string; email: string; phone: string; password: string }) => Promise<void>;
  logout:        () => Promise<void>;
  updateProfile: (data: { name: string; email: string; phone: string }) => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null, loading: true,
  login: async () => {}, register: async () => {}, logout: async () => {}, updateProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Check existing session on mount
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => setUser(data ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (data: { email: string; password: string }) => {
    const res = await fetch("/api/auth/login", {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Login failed");
    setUser(json);
  };

  const register = async (data: { name: string; email: string; phone: string; password: string }) => {
    const res = await fetch("/api/auth/register", {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Registration failed");
    setUser(json);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    // Navigation handled by AppShell reacting to user state change
  };

  const updateProfile = async (data: { name: string; email: string; phone: string }) => {
    const res = await fetch("/api/auth/profile", {
      method:      "PUT",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Update failed");
    setUser(json);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
