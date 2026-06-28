export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4 text-center">
      <div className="max-w-md">
        <div className="text-6xl font-black bg-gradient-to-br from-emerald-400 to-teal-500 bg-clip-text text-transparent mb-2">404</div>
        <h1 className="text-xl font-bold text-white mb-2">Səhifə tapılmadı</h1>
        <p className="text-sm text-gray-400 mb-6">Axtardığınız səhifə mövcud deyil və ya köçürülüb.</p>
        <a href="/" className="inline-block bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg">
          İdarə panelinə qayıt
        </a>
      </div>
    </div>
  );
}
