"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 text-center">
      <div className="max-w-md">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-5 shadow-lg">!</div>
        <h1 className="text-xl font-bold text-ink mb-2">Xəta baş verdi</h1>
        <p className="text-sm text-ink-2 mb-6">Gözlənilməz bir problem oldu. Yenidən cəhd edin və ya səhifəni yeniləyin.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="btn btn-primary">
            Yenidən cəhd et
          </button>
          <a href="/" className="btn btn-ghost">
            Ana səhifə
          </a>
        </div>
      </div>
    </div>
  );
}
