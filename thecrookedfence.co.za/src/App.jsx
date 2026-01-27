import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./lib/firebase.js";
import AdminPage from "./pages/AdminPage.jsx";
import EggOrderPage from "./pages/EggOrderPage.jsx";
import LivestockOrderPage from "./pages/LivestockOrderPage.jsx";
import TypeDetailPage from "./pages/TypeDetailPage.jsx";

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

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser ?? null);
    });
    return () => unsubscribe();
  }, []);

  return (
    <BrowserRouter>
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
              <NavLink to="/admin" className={navLinkClass}>
                {user ? "Dashboard" : "Login"}
              </NavLink>
            </div>
          </div>
        </nav>
        <main className="px-4 py-8 md:px-8">
          <Routes>
            <Route path="/" element={<Navigate to="/eggs" replace />} />
            <Route path="/egg" element={<Navigate to="/eggs" replace />} />
            <Route path="/eggs" element={<EggOrderPage />} />
            <Route path="/eggs/:typeId" element={<TypeDetailPage variant="eggs" />} />
            <Route path="/livestock" element={<LivestockOrderPage />} />
            <Route
              path="/livestock/:typeId"
              element={<TypeDetailPage variant="livestock" />}
            />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
