import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { X, User, Mail, Phone, Edit3, Check, LogOut, AlertCircle, Hash, Calendar } from "lucide-react";

interface Props { open: boolean; onClose: () => void; }

export function ProfilePanel({ open, onClose }: Props) {
  const { user, logout, updateProfile } = useAuth();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saveOk, setSaveOk]   = useState(false);
  const [error, setError]     = useState("");
  const [form, setForm]       = useState({ name: "", email: "", phone: "" });

  useEffect(() => {
    if (user) setForm({ name: user.name, email: user.email, phone: user.phone });
  }, [user, open]);

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    setError("");
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
      setError("All fields are required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError("Invalid email address");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateProfile(form);
      setSaveOk(true);
      setEditing(false);
      setTimeout(() => setSaveOk(false), 2500);
    } catch (e: any) {
      setError(e.message ?? "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    onClose();
    await logout();
  };

  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  const joinDate = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : "";

  const fields = [
    { key: "name",  label: "Full Name",     icon: User,  type: "text"  },
    { key: "email", label: "Email Address", icon: Mail,  type: "email" },
    { key: "phone", label: "Phone Number",  icon: Phone, type: "tel"   },
  ] as const;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-foreground/20 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-[61] w-80 flex flex-col bg-card border-l border-border shadow-2xl"
          >
            {/* Top primary bar */}
            <div className="h-1.5 w-full bg-primary flex-shrink-0 rounded-t-none" />

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0 border-b border-border">
              <span className="font-bold text-foreground text-sm">My Profile</span>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Avatar + info */}
            <div className="px-5 py-6 flex flex-col items-center gap-3 flex-shrink-0 border-b border-border bg-muted/30">
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black text-primary-foreground bg-primary shadow-md"
              >
                {initials}
              </motion.div>
              <div className="text-center">
                <p className="font-bold text-foreground text-base">{user?.name}</p>
                <div className="flex items-center gap-1.5 justify-center mt-1">
                  <Hash className="w-3 h-3 text-primary" />
                  <span className="text-xs text-primary font-bold font-mono">
                    Login ID: {String(user?.loginId ?? 0).padStart(4, "0")}
                  </span>
                </div>
                <div className="flex items-center gap-1 justify-center mt-1">
                  <Calendar className="w-3 h-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground">Joined {joinDate}</p>
                </div>
              </div>
            </div>

            {/* Fields */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
              {fields.map(({ key, label, icon: Icon, type }) => (
                <div key={key}>
                  <label className="block text-[10px] font-bold text-muted-foreground mb-1.5 tracking-wider uppercase">
                    {label}
                  </label>
                  <div className="relative">
                    <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type={type}
                      value={form[key]}
                      onChange={handleChange(key)}
                      disabled={!editing}
                      className={`w-full pl-9 pr-4 py-2.5 rounded-lg text-sm text-foreground bg-background border outline-none transition-all duration-150 disabled:cursor-default disabled:opacity-80 ${
                        editing
                          ? "border-input focus:border-primary focus:ring-1 focus:ring-primary/20"
                          : "border-border"
                      }`}
                    />
                  </div>
                </div>
              ))}

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 text-xs text-destructive px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 font-medium"
                  >
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Save success */}
              <AnimatePresence>
                {saveOk && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 text-xs text-success px-3 py-2 rounded-lg bg-success/10 border border-success/20 font-medium"
                  >
                    <Check className="w-3.5 h-3.5 flex-shrink-0" />
                    Profile updated successfully
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Action buttons */}
            <div className="px-5 py-4 flex-shrink-0 space-y-2.5 border-t border-border">
              {editing ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditing(false);
                      setError("");
                      if (user) setForm({ name: user.name, email: user.email, phone: user.phone });
                    }}
                    className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-muted-foreground border border-border hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <motion.button
                    onClick={handleSave}
                    disabled={saving}
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-1.5 disabled:opacity-60 transition-colors shadow-sm"
                  >
                    {saving
                      ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                          className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />
                      : <><Check className="w-3.5 h-3.5" /> Save</>
                    }
                  </motion.button>
                </div>
              ) : (
                <motion.button
                  onClick={() => setEditing(true)}
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  className="w-full py-2.5 rounded-lg text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-2 transition-colors shadow-sm"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Edit Profile
                </motion.button>
              )}

              <motion.button
                onClick={handleLogout}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                className="w-full py-2.5 rounded-lg text-sm font-semibold text-destructive border border-destructive/20 hover:bg-destructive/5 flex items-center justify-center gap-2 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
