"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="az">
      <body style={{ margin: 0, background: "#030712", color: "#e5e7eb", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 16 }}>
          <div style={{ maxWidth: 420 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Sistem xətası</h1>
            <p style={{ fontSize: 14, color: "#9ca3af", marginBottom: 24 }}>
              {error?.message ? "Gözlənilməz xəta baş verdi." : "Gözlənilməz xəta baş verdi."}
            </p>
            <button
              onClick={reset}
              style={{ background: "#2563eb", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 8, fontSize: 14, cursor: "pointer" }}
            >
              Yenidən cəhd et
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
