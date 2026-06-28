export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex items-center gap-3 text-gray-500 text-sm">
        <span className="w-5 h-5 border-2 border-gray-700 border-t-emerald-400 rounded-full animate-spin" />
        Yüklənir...
      </div>
    </div>
  );
}
