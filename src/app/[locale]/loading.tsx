export default function Loading() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="flex items-center gap-3 text-ink-3 text-sm">
        <span className="w-5 h-5 border-2 border-line-strong border-t-accent rounded-full animate-spin" />
        Yüklənir...
      </div>
    </div>
  );
}
