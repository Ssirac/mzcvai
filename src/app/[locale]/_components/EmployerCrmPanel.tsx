"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { jsonFetch } from "@/lib/clientApi";

type CrmStatus = "LEAD" | "CONTACTED" | "ACTIVE" | "PARTNER" | "DORMANT" | "BLOCKED";
interface FollowUp { id: string; contactedAt: string; outcome: string | null; nextStep: string | null; nextStepDueAt: string | null; actor: string | null }

type Lang = "az" | "de" | "en";
const STATUS_L: Record<Lang, Record<CrmStatus, string>> = {
  az: { LEAD: "Potensial", CONTACTED: "Əlaqə saxlanıb", ACTIVE: "Aktiv", PARTNER: "Partnyor", DORMANT: "Passiv", BLOCKED: "Bloklu" },
  de: { LEAD: "Lead", CONTACTED: "Kontaktiert", ACTIVE: "Aktiv", PARTNER: "Partner", DORMANT: "Ruhend", BLOCKED: "Gesperrt" },
  en: { LEAD: "Lead", CONTACTED: "Contacted", ACTIVE: "Active", PARTNER: "Partner", DORMANT: "Dormant", BLOCKED: "Blocked" },
};
const UI: Record<Lang, { notes: string; notesPh: string; followups: string; outcomePh: string; nextPh: string; add: string; save: string; none: string; next: string; save2: string }> = {
  az: { notes: "Qeydlər", notesPh: "Şirkət haqqında qeyd…", followups: "Follow-up jurnalı", outcomePh: "Nəticə (nə oldu)", nextPh: "Növbəti addım", add: "Əlavə et", save: "Yadda saxla", none: "Hələ qeyd yoxdur", next: "Növbəti", save2: "✓" },
  de: { notes: "Notizen", notesPh: "Notiz zum Unternehmen…", followups: "Follow-up-Verlauf", outcomePh: "Ergebnis", nextPh: "Nächster Schritt", add: "Hinzufügen", save: "Speichern", none: "Noch keine Einträge", next: "Nächster", save2: "✓" },
  en: { notes: "Notes", notesPh: "Note about the company…", followups: "Follow-up log", outcomePh: "Outcome", nextPh: "Next step", add: "Add", save: "Save", none: "No entries yet", next: "Next", save2: "✓" },
};
const STATUS_COLOR: Record<CrmStatus, string> = {
  LEAD: "bg-slate-500/15 text-slate-400", CONTACTED: "bg-sky-500/15 text-sky-400", ACTIVE: "bg-emerald-600/15 text-emerald-400",
  PARTNER: "bg-violet-500/15 text-violet-400", DORMANT: "bg-amber-500/15 text-amber-400", BLOCKED: "bg-rose-500/15 text-rose-400",
};

export default function EmployerCrmPanel({ employerId }: { employerId: string }) {
  const lang = ((usePathname()?.split("/")[1] as Lang) || "az");
  const L = UI[lang] ?? UI.az;
  const sl = (s: CrmStatus) => (STATUS_L[lang] ?? STATUS_L.az)[s];

  const [status, setStatus] = useState<CrmStatus>("LEAD");
  const [statuses, setStatuses] = useState<CrmStatus[]>([]);
  const [notes, setNotes] = useState("");
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [outcome, setOutcome] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await jsonFetch(`/api/employers/${employerId}/crm`);
    setStatus((data.crmStatus as CrmStatus) ?? "LEAD");
    setStatuses((data.statuses as CrmStatus[]) ?? []);
    setNotes((data.crmNotes as string) ?? "");
    setFollowUps((data.followUps as FollowUp[]) ?? []);
  }, [employerId]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: object) {
    setBusy(true);
    try { await jsonFetch(`/api/employers/${employerId}/crm`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    finally { setBusy(false); }
  }
  async function addFollowUp() {
    if (busy || (!outcome.trim() && !nextStep.trim())) return;
    setBusy(true);
    try {
      const { ok } = await jsonFetch(`/api/employers/${employerId}/crm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: outcome.trim() || null, nextStep: nextStep.trim() || null }),
      });
      if (ok) { setOutcome(""); setNextStep(""); await load(); }
    } finally { setBusy(false); }
  }

  return (
    <div className="grid md:grid-cols-2 gap-3 p-3 bg-card-2/40 rounded-xl">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <select value={status} disabled={busy}
            onChange={(e) => { const v = e.target.value as CrmStatus; setStatus(v); void patch({ crmStatus: v }); }}
            className={`text-xs rounded-lg px-2.5 py-1.5 border border-line-strong ${STATUS_COLOR[status]}`}>
            {statuses.map((s) => <option key={s} value={s}>{sl(s)}</option>)}
          </select>
        </div>
        <div className="text-[11px] text-ink-3">{L.notes}</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void patch({ crmNotes: notes })}
          rows={3} placeholder={L.notesPh}
          className="w-full bg-surface border border-line focus:border-emerald-600/50 focus:outline-none text-ink rounded-lg px-2.5 py-2 text-xs placeholder:text-ink-3 resize-y" />
      </div>

      <div className="space-y-2">
        <div className="text-[11px] text-ink-3">{L.followups}</div>
        <div className="flex flex-wrap gap-1.5">
          <input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={L.outcomePh}
            className="flex-1 min-w-0 bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-3" />
          <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder={L.nextPh}
            className="flex-1 min-w-0 bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-3" />
          <button onClick={addFollowUp} disabled={busy || (!outcome.trim() && !nextStep.trim())}
            className="text-xs text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-1.5 disabled:opacity-50">{L.add}</button>
        </div>
        <div className="space-y-1.5 max-h-36 overflow-y-auto">
          {followUps.length === 0 && <div className="text-xs text-ink-3">{L.none}</div>}
          {followUps.map((f) => (
            <div key={f.id} className="text-[11px] border-l-2 border-line pl-2">
              <div className="text-ink-2">{f.outcome}{f.nextStep && <span className="text-amber-400"> · {L.next}: {f.nextStep}</span>}</div>
              <div className="text-ink-3">{f.actor ?? "—"} · {new Date(f.contactedAt).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
