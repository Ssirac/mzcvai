"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { jsonFetch } from "@/lib/clientApi";

type Stage = "NEW" | "PROFILE_READY" | "MATCHED" | "PRESENTED" | "INTERVIEW" | "VISA" | "PLACED" | "REJECTED" | "ARCHIVED";
type DocStatus = "MISSING" | "UPLOADED" | "VERIFIED";
interface PEvent { id: string; fromStage: Stage | null; toStage: Stage; actor: string | null; note: string | null; createdAt: string }
interface DocItem { type: string; status: DocStatus; note: string | null; updatedAt: string | null }

type Lang = "az" | "de" | "en";
const STAGE_L: Record<Lang, Record<Stage, string>> = {
  az: { NEW: "Yeni", PROFILE_READY: "Profil hazır", MATCHED: "Uyğunlaşdı", PRESENTED: "Təqdim edildi", INTERVIEW: "Müsahibə", VISA: "Viza", PLACED: "İşə düzəldi", REJECTED: "Rədd", ARCHIVED: "Arxiv" },
  de: { NEW: "Neu", PROFILE_READY: "Profil bereit", MATCHED: "Gematcht", PRESENTED: "Vorgestellt", INTERVIEW: "Gespräch", VISA: "Visum", PLACED: "Vermittelt", REJECTED: "Abgelehnt", ARCHIVED: "Archiviert" },
  en: { NEW: "New", PROFILE_READY: "Profile ready", MATCHED: "Matched", PRESENTED: "Presented", INTERVIEW: "Interview", VISA: "Visa", PLACED: "Placed", REJECTED: "Rejected", ARCHIVED: "Archived" },
};
const DOC_L: Record<Lang, Record<string, string>> = {
  az: { PASSPORT: "Pasport", DIPLOMA: "Diplom", CERTIFICATE: "Sertifikat", LANGUAGE_CERT: "Dil sertifikatı", CV: "CV", PHOTO: "Foto", VISA: "Viza", OTHER: "Digər" },
  de: { PASSPORT: "Reisepass", DIPLOMA: "Diplom", CERTIFICATE: "Zertifikat", LANGUAGE_CERT: "Sprachzertifikat", CV: "Lebenslauf", PHOTO: "Foto", VISA: "Visum", OTHER: "Sonstige" },
  en: { PASSPORT: "Passport", DIPLOMA: "Diploma", CERTIFICATE: "Certificate", LANGUAGE_CERT: "Language cert.", CV: "CV", PHOTO: "Photo", VISA: "Visa", OTHER: "Other" },
};
const STATUS_L: Record<Lang, Record<DocStatus, string>> = {
  az: { MISSING: "Yoxdur", UPLOADED: "Yükləndi", VERIFIED: "Təsdiqləndi" },
  de: { MISSING: "Fehlt", UPLOADED: "Hochgeladen", VERIFIED: "Geprüft" },
  en: { MISSING: "Missing", UPLOADED: "Uploaded", VERIFIED: "Verified" },
};
const UI: Record<Lang, { pipeline: string; docs: string; history: string; ready: string; noHistory: string }> = {
  az: { pipeline: "Placement mərhələsi", docs: "Sənəd yoxlaması", history: "Tarixçə", ready: "hazır", noHistory: "Hələ keçid yoxdur" },
  de: { pipeline: "Placement-Phase", docs: "Dokumenten-Checkliste", history: "Verlauf", ready: "bereit", noHistory: "Noch keine Änderung" },
  en: { pipeline: "Placement stage", docs: "Document checklist", history: "History", ready: "ready", noHistory: "No changes yet" },
};
const STAGE_COLOR: Record<Stage, string> = {
  NEW: "bg-slate-500/15 text-slate-400", PROFILE_READY: "bg-sky-500/15 text-sky-400", MATCHED: "bg-blue-500/15 text-blue-400",
  PRESENTED: "bg-indigo-500/15 text-indigo-400", INTERVIEW: "bg-amber-500/15 text-amber-400", VISA: "bg-violet-500/15 text-violet-400",
  PLACED: "bg-emerald-600/15 text-emerald-400", REJECTED: "bg-rose-500/15 text-rose-400", ARCHIVED: "bg-card-2 text-ink-3",
};
const DOC_STATUS_COLOR: Record<DocStatus, string> = {
  MISSING: "bg-card-2 text-ink-3 border-line", UPLOADED: "bg-sky-500/15 text-sky-400 border-sky-500/30", VERIFIED: "bg-emerald-600/15 text-emerald-400 border-emerald-600/40",
};

export default function PipelineDocsPanel({ candidateId }: { candidateId: string }) {
  const pathname = usePathname();
  const lang = ((pathname?.split("/")[1] as Lang) || "az");
  const L = UI[lang] ?? UI.az;

  const [stage, setStage] = useState<Stage | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [events, setEvents] = useState<PEvent[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, d] = await Promise.all([
      jsonFetch(`/api/candidates/${candidateId}/pipeline`),
      jsonFetch(`/api/candidates/${candidateId}/documents`),
    ]);
    setStage((p.data.stage as Stage) ?? null);
    setStages((p.data.stages as Stage[]) ?? []);
    setEvents((p.data.events as PEvent[]) ?? []);
    setDocs((d.data.items as DocItem[]) ?? []);
    setPct(Number(d.data.completionPct ?? 0));
  }, [candidateId]);
  useEffect(() => { void load(); }, [load]);

  async function changeStage(next: Stage) {
    if (busy || next === stage) return;
    setBusy(true);
    try {
      const { ok } = await jsonFetch(`/api/candidates/${candidateId}/pipeline`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: next }),
      });
      if (ok) await load();
    } finally { setBusy(false); }
  }
  async function setDoc(type: string, status: DocStatus) {
    setBusy(true);
    try {
      const { ok } = await jsonFetch(`/api/candidates/${candidateId}/documents`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, status }),
      });
      if (ok) await load();
    } finally { setBusy(false); }
  }
  const sl = (s: Stage) => (STAGE_L[lang] ?? STAGE_L.az)[s];

  return (
    <div className="grid sm:grid-cols-2 gap-3 mb-5">
      {/* Pipeline stage + history */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">📌 {L.pipeline}</span>
          <select value={stage ?? "NEW"} disabled={busy} onChange={(e) => changeStage(e.target.value as Stage)}
            className="bg-card-2 text-ink text-xs rounded-lg px-2.5 py-1.5 border border-line-strong disabled:opacity-50">
            {stages.map((s) => <option key={s} value={s}>{sl(s)}</option>)}
          </select>
        </div>
        <div className="text-[11px] text-ink-3">{L.history}</div>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {events.length === 0 && <div className="text-xs text-ink-3">{L.noHistory}</div>}
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-1.5 text-[11px]">
              {e.fromStage && <span className={`px-1.5 py-0.5 rounded ${STAGE_COLOR[e.fromStage]}`}>{sl(e.fromStage)}</span>}
              <span className="text-ink-3">→</span>
              <span className={`px-1.5 py-0.5 rounded ${STAGE_COLOR[e.toStage]}`}>{sl(e.toStage)}</span>
              <span className="text-ink-3 ml-auto">{e.actor ?? "—"} · {new Date(e.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Document checklist */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">📎 {L.docs}</span>
          <span className="text-xs font-semibold text-emerald-400 tabular-nums">{pct}% {L.ready}</span>
        </div>
        <div className="h-1.5 rounded-full bg-card-2 overflow-hidden">
          <div className={`h-full rounded-full ${pct >= 75 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${pct}%`, transition: "width 400ms ease" }} />
        </div>
        <div className="space-y-1.5">
          {docs.map((d) => (
            <div key={d.type} className="flex items-center gap-2 text-xs">
              <span className="text-ink-2 flex-1 truncate">{(DOC_L[lang] ?? DOC_L.az)[d.type] ?? d.type}</span>
              <select value={d.status} disabled={busy} onChange={(e) => setDoc(d.type, e.target.value as DocStatus)}
                className={`text-[11px] rounded-md px-2 py-1 border disabled:opacity-50 ${DOC_STATUS_COLOR[d.status]}`}>
                {(["MISSING", "UPLOADED", "VERIFIED"] as DocStatus[]).map((s) => (
                  <option key={s} value={s}>{(STATUS_L[lang] ?? STATUS_L.az)[s]}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
