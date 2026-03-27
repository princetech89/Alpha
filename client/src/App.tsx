import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import NotFound    from "@/pages/NotFound";
import Dashboard   from "@/pages/Dashboard";
import StockDetail from "@/pages/StockDetail";
import ScreenerPage from "@/pages/Screener";
import AlertsPage  from "@/pages/Alerts";
import Login       from "@/pages/Login";
import { Layout }  from "@/components/Layout";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

// ── Page transition wrapper ────────────────────────────────────────────────────
function PageTransition({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.22, ease: "easeInOut" }}
        className="w-full h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// ── Inner app routes ───────────────────────────────────────────────────────────
function AppRouter() {
  const [location] = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className="w-full h-full"
      >
        <Switch>
          <Route path="/"              component={Dashboard}    />
          <Route path="/screener"      component={ScreenerPage} />
          <Route path="/alerts"        component={AlertsPage}   />
          <Route path="/stock/:symbol" component={StockDetail}  />
          <Route                       component={NotFound}     />
        </Switch>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Loading screen ─────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <div className="w-12 h-12 rounded-xl border border-border bg-card flex items-center justify-center shadow-sm">
        <img src="/favicon.svg" alt="AlphaSignal" className="w-8 h-8 object-contain" />
      </div>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
        className="w-5 h-5 border-2 border-border border-t-primary rounded-full"
      />
    </div>
  );
}

// ── App shell — decides what to show based on auth state ─────────────────────
function AppShell() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <AnimatePresence mode="wait">
      {!user ? (
        <PageTransition key="login" id="login">
          <Login />
        </PageTransition>
      ) : (
        <PageTransition key="app" id="app">
          <Layout>
            <AppRouter />
          </Layout>
        </PageTransition>
      )}
    </AnimatePresence>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
