import { forwardRef, useState, type InputHTMLAttributes } from "react";

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.4 9.4 0 0 1 12 5c5 0 9 4.5 10 7-.5 1.2-1.5 2.7-2.9 4M6.6 6.6C4.4 8 2.9 9.9 2 12c1 2.5 5 7 10 7 1.2 0 2.4-.2 3.4-.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * Drop-in replacement for a password/PIN <input> — same props, same
 * value/onChange contract, just wrapped with a show/hide toggle. Used
 * for every password and PIN field across the app (login, register,
 * reset, security PIN, transaction PIN) so the toggle behaves and
 * looks identical everywhere rather than being reimplemented per form.
 *
 * forwardRef matters here specifically for Login.tsx/Register.tsx,
 * which use react-hook-form's {...register("password")} — that spreads
 * a `ref` onto the field to wire up validation/focus, and a plain
 * function component would silently drop it (React warns "function
 * components cannot be given refs") breaking form validation on that
 * field. Every other page uses plain value/onChange and ref is unused
 * there, so forwarding it is free — not a special case per call site.
 */
const PasswordField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);
    const { style, ...rest } = props;
    return (
      <div style={{ position: "relative", ...((style as object) ?? {}) }}>
        <input {...rest} ref={ref} type={visible ? "text" : "password"} style={{ width: "100%", paddingRight: 36 }} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide" : "Show"}
          tabIndex={-1}
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            padding: 4,
            cursor: "pointer",
            color: "var(--ink-soft, #666)",
            display: "flex",
          }}
        >
          <EyeIcon off={visible} />
        </button>
      </div>
    );
  }
);

export default PasswordField;
