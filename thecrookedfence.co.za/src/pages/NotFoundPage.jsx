import { Link, useLocation } from "react-router-dom";
import { useSeo } from "../lib/seo.js";

export default function NotFoundPage() {
  const location = useLocation();

  useSeo({
    title: "Page Not Found | The Crooked Fence",
    description:
      "This page does not exist. Go to the egg order form or livestock form.",
    path: location.pathname || "/",
    robots: "noindex,follow",
  });

  return (
    <div className="mx-auto max-w-3xl">
      <section className="rounded-2xl border border-brandGreen/15 bg-white/90 p-6 shadow-lg md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandGreen/65">
          Error 404
        </p>
        <h1 className="mt-2 text-3xl font-bold text-brandGreen">
          This page does not exist
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-brandGreen/90">
          The page you tried to open was not found:
        </p>
        <p className="mt-2">
          <span className="rounded border border-brandGreen/20 bg-brandBeige/45 px-2 py-1 text-sm font-semibold text-brandGreen">
            {location.pathname}
          </span>
        </p>
        <p className="mt-4 text-sm font-semibold text-brandGreen/90">
          You can go to one of these pages:
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to="/eggs"
            className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
          >
            Egg Form
          </Link>
          <Link
            to="/livestock"
            className="rounded-full border border-brandGreen/30 bg-white px-4 py-2 text-sm font-semibold text-brandGreen transition hover:bg-brandBeige"
          >
            Livestock Form
          </Link>
        </div>
      </section>
    </div>
  );
}
