export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 text-center">
      <div className="max-w-md">
        <div className="text-6xl font-black bg-gradient-to-br from-emerald-400 to-teal-500 bg-clip-text text-transparent mb-2 tabular">404</div>
        <h1 className="text-xl font-bold text-ink mb-2">Səhifə tapılmadı</h1>
        <p className="text-sm text-ink-2 mb-6">Axtardığınız səhifə mövcud deyil və ya köçürülüb.</p>
        <a href="/" className="btn btn-primary inline-flex">
          İdarə panelinə qayıt
        </a>
      </div>
    </div>
  );
}
