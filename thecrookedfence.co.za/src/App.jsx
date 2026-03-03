import { Suspense, lazy, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { getIdTokenResult, onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "./lib/firebase.js";

const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
const EggOrderPage = lazy(() => import("./pages/EggOrderPage.jsx"));
const LivestockOrderPage = lazy(() => import("./pages/LivestockOrderPage.jsx"));
const TypeDetailPage = lazy(() => import("./pages/TypeDetailPage.jsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx"));
const OperationsPage = lazy(() => import("./pages/OperationsPage.jsx"));

const navLinkClass = ({ isActive }) =>
  [
    "rounded-full",
    "px-3",
    "py-1",
    "text-sm",
    "font-medium",
    "transition",
    "bg-white/10",
    "hover:bg-white/20",
    isActive ? "bg-white/20" : ""
  ]
    .filter(Boolean)
    .join(" ");

const mobileNavLinkClass = ({ isActive }) =>
  [
    "flex",
    "items-center",
    "justify-between",
    "rounded-2xl",
    "px-4",
    "py-3",
    "text-sm",
    "font-semibold",
    "transition",
    "bg-white/10",
    "hover:bg-white/20",
    isActive ? "bg-white/20" : "",
  ]
    .filter(Boolean)
    .join(" ");

function AlertsBellIcon({ unreadNotifications }) {
  return (
    <span className="relative inline-flex h-5 w-5 items-center justify-center">
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
        <path d="M9 17a3 3 0 0 0 6 0" />
      </svg>
      {unreadNotifications > 0 ? (
        <span className="absolute -right-2 -top-2 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold leading-none text-brandGreen">
          {unreadNotifications > 99 ? "99+" : unreadNotifications}
        </span>
      ) : null}
    </span>
  );
}

function NavigationLinks({
  isSignedIn,
  mobile = false,
  onNavigate,
  showAlertsBell,
  unreadNotifications,
}) {
  const linkClass = mobile ? mobileNavLinkClass : navLinkClass;

  return (
    <>
      <NavLink to="/eggs" className={linkClass} onClick={onNavigate}>
        <span>Egg Order Form</span>
      </NavLink>
      <NavLink to="/livestock" className={linkClass} onClick={onNavigate}>
        <span>Livestock Form</span>
      </NavLink>
      {showAlertsBell ? (
        <NavLink
          to="/operations?panel=alerts"
          className={linkClass}
          aria-label="Operations alerts"
          title="Operations alerts"
          onClick={onNavigate}
        >
          {mobile ? (
            <>
              <span>Operations alerts</span>
              <AlertsBellIcon unreadNotifications={unreadNotifications} />
            </>
          ) : (
            <>
              <AlertsBellIcon unreadNotifications={unreadNotifications} />
              <span className="sr-only">Operations alerts</span>
            </>
          )}
        </NavLink>
      ) : null}
      <NavLink to="/admin" className={linkClass} onClick={onNavigate}>
        <span>{isSignedIn ? "Dashboard" : "Login"}</span>
      </NavLink>
    </>
  );
}

function RouteLoadingFallback() {
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-brandGreen/15 bg-white/75 px-4 py-10 text-center text-sm font-semibold text-brandGreen/80 shadow-sm">
      Loading page...
    </div>
  );
}

function AppShell() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [authResolved, setAuthResolved] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const isSignedIn = Boolean(user?.uid) && !user?.isAnonymous;
  const isStaffRole = ["admin", "super_admin", "worker"].includes(role ?? "");
  const showAlertsBell = authResolved && isSignedIn && isStaffRole;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser ?? null);
      if (!nextUser) {
        setRole(null);
        setAuthResolved(true);
        return;
      }
      try {
        const token = await getIdTokenResult(nextUser);
        setRole(token?.claims?.role ?? null);
      } catch (err) {
        console.error("getIdTokenResult app nav error", err);
        setRole(null);
      } finally {
        setAuthResolved(true);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!showAlertsBell) {
      setUnreadNotifications(0);
      return () => {};
    }
    const unsubscribe = onSnapshot(
      query(
        collection(db, "operationsNotifications"),
        where("userId", "==", user.uid),
        where("read", "==", false)
      ),
      (snapshot) => setUnreadNotifications(snapshot.size),
      (err) => {
        console.error("operations notifications badge load error", err);
        setUnreadNotifications(0);
      }
    );
    return () => unsubscribe();
  }, [showAlertsBell, user]);

  useEffect(() => {
    if (!user || role) return () => {};
    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      (snapshot) => {
        const nextRole = snapshot.data()?.role ?? null;
        if (nextRole) setRole(nextRole);
      },
      (err) => console.error("app role snapshot error", err)
    );
    return () => unsubscribe();
  }, [user, role]);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname, location.search]);

  return (
    <div className="min-h-screen bg-brandCream text-brandGreen">
      <nav className="bg-brandGreen text-white">
        <div className="mx-auto max-w-6xl px-4 py-3 md:px-8">
          <div className="flex items-center justify-between gap-3">
            <NavLink
              to="/"
              className="max-w-[11rem] text-lg font-semibold leading-tight tracking-tight sm:max-w-none"
            >
              The Crooked Fence
            </NavLink>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20 md:hidden"
              aria-controls="site-navigation"
              aria-expanded={isMobileNavOpen}
              aria-label={
                isMobileNavOpen ? "Close navigation menu" : "Open navigation menu"
              }
              onClick={() => setIsMobileNavOpen((open) => !open)}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {isMobileNavOpen ? (
                  <path d="M6 6l12 12M18 6L6 18" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
              <span>Menu</span>
            </button>
            <div className="hidden items-center gap-3 text-sm font-medium md:flex">
              <NavigationLinks
                isSignedIn={isSignedIn}
                showAlertsBell={showAlertsBell}
                unreadNotifications={unreadNotifications}
              />
            </div>
          </div>
          {isMobileNavOpen ? (
            <div
              id="site-navigation"
              className="mt-3 grid gap-2 rounded-3xl border border-white/10 bg-white/5 p-2 md:hidden"
            >
              <NavigationLinks
                isSignedIn={isSignedIn}
                mobile
                onNavigate={() => setIsMobileNavOpen(false)}
                showAlertsBell={showAlertsBell}
                unreadNotifications={unreadNotifications}
              />
            </div>
          ) : null}
        </div>
      </nav>
      <main className="px-4 py-8 md:px-8">
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/eggs" replace />} />
            <Route path="/egg" element={<Navigate to="/eggs" replace />} />
            <Route path="/eggs" element={<EggOrderPage />} />
            <Route
              path="/eggs/:typeId"
              element={<TypeDetailPage variant="eggs" />}
            />
            <Route path="/livestock" element={<LivestockOrderPage />} />
            <Route
              path="/livestock/:typeId"
              element={<TypeDetailPage variant="livestock" />}
            />
            <Route path="/operations" element={<OperationsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppShell />
    </BrowserRouter>
  );
}
