import { useEffect, useState } from "react";
import { getIdTokenResult, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase.js";

export const useAuthRole = () => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser ?? null);
      if (!nextUser) {
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        const token = await getIdTokenResult(nextUser);
        let nextRole = token?.claims?.role ?? null;
        if (!nextRole) {
          const userSnap = await getDoc(doc(db, "users", nextUser.uid));
          nextRole = userSnap.exists() ? userSnap.data()?.role ?? null : null;
        }
        setRole(nextRole);
      } catch (err) {
        console.error("getIdTokenResult error", err);
        setRole(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return { user, role, loading, setRole };
};
