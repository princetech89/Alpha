import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import {
  User, Mail, Phone, Lock, Eye, EyeOff,
  ArrowRight, AlertCircle, CheckCircle2,
} from "lucide-react";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode]         = useState<"signin" | "signup">("signin");
  const [showPwd, setShowPwd]   = useState(false);
  const [showCPwd, setShowCPwd] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [success, setSuccess]   = useState(false);
  const [apiError, setApiErr]   = useState("");

  const [form, setForm] = useState({
    name: "", email: "", phone: "", password: "", confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setErrors(er => ({ ...er, [field]: "" }));
    setApiErr("");
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (mode === "signup") {
      if (!form.name.trim())  errs.name  = "Full name is required";
      if (!form.phone.trim()) errs.phone = "Phone number is required";
      else if (form.phone.replace(/\D/g, "").length < 10)
        errs.phone = "Must be at least 10 digits";
      if (form.password.length < 6) errs.password = "Minimum 6 characters";
      if (form.password !== form.confirmPassword) errs.confirmPassword = "Passwords do not match";
    }
    if (!form.email.trim())   errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Invalid email format";
    if (!form.password.trim()) errs.password = "Password is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiErr("");
    try {
      if (mode === "signup") {
        await register({ name: form.name, email: form.email, phone: form.phone, password: form.password });
      } else {
        await login({ email: form.email, password: form.password });
      }
      setSuccess(true);
    } catch (err: any) {
      setApiErr(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: "signin" | "signup") => {
    setMode(m);
    setErrors({});
    setApiErr("");
    setForm({ name: "", email: "", phone: "", password: "", confirmPassword: "" });
  };

  return (
    <div className="min-h-screen w-full flex bg-background overflow-hidden">

      {/* ── LEFT PANEL — white/light with form ─────────────────────────────── */}
      <motion.div
        initial={{ x: -60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 flex items-center justify-center px-6 py-10 bg-background relative overflow-y-auto"
      >
        {/* Subtle background circles */}
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-primary/5 pointer-events-none" />
        <div className="absolute -bottom-24 -right-16 w-72 h-72 rounded-full bg-primary/5 pointer-events-none" />

        <div className="w-full max-w-sm relative z-10">

          {/* Mobile logo */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex items-center gap-2.5 mb-7 lg:hidden"
          >
            <img src="/favicon.svg" alt="AlphaSignal" className="w-8 h-8 object-contain" />
            <span className="font-black text-foreground text-lg">AlphaSignal</span>
          </motion.div>

          {/* Mode tabs */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="flex bg-muted rounded-xl p-1 mb-6"
          >
            {(["signin", "signup"] as const).map(m => (
              <button key={m} onClick={() => switchMode(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${
                  mode === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}>
                {m === "signin" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </motion.div>

          {/* Heading */}
          <AnimatePresence mode="wait">
            <motion.div key={mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="mb-5">
              <h2 className="text-2xl font-black text-foreground tracking-tight">
                {mode === "signin" ? "Welcome back" : "Create account"}
              </h2>
              <p className="text-muted-foreground text-sm mt-0.5">
                {mode === "signin" ? "Sign in to your AlphaSignal account" : "Join AlphaSignal today"}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <AnimatePresence>
              {mode === "signup" && (
                <motion.div key="name" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                  <label className="block text-xs font-bold text-foreground mb-1.5">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="text" value={form.name} onChange={handleChange("name")}
                      placeholder="Enter your full name" autoComplete="name"
                      className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-sm bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-all border ${errors.name ? "border-destructive ring-1 ring-destructive/20" : "border-input focus:border-primary focus:ring-2 focus:ring-primary/15"}`} />
                  </div>
                  {errors.name && <p className="mt-1 text-[11px] text-destructive flex items-center gap-1 font-medium"><AlertCircle className="w-3 h-3" />{errors.name}</p>}
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-xs font-bold text-foreground mb-1.5">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="email" value={form.email} onChange={handleChange("email")}
                  placeholder="Enter your email" autoComplete="email"
                  className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-sm bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-all border ${errors.email ? "border-destructive ring-1 ring-destructive/20" : "border-input focus:border-primary focus:ring-2 focus:ring-primary/15"}`} />
              </div>
              {errors.email && <p className="mt-1 text-[11px] text-destructive flex items-center gap-1 font-medium"><AlertCircle className="w-3 h-3" />{errors.email}</p>}
            </div>

            <AnimatePresence>
              {mode === "signup" && (
                <motion.div key="phone" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                  <label className="block text-xs font-bold text-foreground mb-1.5">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="tel" value={form.phone} onChange={handleChange("phone")}
                      placeholder="Enter your phone number" autoComplete="tel"
                      className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-sm bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-all border ${errors.phone ? "border-destructive ring-1 ring-destructive/20" : "border-input focus:border-primary focus:ring-2 focus:ring-primary/15"}`} />
                  </div>
                  {errors.phone && <p className="mt-1 text-[11px] text-destructive flex items-center gap-1 font-medium"><AlertCircle className="w-3 h-3" />{errors.phone}</p>}
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-xs font-bold text-foreground mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type={showPwd ? "text" : "password"} value={form.password} onChange={handleChange("password")}
                  placeholder={mode === "signup" ? "Create a password (min 6 chars)" : "Enter your password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className={`w-full pl-10 pr-10 py-2.5 rounded-xl text-sm bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-all border ${errors.password ? "border-destructive ring-1 ring-destructive/20" : "border-input focus:border-primary focus:ring-2 focus:ring-primary/15"}`} />
                <button type="button" onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-[11px] text-destructive flex items-center gap-1 font-medium"><AlertCircle className="w-3 h-3" />{errors.password}</p>}
            </div>

            <AnimatePresence>
              {mode === "signup" && (
                <motion.div key="cpwd" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                  <label className="block text-xs font-bold text-foreground mb-1.5">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type={showCPwd ? "text" : "password"} value={form.confirmPassword}
                      onChange={handleChange("confirmPassword")} placeholder="Re-enter your password"
                      autoComplete="new-password"
                      className={`w-full pl-10 pr-10 py-2.5 rounded-xl text-sm bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-all border ${errors.confirmPassword ? "border-destructive ring-1 ring-destructive/20" : "border-input focus:border-primary focus:ring-2 focus:ring-primary/15"}`} />
                    <button type="button" onClick={() => setShowCPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showCPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.confirmPassword && <p className="mt-1 text-[11px] text-destructive flex items-center gap-1 font-medium"><AlertCircle className="w-3 h-3" />{errors.confirmPassword}</p>}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {apiError && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm text-destructive border border-destructive/25 bg-destructive/5 font-medium">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {apiError}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button type="submit" disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.02 }} whileTap={{ scale: loading ? 1 : 0.98 }}
              className="w-full py-3 rounded-xl font-black text-sm tracking-wide flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60 shadow-sm mt-1">
              {loading
                ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                    className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />
                : success
                ? <><CheckCircle2 className="w-4 h-4" /> {mode === "signin" ? "Signed in!" : "Account created!"}</>
                : <>{mode === "signin" ? "Sign In" : "Create Account"} <ArrowRight className="w-4 h-4" /></>
              }
            </motion.button>
          </form>

          <p className="text-center text-[10px] text-muted-foreground mt-5 leading-relaxed">
            For educational use only · Not SEBI registered investment advice
          </p>
        </div>
      </motion.div>

      {/* ── RIGHT PANEL — red branding ──────────────────────────────────────── */}
      <motion.div
        initial={{ x: 60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="hidden lg:flex lg:w-[44%] flex-col items-center justify-center p-12 bg-primary relative overflow-hidden"
      >
        {/* Animated background orbs */}
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.08, 0.14, 0.08] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[-80px] right-[-80px] w-80 h-80 rounded-full bg-white pointer-events-none"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.06, 0.12, 0.06] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute bottom-[-100px] left-[-60px] w-96 h-96 rounded-full bg-white pointer-events-none"
        />
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.04, 0.09, 0.04] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-white pointer-events-none"
        />

        {/* Center content */}
        <div className="relative z-10 flex flex-col items-center text-center gap-8">
          {/* Big animated logo */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <img src="/favicon.svg" alt="AlphaSignal" className="w-28 h-28 object-contain drop-shadow-2xl" style={{ filter: "drop-shadow(0 0 24px rgba(255,255,255,0.35))" }} />
            </motion.div>
          </motion.div>

          {/* Brand name */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.5 }}
          >
            <h1 className="text-4xl font-black text-white tracking-tight">AlphaSignal</h1>
            <p className="text-white/60 text-sm tracking-widest uppercase font-semibold mt-1">
              Stock Analysis Platform
            </p>
          </motion.div>

          {/* Divider */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="w-16 h-0.5 bg-white/30 rounded-full"
          />

          {/* Tagline */}
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.5 }}
            className="text-white/70 text-base leading-relaxed max-w-[260px]"
          >
            Smart signals. Real-time insights. Faster decisions.
          </motion.p>

          {/* Floating dots decoration */}
          <div className="flex gap-2 mt-2">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                transition={{ duration: 2, repeat: Infinity, delay: i * 0.4, ease: "easeInOut" }}
                className="w-2 h-2 rounded-full bg-white/50"
              />
            ))}
          </div>
        </div>

        {/* Bottom disclaimer */}
        <p className="absolute bottom-6 text-[10px] text-white/35 z-10">
          For educational use only · Not SEBI investment advice
        </p>
      </motion.div>
    </div>
  );
}
