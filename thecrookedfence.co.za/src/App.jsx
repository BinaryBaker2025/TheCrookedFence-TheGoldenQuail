import { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
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

function RouteLoadingFallback() {
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-brandGreen/15 bg-white/75 px-4 py-10 text-center text-sm font-semibold text-brandGreen/80 shadow-sm">
      Loading page...
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [authResolved, setAuthResolved] = useState(false);
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

  return (
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <div className="min-h-screen bg-brandCream text-brandGreen">
        <nav className="bg-brandGreen text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-8">
            <NavLink to="/" className="text-lg font-semibold tracking-tight">
              The Crooked Fence
            </NavLink>
            <div className="flex items-center gap-3 text-sm font-medium">
              <NavLink to="/eggs" className={navLinkClass}>
                Egg Order Form
              </NavLink>
              <NavLink to="/livestock" className={navLinkClass}>
                Livestock Form
              </NavLink>
              {showAlertsBell ? (
                <NavLink
                  to="/operations?panel=alerts"
                  className={navLinkClass}
                  aria-label="Operations alerts"
                  title="Operations alerts"
                >
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
                  <span className="sr-only">Operations alerts</span>
                </NavLink>
              ) : null}
              <NavLink to="/admin" className={navLinkClass}>
                {isSignedIn ? "Dashboard" : "Login"}
              </NavLink>
            </div>
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
    </BrowserRouter>
  );
}
