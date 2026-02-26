export function Field({ label, hint, error, required = false, htmlFor, children }) {
  return (
    <div className="space-y-2">
      {label ? (
        <label htmlFor={htmlFor} className="block text-sm font-semibold text-brandGreen">
          {label}
          {required ? <span className="ml-1 text-red-700">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-brandGreen/70">{hint}</p> : null}
    </div>
  );
}
