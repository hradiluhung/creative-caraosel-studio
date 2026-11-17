"use client";

/** Last resort: the root layout itself failed. Plain markup only, nothing else can be relied on here. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0 }}>
        <main style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
          <p role="alert">The app could not start. Your projects are stored on this device and are not affected.</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: "8px 14px", fontSize: 14 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
