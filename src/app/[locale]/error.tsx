"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4 text-center">
      <div className="max-w-md">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-5 shadow-lg">!</div>
        <h1 className="text-xl font-bold text-white mb-2">Xəta baş verdi</h1>
        <p className="text-sm text-gray-400 mb-6">Gözlənilməz bir problem oldu. Yenidən cəhd edin və ya səhifəni yeniləyin.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg">
            Yenidən cəhd et
          </button>
          <a href="/" className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium px-5 py-2.5 rounded-lg">
            Ana səhifə
          </a>
        </div>
      </div>
    </div>
  );
}
