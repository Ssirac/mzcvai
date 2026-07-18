"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BERUF_LIST, REGIONS_DE, GERMAN_LEVELS } from "@/lib/berufMap";
import TopNav from "../_components/TopNav";
import PipelineDocsPanel from "../_components/PipelineDocsPanel";
import { useToast } from "../_components/Toast";
import { jsonFetch } from "@/lib/clientApi";

interface ExperienceRow { company: string; title: string; from: string; to: string; description: string }
interface EducationRow { school: string; degree: string; field: string; from: string; to: string }

interface Candidate {
  id: string;
  name: string;
  beruf: string;
  desiredPosition: string | null;
  currentCity: string | null;
  nationality: string | null;
  regionPrefs: string[];
  languages: string[];
  needsSponsorship: boolean;
  visaStatus: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: "ACTIVE" | "PENDING" | "PLACED" | "ARCHIVED";
  // Extra fields the list API also returns (used for flags + completeness)
  photoUrl?: string | null;
  hasCv?: boolean;
  skills?: string[];
  experience?: unknown[];
  germanLevel?: string | null;
  yearsExperience?: number | null;
  createdAt?: string;
  _count: { matches: number };
}

// Profile completeness — the fields that make a candidate ready to place and
// produce a strong application letter. Each present field counts equally.
function profileCompleteness(c: Candidate, t: (k: string) => string): { pct: number; missing: string[] } {
  const checks: { label: string; ok: boolean }[] = [
    { label: t("compEmail"), ok: !!c.email },
    { label: t("compPhone"), ok: !!c.phone },
    { label: t("compCity"), ok: !!c.currentCity },
    { label: t("compCv"), ok: !!c.hasCv },
    { label: t("compLang"), ok: (c.languages?.length ?? 0) > 0 },
    { label: t("compSkills"), ok: (c.skills?.length ?? 0) > 0 },
    { label: t("compExp"), ok: (c.experience?.length ?? 0) > 0 },
    { label: t("compGerman"), ok: !!c.germanLevel },
  ];
  const done = checks.filter((x) => x.ok).length;
  return { pct: Math.round((done / checks.length) * 100), missing: checks.filter((x) => !x.ok).map((x) => x.label) };
}


// Append the #mzfill hash so the MZ Autofill extension fills the form for
// exactly this candidate (same mechanism as the robot queue "open & confirm").
const withFillHash = (url: string, candidateId: string): string => {
  try { const u = new URL(url); u.hash = `mzfill=${candidateId}`; return u.toString(); } catch { return url; }
};

interface Match {
  id: string;
  fitScore: number;
  fitBreakdown: Record<string, number> | null;
  status: string;
  vacancy: { title: string; beruf: string; region: string; applyChannel: string; applyValue: string | null; url?: string | null; source?: string };
  employer: {
    name: string; city: string | null; region: string | null; stars: number | null;
    score: number; sponsorshipSignal: string; scoreBreakdown: Record<string, unknown> | null;
    genericEmail: string | null; emailSource: string | null; emailStatus: string | null;
    applyFormUrl: string | null; website: string | null; phone: string | null;
    optedOut: boolean;
  };
  outreach: { id: string; status: string; sentAt?: string | null }[];
  employerLastSentAt: string | null;
  // Server-side occupation audit: false = vacancy title fits none of the
  // candidate's CV profiles (desired position, beruf, experience titles).
  relevant?: boolean;
}

interface OutreachItem {
  id: string;
  subject: string | null;
  draftBody: string;
  toAddress: string | null;
  channel: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  openCount: number;
  repliedAt: string | null;
  replyText: string | null;
  replyFrom: string | null;
  replySubject: string | null;
  bouncedAt: string | null;
  followUpCount: number;
  lastFollowUpAt: string | null;
  matchId: string;
  match: {
    status: string;
    employer: { name: string; city: string | null; region: string | null; sponsorshipSignal: string };
    vacancy: { title: string; url: string | null; source: string };
  };
  // Server-side occupation audit (see Match.relevant).
  relevant?: boolean;
}

// Normalize a (German) phone number to international digits for wa.me / tel.
function phoneDigits(raw: string): string {
  let p = raw.replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  else if (p.startsWith("00")) p = p.slice(2);
  else if (p.startsWith("0")) p = "49" + p.slice(1);
  return p;
}

// Placement pipeline stages the user can advance an application through after
// it's been sent. Order matters (left→right = progress).
const PIPELINE_STAGES: { key: string; label: string; active: string }[] = [
  { key: "REPLIED", label: "Cavab", active: "bg-green-500/20 text-green-300 border-green-500/40" },
  { key: "INTERVIEW", label: "Müsahibə", active: "bg-violet-500/20 text-violet-300 border-violet-500/40" },
  { key: "PLACED", label: "İşə düzəldi", active: "bg-emerald-500/25 text-emerald-200 border-emerald-500/50" },
  { key: "REJECTED", label: "İmtina", active: "bg-red-500/15 text-red-300 border-red-500/40" },
];

const OUTREACH_COLOR: Record<string, string> = {
  DRAFT: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  APPROVED: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  SENT: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  OPENED: "bg-violet-500/15 text-violet-300 border border-violet-500/30",
  REPLIED: "bg-green-500/20 text-green-300 border border-green-500/30",
  BOUNCED: "bg-red-500/15 text-red-300 border border-red-500/30",
};

const OUTREACH_DOT: Record<string, string> = {
  DRAFT: "bg-amber-400",
  APPROVED: "bg-blue-400",
  SENT: "bg-emerald-400",
  OPENED: "bg-violet-400",
  REPLIED: "bg-green-400",
  BOUNCED: "bg-red-400",
};

// Gradient avatar palettes keyed off the candidate name (deterministic)
const AVATAR_GRADIENTS = [
  "from-emerald-500 to-teal-600",
  "from-blue-500 to-indigo-600",
  "from-violet-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-blue-600",
];
function avatarGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Count a number up from 0 to its target with an ease-out — a small "instrument
// readout" touch when a candidate's stats appear. Respects reduced-motion.
function useCountUp(target: number, duration = 650): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function CountUp({ value, className }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={className}>{v}</span>;
}

// Resize an uploaded image to a small square-ish JPEG data URL so the photo can
// be stored inline (in photoUrl) and shipped in the list without bloating rows.
function resizeImageToDataUrl(file: File, max = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const SIGNAL_COLOR: Record<string, string> = {
  YES: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  LIKELY: "bg-blue-500/20 text-blue-300 border border-blue-500/40",
  UNKNOWN: "bg-line-strong/30 text-ink-2 border border-line-strong/40",
  NO: "bg-red-500/20 text-red-400 border border-red-500/40",
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-blue-500/20 text-blue-300 border border-blue-500/40",
  PENDING: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40",
  PLACED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  ARCHIVED: "bg-line-strong/30 text-ink-2 border border-line-strong/40",
};

const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, PENDING: 1, PLACED: 2, ARCHIVED: 3 };
const STATUS_OPTIONS = ["ACTIVE", "PENDING", "PLACED", "ARCHIVED"] as const;

// "Why bad" reason for match feedback (structured, feeds scoring). Trilingual.
const REJECT_REASONS = ["SKILL_MISMATCH", "SALARY", "LOCATION", "VISA", "LANGUAGE", "OVERQUALIFIED", "OTHER"] as const;
const REASON_LABELS: Record<string, Record<string, string>> = {
  az: { SKILL_MISMATCH: "İxtisas uyğun deyil", SALARY: "Maaş", LOCATION: "Məkan", VISA: "Viza", LANGUAGE: "Dil", OVERQUALIFIED: "Həddən artıq ixtisaslı", OTHER: "Digər" },
  de: { SKILL_MISMATCH: "Qualifikation passt nicht", SALARY: "Gehalt", LOCATION: "Standort", VISA: "Visum", LANGUAGE: "Sprache", OVERQUALIFIED: "Überqualifiziert", OTHER: "Sonstige" },
  en: { SKILL_MISMATCH: "Skill mismatch", SALARY: "Salary", LOCATION: "Location", VISA: "Visa", LANGUAGE: "Language", OVERQUALIFIED: "Overqualified", OTHER: "Other" },
};

const SCORE_COLOR = (s: number) =>
  s >= 80 ? "text-emerald-400" : s >= 60 ? "text-blue-400" : s >= 40 ? "text-yellow-400" : "text-ink-2";

const BLANK_FORM = {
  name: "", email: "", phone: "", beruf: "Housekeeping",
  regionPrefs: [] as string[], languages: [] as string[],
  needsSponsorship: true, visaStatus: "", notes: "",
  germanLevel: "A1",
  dateOfBirth: "", gender: "", nationality: "", maritalStatus: "",
  currentCity: "", currentCountry: "", address: "", photoUrl: "",
  desiredPosition: "", yearsExperience: "", salaryExpectation: "",
  availableFrom: "", willingToRelocate: true, drivingLicense: "",
  skills: "", certificates: "",
  status: "ACTIVE",
  experience: [] as ExperienceRow[],
  education: [] as EducationRow[],
};

const inputCls = "w-full bg-card-2 text-ink rounded px-3 py-2 text-sm mt-1 border border-transparent focus:border-blue-500 focus:outline-none";
const labelCls = "text-xs text-ink-3";
const cardCls = "bg-card border border-line rounded-2xl p-4 space-y-3";
const sectionTitle = "text-sm font-semibold text-ink-2 uppercase tracking-wide";

export default function CandidatesPage() {
  const { locale } = useParams() as { locale: string };
  const t = useTranslations("candidates");
  const toast = useToast();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [outreachLoading, setOutreachLoading] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [testLetterLoading, setTestLetterLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [parsingCV, setParsingCV] = useState(false);
  const [cvText, setCvText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  // Uploaded CV kept to attach on save; existingCvName = CV already on the candidate
  const [cvFile, setCvFile] = useState<{ base64: string; name: string; mime: string } | null>(null);
  const [existingCvName, setExistingCvName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"matches" | "comms" | "replies">("matches");
  const [comms, setComms] = useState<OutreachItem[]>([]);
  const [commsLoading, setCommsLoading] = useState(false);
  const [expandedComm, setExpandedComm] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [enrichingMatches, setEnrichingMatches] = useState(false);
  const [fetchingJobs, setFetchingJobs] = useState(false);
  // Per-candidate unread-reply counts → green dot in the candidate list.
  const [unreadByCandidate, setUnreadByCandidate] = useState<Record<string, number>>({});
  const [listSort, setListSort] = useState<"status" | "matches" | "unread" | "recent">("status");
  const [matchFilters, setMatchFilters] = useState<{ sponsor: boolean; applyType: "all" | "email" | "form" }>({ sponsor: false, applyType: "all" });
  const [matchSort, setMatchSort] = useState<"email" | "fit">("email");
  const [expandedFit, setExpandedFit] = useState<string | null>(null);

  async function loadUnread() {
    try {
      const res = await fetch("/api/inbox/unread");
      const data = await res.json();
      setUnreadByCandidate(data.byCandidate ?? {});
    } catch { /* non-fatal */ }
  }

  // A match counts as DISPATCHED once any outreach actually went out (sentAt
  // set). Status alone lies after progression: SENT flips to OPENED/REPLIED/
  // BOUNCED, which used to resurface already-mailed jobs in "Uyğun işlər".
  // Stuck DRAFTs (failed sends, sentAt null) stay visible so they can be retried.
  const everDispatched = (m: Match) =>
    m.outreach.some((o) => !!o.sentAt || o.status === "SENT" || o.status === "OPENED" || o.status === "REPLIED" || o.status === "BOUNCED");

  // Pending = not yet contacted. Surface employers that already have a found
  // email first (those can be mailed immediately), keeping score order within each group.
  const pendingMatches = matches
    // Hide a job only once it's actually SENT — a stuck DRAFT (failed send) must
    // stay in the list so it can be retried, not silently disappear.
    .filter((m) => !everDispatched(m))
    .filter((m) => !matchFilters.sponsor || m.employer.sponsorshipSignal === "YES")
    // Apply type: "email" = employer has a generic address (we mail it);
    // "form" = no address, apply via the job's own form/link (human + extension).
    .filter((m) =>
      matchFilters.applyType === "all" ? true
        : matchFilters.applyType === "email" ? !!m.employer.genericEmail
          : !m.employer.genericEmail)
    .sort((a, b) =>
      matchSort === "fit"
        ? (b.fitScore ?? 0) - (a.fitScore ?? 0)
        : (b.employer.genericEmail ? 1 : 0) - (a.employer.genericEmail ? 1 : 0)
    );
  // How many pending matches exist ignoring the active filters (to tell "all
  // sent" apart from "filters hid everything").
  const pendingUnfiltered = matches.filter((m) => !everDispatched(m)).length;
  const matchFilterActive = matchFilters.sponsor || matchFilters.applyType !== "all";
  const emailCount = matches.filter((m) => !everDispatched(m) && !!m.employer.genericEmail).length;
  const formCount = matches.filter((m) => !everDispatched(m) && !m.employer.genericEmail).length;

  function toggleMatchSelect(id: string) {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedMatchIds((prev) =>
      prev.size === pendingMatches.length ? new Set() : new Set(pendingMatches.map((m) => m.id))
    );
  }

  // Quick-select the first N pending jobs (email-having employers come first)
  function selectFirstN(n: number) {
    setSelectedMatchIds(new Set(pendingMatches.slice(0, n).map((m) => m.id)));
  }

  async function loadCandidates() {
    const { data } = await jsonFetch("/api/candidates");
    setCandidates((data.candidates as Candidate[]) ?? []);
  }

  // Candidates we've already auto-run email discovery for this session, so
  // revisiting a candidate doesn't burn API credits re-searching every time.
  const autoEnrichedRef = useRef<Set<string>>(new Set());

  async function loadMatches(id: string) {
    setMatchesLoading(true);
    const res = await fetch(`/api/candidates/${id}/matches`);
    const data = await res.json();
    const list: Match[] = data.matches ?? [];
    setMatches(list);
    setMatchesLoading(false);

    // Automatically find emails the first time we see this candidate, for any
    // matched employer that doesn't have one yet. Runs in the background; the
    // list refreshes itself when done (findEmailsForMatches calls loadMatches).
    const missing = list.some((m) => !m.employer.genericEmail);
    if (missing && !autoEnrichedRef.current.has(id)) {
      autoEnrichedRef.current.add(id);
      findEmailsForMatches(id, { silent: true });
    }
  }

  async function loadComms(id: string) {
    setCommsLoading(true);
    const res = await fetch(`/api/candidates/${id}/outreach`);
    const data = await res.json();
    setComms(data.outreach ?? []);
    setCommsLoading(false);
  }

  async function setMatchStage(matchId: string, status: string) {
    // Optimistic update so the pipeline feels instant.
    setComms((prev) => prev.map((c) => (c.matchId === matchId ? { ...c, match: { ...c.match, status } } : c)));
    const res = await fetch(`/api/matches/${matchId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok && selectedId) loadComms(selectedId);
  }

  useEffect(() => { loadCandidates(); loadUnread(); }, []);

  function selectCandidate(id: string) {
    setSelectedId(id);
    setShowForm(false);
    setActiveTab("matches");
    setExpandedComm(null);
    setMobileView("detail");
    loadMatches(id);
    loadComms(id);
    // Opening a candidate marks their replies seen, clearing their dot + the
    // global badge contribution.
    if (unreadByCandidate[id]) {
      fetch("/api/inbox/read", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: id }),
      }).then(() => {
        setUnreadByCandidate((prev) => { const n = { ...prev }; delete n[id]; return n; });
        window.dispatchEvent(new Event("inbox-read"));
      }).catch(() => {});
    }
  }

  function startNewCandidate() {
    setEditingId(null);
    setForm(BLANK_FORM);
    setSaveMsg(null);
    setCvFile(null);
    setExistingCvName(null);
    setSelectedId(null);
    setShowForm(true);
    setMobileView("detail");
  }

  // Delete dead/expired listings across ALL candidates (visits each URL). Slow, so
  // it processes a batch per click and reports the count; click again to continue.
  async function sweepDeadListings() {
    if (sweeping) return;
    setSweeping(true);
    try {
      const { ok, data } = await jsonFetch("/api/vacancies/sweep-dead", { method: "POST" });
      if (!ok) { toast(String(data.error ?? t("sweepFailed")), "error"); return; }
      // "removed" = hard-deleted + soft-expired (applied jobs kept for history but
      // hidden from matches); both mean the dead listing no longer shows.
      const removed = Number(data.deleted ?? 0) + Number(data.expired ?? 0);
      const checked = Number(data.checked ?? 0);
      toast(t("sweepDone", { deleted: removed, checked }), removed > 0 ? "success" : "info");
      if (removed > 0 && selectedId) await loadMatches(selectedId);
    } finally {
      setSweeping(false);
    }
  }

  // Load an existing candidate's full record into the editable form
  async function startEdit(id: string) {
    setSaveMsg(null);
    const res = await fetch(`/api/candidates/${id}`);
    const data = await res.json();
    const c = data.candidate;
    if (!c) return;
    const langs: string[] = c.languages ?? [];
    const germanEntry = langs.find((l) => l.toLowerCase().startsWith("de-"));
    setForm({
      name: c.name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      beruf: c.beruf ?? "",
      regionPrefs: c.regionPrefs ?? [],
      languages: langs.filter((l) => !l.toLowerCase().startsWith("de-")),
      needsSponsorship: c.needsSponsorship ?? true,
      visaStatus: c.visaStatus ?? "",
      notes: c.notes ?? "",
      germanLevel: germanEntry ? germanEntry.split("-")[1] : "A1",
      dateOfBirth: c.dateOfBirth ? String(c.dateOfBirth).slice(0, 10) : "",
      gender: c.gender ?? "",
      nationality: c.nationality ?? "",
      maritalStatus: c.maritalStatus ?? "",
      currentCity: c.currentCity ?? "",
      currentCountry: c.currentCountry ?? "",
      address: c.address ?? "",
      photoUrl: c.photoUrl ?? "",
      desiredPosition: c.desiredPosition ?? "",
      yearsExperience: c.yearsExperience != null ? String(c.yearsExperience) : "",
      salaryExpectation: c.salaryExpectation ?? "",
      availableFrom: c.availableFrom ? String(c.availableFrom).slice(0, 10) : "",
      willingToRelocate: c.willingToRelocate ?? true,
      drivingLicense: c.drivingLicense ?? "",
      skills: Array.isArray(c.skills) ? c.skills.join(", ") : "",
      certificates: Array.isArray(c.certificates) ? c.certificates.join(", ") : "",
      status: c.status ?? "ACTIVE",
      experience: Array.isArray(c.experience) ? c.experience : [],
      education: Array.isArray(c.education) ? c.education : [],
    });
    setCvFile(null);
    setExistingCvName(c.cvFileName ?? null);
    setEditingId(id);
    setSelectedId(id);
    setShowForm(true);
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleArr(key: "regionPrefs" | "languages", v: string) {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v],
    }));
  }

  function addExp() { set("experience", [...form.experience, { company: "", title: "", from: "", to: "", description: "" }]); }
  function updExp(i: number, k: keyof ExperienceRow, v: string) {
    set("experience", form.experience.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  }
  function delExp(i: number) { set("experience", form.experience.filter((_, idx) => idx !== i)); }

  function addEdu() { set("education", [...form.education, { school: "", degree: "", field: "", from: "", to: "" }]); }
  function updEdu(i: number, k: keyof EducationRow, v: string) {
    set("education", form.education.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  }
  function delEdu(i: number) { set("education", form.education.filter((_, idx) => idx !== i)); }

  // Map Claude's extracted CV data onto the form (shared by PDF + paste)
  function applyCvData(d: Record<string, unknown>) {
    const langCodes = ["az", "en", "ru", "tr", "ar", "uk", "fa"];
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    setForm((f) => ({
      ...f,
      name: s(d.name) || f.name,
      email: s(d.email) || f.email,
      phone: s(d.phone) || f.phone,
      beruf: s(d.beruf) || f.beruf,
      dateOfBirth: s(d.dateOfBirth) || f.dateOfBirth,
      gender: ["male", "female", "other"].includes(s(d.gender)) ? s(d.gender) : f.gender,
      nationality: s(d.nationality) || f.nationality,
      maritalStatus: ["single", "married"].includes(s(d.maritalStatus)) ? s(d.maritalStatus) : f.maritalStatus,
      currentCity: s(d.currentCity) || f.currentCity,
      currentCountry: s(d.currentCountry) || f.currentCountry,
      address: s(d.address) || f.address,
      desiredPosition: s(d.desiredPosition) || f.desiredPosition,
      yearsExperience: d.yearsExperience ? String(d.yearsExperience) : f.yearsExperience,
      germanLevel: s(d.germanLevel) || f.germanLevel,
      languages: Array.isArray(d.otherLanguages) ? (d.otherLanguages as string[]).filter((l) => langCodes.includes(l)) : f.languages,
      visaStatus: s(d.visaStatus) || f.visaStatus,
      salaryExpectation: s(d.salaryExpectation) || f.salaryExpectation,
      drivingLicense: s(d.drivingLicense) || f.drivingLicense,
      skills: Array.isArray(d.skills) ? (d.skills as string[]).join(", ") : f.skills,
      certificates: Array.isArray(d.certificates) ? (d.certificates as string[]).join(", ") : f.certificates,
      experience: Array.isArray(d.experience) && d.experience.length ? (d.experience as ExperienceRow[]) : f.experience,
      education: Array.isArray(d.education) && d.education.length ? (d.education as EducationRow[]) : f.education,
      notes: s(d.notes) || f.notes,
    }));
  }

  function readFileBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Upload a CV PDF → keep the file for attachment + Claude extracts fields
  async function parseCV(file: File) {
    setParsingCV(true);
    setSaveMsg(null);
    try {
      // Keep the original file so it gets attached to outreach on save
      try {
        const base64 = await readFileBase64(file);
        setCvFile({ base64, name: file.name, mime: file.type || "application/pdf" });
        setExistingCvName(file.name);
      } catch { /* keep going even if read fails */ }

      const fd = new FormData();
      fd.append("file", file);
      const { ok, data } = await jsonFetch("/api/candidates/parse-cv", { method: "POST", body: fd });
      if (!ok || !data.ok) {
        setSaveMsg(`${t("errorPrefix")} ${t("parseError")} — ${data.error ?? ""}`);
        return;
      }
      applyCvData((data.data as Record<string, unknown>) ?? {});
      setSaveMsg(`✓ ${t("parsedOk")}`);
    } catch (err) {
      setSaveMsg(`${t("errorPrefix")} ${(err as Error).message}`);
    } finally {
      setParsingCV(false);
    }
  }

  // Attach a CV without parsing (just keep the file for outreach)
  async function attachCvOnly(file: File) {
    try {
      const base64 = await readFileBase64(file);
      setCvFile({ base64, name: file.name, mime: file.type || "application/pdf" });
      setExistingCvName(file.name);
      setSaveMsg(`✓ ${t("cvAttached")}: ${file.name}`);
    } catch (err) {
      setSaveMsg(`${t("errorPrefix")} ${(err as Error).message}`);
    }
  }

  // Paste CV text → Claude extracts fields → auto-fill the form
  async function parseText() {
    if (cvText.trim().length < 20) return;
    setParsingCV(true);
    setSaveMsg(null);
    try {
      const { ok, data } = await jsonFetch("/api/candidates/parse-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cvText }),
      });
      if (!ok || !data.ok) {
        setSaveMsg(`${t("errorPrefix")} ${t("parseError")} — ${data.error ?? ""}`);
        return;
      }
      applyCvData((data.data as Record<string, unknown>) ?? {});
      setCvText("");
      setShowPaste(false);
      setSaveMsg(`✓ ${t("parsedOk")}`);
    } catch (err) {
      setSaveMsg(`${t("errorPrefix")} ${(err as Error).message}`);
    } finally {
      setParsingCV(false);
    }
  }

  async function saveCandidate() {
    setSaving(true);
    setSaveMsg(null);
    const combined = form.languages.concat(form.germanLevel ? [`de-${form.germanLevel}`] : []);
    const langs = combined.filter((v, i) => combined.indexOf(v) === i);
    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...(editingId ? { id: editingId } : {}),
          languages: langs,
          experience: form.experience.filter((e) => e.company || e.title),
          education: form.education.filter((e) => e.school || e.degree),
          ...(cvFile ? { cvFileBase64: cvFile.base64, cvFileName: cvFile.name, cvMimeType: cvFile.mime } : {}),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t("candidateAdded", { name: data.candidate.name, count: data.matchesFound }), "success");
        setForm(BLANK_FORM);
        setCvFile(null);
        setExistingCvName(null);
        setShowForm(false);
        setEditingId(null);
        await loadCandidates();
        selectCandidate(data.candidate.id);
      } else {
        setSaveMsg(`${t("errorPrefix")} ${data.error}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: string) {
    const { ok } = await jsonFetch(`/api/candidates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (ok) toast(t("statusUpdated"), "success");
    await loadCandidates();
  }

  async function deleteCandidate(id: string) {
    if (!confirm(t("deleteConfirm"))) return;
    const { ok } = await jsonFetch(`/api/candidates/${id}`, { method: "DELETE" });
    if (ok) toast(t("candidateDeleted"), "success");
    setSelectedId(null);
    setEditingId(null);
    setShowForm(false);
    setMatches([]);
    await loadCandidates();
  }

  async function createOutreachDraft(matchId: string) {
    setOutreachLoading(matchId);
    try {
      // Step 1: create draft (server auto-finds the employer email if missing)
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error ?? t("parseError"), "error");
        return;
      }

      const outreachId: string = data.outreachId;
      // If anything below fails, remove the just-created draft so it doesn't linger
      const discardDraft = () =>
        fetch(`/api/outreach/${outreachId}`, { method: "DELETE" }).catch(() => {});

      // Step 2: approve
      const approveRes = await fetch(`/api/outreach/${outreachId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", userId: "admin" }),
      });
      if (!approveRes.ok) {
        await discardDraft();
        toast(t("confirmError"), "error");
        return;
      }

      // Step 3: send
      const sendRes = await fetch(`/api/outreach/${outreachId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const sendData = await sendRes.json();
      if (sendData.ok) {
        toast(t("mailSent"), "success");
      } else {
        // Send failed → drop the draft so the job stays in the list to retry
        await discardDraft();
        if ((sendData.error ?? "").includes("No email address")) {
          toast(t("noEmailFormOnly"), "error");
        } else {
          toast(sendData.error ?? t("sendError"), "error");
        }
      }

      if (selectedId) { loadMatches(selectedId); loadComms(selectedId); }
    } finally {
      setOutreachLoading(null);
    }
  }

  function fmtDate(s: string | null) {
    if (!s) return "—";
    const d = new Date(s);
    return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  }

  // Send a CV-tailored motivation letter as a TEST to chosen address(es)
  async function sendTestLetter() {
    if (!selectedId) return;
    const input = prompt(t("testLetterPrompt"), "");
    if (!input || !input.trim()) return;
    const recipients = input.split(",").map((x) => x.trim()).filter(Boolean);
    setTestLetterLoading(true);
    try {
      const { ok, data } = await jsonFetch(`/api/candidates/${selectedId}/test-letter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients }),
      });
      if (ok && data.ok) toast(`${t("testLetterSent")}: ${recipients.join(", ")}`, "success");
      else toast(String(data.error ?? "error"), "error");
    } finally {
      setTestLetterLoading(false);
    }
  }

  // Bulk: send an application to every matching employer (respects guards)
  async function resetOutreach() {
    if (!selectedId) return;
    if (!confirm(t("resetConfirm"))) return;
    try {
      const { ok, data } = await jsonFetch(`/api/candidates/${selectedId}/reset-outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (ok && data.ok) {
        toast(t("resetDone", { count: Number(data.deleted ?? 0) }), "success");
        setSelectedMatchIds(new Set());
        loadMatches(selectedId);
        loadComms(selectedId);
        setActiveTab("matches");
      } else {
        toast(String(data.error ?? "error"), "error");
      }
    } catch {
      toast("error", "error");
    }
  }

  // "Elanları çək": pull fresh listings for this candidate's occupation from
  // every source NOW (instead of waiting for the 4-hourly refresh) + re-match.
  async function fetchJobsNow() {
    if (!selectedId || fetchingJobs) return;
    setFetchingJobs(true);
    try {
      const { ok, data } = await jsonFetch(`/api/candidates/${selectedId}/fetch-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (ok && data.ok) {
        toast(t("fetchJobsDone", { jobs: Number(data.vacanciesNew ?? 0), matches: Number(data.matched ?? 0) }), "success");
        await loadMatches(selectedId);
      } else {
        toast(String(data.error ?? "error"), "error");
      }
    } catch {
      toast("error", "error");
    } finally {
      setFetchingJobs(false);
    }
  }

  async function findEmailsForMatches(candidateId?: string, opts?: { silent?: boolean }) {
    const id = candidateId ?? selectedId;
    if (!id) return;
    const silent = opts?.silent ?? false;
    setEnrichingMatches(true);
    try {
      const { ok, data } = await jsonFetch(`/api/candidates/${id}/enrich-matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (ok && data.ok) {
        const found = Number(data.found ?? 0);
        // Stay quiet on the automatic pass unless it actually found something.
        if (!silent || found > 0) {
          toast(
            t("emailsFound", { found, total: found + Number(data.alreadyHad ?? 0) }),
            "success"
          );
        }
        // Only refresh if this candidate is still the one on screen.
        if (id === selectedId) loadMatches(id);
      } else if (!silent) {
        toast(String(data.error ?? "error"), "error");
      }
    } finally {
      setEnrichingMatches(false);
    }
  }

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // Bulk reject: mark selected matches BAD so they leave the queue and are never
  // (re)sent. An optional reason (why) is stored on each for scoring feedback.
  async function bulkRejectMatches() {
    if (!selectedId || selectedMatchIds.size === 0) return;
    const ids = Array.from(selectedMatchIds);
    setRejecting(true);
    try {
      let ok = 0;
      for (const id of ids) {
        const r = await jsonFetch(`/api/matches/${id}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verdict: "BAD", reason: rejectReason || null }),
        });
        if (r.ok) ok++;
      }
      toast(t("rejectedResult", { count: ok }), "success");
      setSelectedMatchIds(new Set());
      loadMatches(selectedId);
    } finally {
      setRejecting(false);
    }
  }

  async function sendAllOutreach() {
    if (!selectedId) return;
    // If the user ticked specific jobs, send only those; otherwise send to all.
    const ids = selectedMatchIds.size > 0 ? Array.from(selectedMatchIds) : undefined;
    const count = ids ? ids.length : pendingMatches.length;
    if (!confirm(t("sendAllConfirm", { count }))) return;
    setSendingAll(true);
    try {
      const { ok, data } = await jsonFetch(`/api/candidates/${selectedId}/send-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "bulk-send", ...(ids ? { matchIds: ids } : {}) }),
      });
      if (ok && data.ok) {
        toast(
          t("bulkResult", {
            sent: Number(data.sent ?? 0),
            skipped: Number(data.skippedNoEmail ?? 0) + Number(data.skippedCooldown ?? 0) + Number(data.alreadySent ?? 0) + Number(data.skippedOptedOut ?? 0),
          }),
          "success"
        );
        if (data.limitReached) toast(t("dailyLimitReached"), "info");
        setSelectedMatchIds(new Set());
        loadMatches(selectedId);
        loadComms(selectedId);
        setActiveTab("comms");
      } else {
        toast(String(data.error ?? "error"), "error");
      }
    } finally {
      setSendingAll(false);
    }
  }

  const selectedCandidate = candidates.find((c) => c.id === selectedId);

  // Per-candidate outreach performance, computed from the loaded comms.
  const perfSent = comms.filter((c) => c.sentAt || c.status === "SENT").length;
  const perfOpened = comms.filter((c) => c.openedAt || c.openCount > 0 || c.status === "OPENED").length;
  const perfReplied = comms.filter((c) => c.repliedAt || c.status === "REPLIED").length;
  const perfInterview = comms.filter((c) => c.match?.status === "INTERVIEW" || c.match?.status === "PLACED").length;
  const perfReplyRate = perfSent > 0 ? Math.round((perfReplied / perfSent) * 100) : 0;
  const completeness = selectedCandidate ? profileCompleteness(selectedCandidate, t) : null;

  const q = searchQuery.trim().toLowerCase();
  const visibleCandidates = candidates
    .filter((c) => statusFilter === "ALL" || c.status === statusFilter)
    .filter((c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.beruf.toLowerCase().includes(q) ||
      (c.desiredPosition ?? "").toLowerCase().includes(q) ||
      (c.currentCity ?? "").toLowerCase().includes(q) ||
      (c.nationality ?? "").toLowerCase().includes(q)
    )
    .sort((a, b) => {
      if (listSort === "matches") return (b._count.matches ?? 0) - (a._count.matches ?? 0);
      if (listSort === "unread") return (unreadByCandidate[b.id] ?? 0) - (unreadByCandidate[a.id] ?? 0);
      if (listSort === "recent") return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    });

  return (
    <div className="min-h-screen bg-surface text-ink">
      <TopNav active="candidates" />

      {/* Sub-header */}
      <div className="border-b border-line px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <span className="font-semibold text-ink text-sm">{t("title")}</span>
        <div className="flex items-center gap-2">
          {/* Fetch fresh listings for the SELECTED candidate — lives next to the
              dead-sweep button per the operator's request. Disabled until a
              candidate is selected (the pull is occupation-specific). */}
          <button
            onClick={fetchJobsNow}
            disabled={fetchingJobs || !selectedId}
            title={selectedId ? t("fetchJobs") : t("fetchJobsPick")}
            className="bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:opacity-50 text-white text-sm px-3 sm:px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 whitespace-nowrap"
          >
            {fetchingJobs ? (
              <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> <span className="hidden sm:inline">{t("fetchingJobs")}</span></>
            ) : (
              <>🔄 <span className="hidden sm:inline">{t("fetchJobs")}</span></>
            )}
          </button>
          <button
            onClick={sweepDeadListings}
            disabled={sweeping}
            title={t("sweepDeadTitle")}
            className={`text-white text-sm px-3 sm:px-4 py-2 rounded-lg font-semibold shadow-lg shadow-red-600/30 disabled:opacity-70 ${sweeping ? "bg-red-700 cursor-wait" : "bg-red-600 hover:bg-red-500 animate-pulse"}`}
          >
            {sweeping ? t("sweeping") : <>🗑 <span className="hidden sm:inline">{t("sweepDead")}</span><span className="sm:hidden">{t("sweepDeadShort")}</span></>}
          </button>
          <button
            onClick={startNewCandidate}
            className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm px-3 sm:px-4 py-2 rounded-lg font-medium"
          >
            + <span className="hidden sm:inline">{t("newCandidate")}</span><span className="sm:hidden">{t("new")}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-110px)]">
        {/* Left — candidate list */}
        <div className={`w-full lg:w-80 border-b lg:border-b-0 lg:border-r border-line overflow-y-auto p-3 space-y-1 shrink-0 ${mobileView === "detail" ? "hidden lg:block" : ""}`}>
          {/* Search + status filter / sort */}
          {candidates.length > 0 && (
            <div className="pb-2 mb-1 border-b border-line sticky top-0 bg-surface z-10 space-y-2">
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 text-xs">🔍</span>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="w-full bg-card text-ink rounded-lg pl-7 pr-7 py-1.5 text-xs border border-line-strong focus:border-blue-500 focus:outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink text-xs">✕</button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {["ALL", ...STATUS_OPTIONS].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-2 py-1 rounded text-[11px] font-medium ${statusFilter === s ? "bg-blue-600 text-white" : "bg-card-2 text-ink-2 hover:bg-line"}`}
                  >
                    {s === "ALL" ? t("filterAll") : t(`status${s}`)}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] text-ink-3">{t("candidateCount", { shown: visibleCandidates.length, total: candidates.length })}</div>
                <select
                  value={listSort}
                  onChange={(e) => setListSort(e.target.value as typeof listSort)}
                  className="bg-card-2 text-ink-2 rounded-md text-[10px] px-1.5 py-1 border border-line focus:outline-none"
                  title={t("sortTitle")}
                >
                  <option value="status">↓ {t("sortStatus")}</option>
                  <option value="matches">↓ {t("sortMatches")}</option>
                  <option value="unread">↓ {t("sortUnread")}</option>
                  <option value="recent">↓ {t("sortRecent")}</option>
                </select>
              </div>
            </div>
          )}
          {candidates.length === 0 && (
            <div className="text-ink-3 text-sm p-3">{t("noCandidates")}</div>
          )}
          {candidates.length > 0 && visibleCandidates.length === 0 && (
            <div className="text-ink-3 text-xs p-3">{t("noSearchResults")}</div>
          )}
          {visibleCandidates.map((c) => (
            <button
              key={c.id}
              onClick={() => selectCandidate(c.id)}
              className={`w-full text-left p-2.5 rounded-xl border transition-colors ${selectedId === c.id ? "bg-blue-600/15 border-blue-600/40" : "border-transparent hover:bg-card-2/60 hover:border-line"}`}
            >
              <div className="flex items-start gap-2.5">
                {/* Avatar — real photo if uploaded, else gradient initials */}
                <div className="relative shrink-0 w-9 h-9">
                  {c.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photoUrl} alt={c.name} className="w-9 h-9 rounded-xl object-cover shadow-sm" />
                  ) : (
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${avatarGradient(c.name)} flex items-center justify-center text-white font-bold text-xs shadow-sm`}>
                      {initials(c.name)}
                    </div>
                  )}
                  {unreadByCandidate[c.id] > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 flex items-center justify-center rounded-full bg-green-500 text-white text-[9px] font-bold ring-2 ring-surface" title={`${unreadByCandidate[c.id]} yeni cavab`}>
                      {unreadByCandidate[c.id]}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink text-sm truncate">{c.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${STATUS_COLOR[c.status]}`}>{t(`status${c.status}`)}</span>
                  </div>
                  <div className="text-xs text-ink-2 mt-0.5 truncate">{c.beruf} · {c.regionPrefs.join(", ") || t("anywhere")}</div>
                  {(c.currentCity || c.phone) && (
                    <div className="text-xs text-ink-3 mt-0.5 truncate">
                      {[c.currentCity, c.phone].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div className="text-[11px] text-ink-3 mt-1 flex items-center gap-2 flex-wrap">
                    <span>{t("matchCount", { count: c._count.matches })}</span>
                    {c.needsSponsorship && <span className="text-yellow-500">{t("needsSponsorshipShort")}</span>}
                  </div>
                  {(!c.hasCv || c._count.matches === 0) && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {!c.hasCv && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30">⚠ {t("noCvFlag")}</span>
                      )}
                      {c._count.matches === 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30">⚠ {t("noMatchFlag")}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Right — form or match results */}
        <div className={`flex-1 overflow-y-auto p-4 sm:p-6 ${mobileView === "list" ? "hidden lg:block" : ""}`}>
          <button
            onClick={() => setMobileView("list")}
            className="lg:hidden mb-4 flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
          >
            {t("backToList")}
          </button>

          {/* Add candidate form */}
          {showForm && (
            <div className="max-w-3xl mx-auto lg:mx-0">
              <h2 className="text-lg font-bold text-ink mb-5">{t("cvData")}</h2>

              {/* CV import → Claude auto-fills the form (PDF or pasted text) */}
              <div className="mb-4 bg-gradient-to-r from-blue-600/15 to-purple-600/15 border border-blue-600/30 rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">✨ {t("uploadCV")}</div>
                    <div className="text-xs text-ink-2 mt-0.5">{t("uploadHint")}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <label className={`cursor-pointer ${parsingCV ? "opacity-60 pointer-events-none" : ""} bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm px-4 py-2.5 rounded-lg font-medium text-center`}>
                      📄 PDF
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        disabled={parsingCV}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) parseCV(f); e.target.value = ""; }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPaste((v) => !v)}
                      disabled={parsingCV}
                      className="bg-card-2 hover:bg-line border border-line-strong text-ink text-sm px-4 py-2.5 rounded-lg font-medium disabled:opacity-60"
                    >
                      📋 {t("pasteText")}
                    </button>
                  </div>
                </div>

                {showPaste && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={cvText}
                      onChange={(e) => setCvText(e.target.value)}
                      rows={6}
                      placeholder={t("pasteHint")}
                      className="w-full bg-card text-ink rounded-lg px-3 py-2 text-sm border border-line-strong focus:border-blue-500 focus:outline-none resize-y"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={parseText}
                        disabled={parsingCV || cvText.trim().length < 20}
                        className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg font-medium"
                      >
                        {parsingCV ? t("parsing") : t("fillFromText")}
                      </button>
                    </div>
                  </div>
                )}

                {/* Attached CV indicator — this file is sent with the application */}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {existingCvName ? (
                    <span className="inline-flex items-center gap-1.5 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-md">
                      📎 {t("cvAttached")}: {existingCvName}
                      {editingId && !cvFile && (
                        <a href={`/api/candidates/${editingId}/cv`} target="_blank" rel="noopener noreferrer" className="underline hover:text-emerald-200">{t("view")}</a>
                      )}
                    </span>
                  ) : (
                    <span className="text-ink-3">{t("noCvYet")}</span>
                  )}
                  <label className="cursor-pointer text-ink-2 hover:text-ink underline">
                    {existingCvName ? t("replaceCv") : t("attachCv")}
                    <input type="file" accept="application/pdf" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) attachCvOnly(f); e.target.value = ""; }} />
                  </label>
                </div>
              </div>

              <div className="space-y-4">

                {/* Status + delete bar — only when editing an existing candidate */}
                {editingId && (
                  <div className={`${cardCls} sm:flex sm:items-center sm:justify-between gap-3 space-y-3 sm:space-y-0`}>
                    <div>
                      <label className="text-xs text-ink-3 block mb-1.5">{t("statusLabel")}</label>
                      <div className="flex flex-wrap gap-2">
                        {STATUS_OPTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => set("status", s)}
                            className={`px-3 py-1.5 rounded text-xs font-medium border ${form.status === s ? STATUS_COLOR[s] : "bg-card-2 text-ink-2 border-transparent hover:bg-line"}`}
                          >
                            {t(`status${s}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteCandidate(editingId)}
                      className="text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 px-3 py-2 rounded shrink-0"
                    >
                      {t("deleteCandidate")}
                    </button>
                  </div>
                )}

                {/* Personal */}
                <div className={cardCls}>
                  <h3 className={sectionTitle}>{t("personalInfo")}</h3>
                  {/* Candidate photo — resized client-side, stored inline */}
                  <div className="flex items-center gap-4">
                    <div className="shrink-0">
                      {form.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={form.photoUrl} alt="" className="w-16 h-16 rounded-2xl object-cover border border-line" />
                      ) : (
                        <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${avatarGradient(form.name || "?")} flex items-center justify-center text-white font-bold text-xl`}>
                          {initials(form.name || "?")}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="btn btn-ghost text-xs cursor-pointer">
                        📷 {t("uploadPhoto")}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const url = await resizeImageToDataUrl(file);
                              set("photoUrl", url);
                            } catch {
                              toast(t("photoFailed"), "error");
                            }
                          }}
                        />
                      </label>
                      {form.photoUrl && (
                        <button type="button" onClick={() => set("photoUrl", "")} className="text-xs text-red-400 hover:text-red-300 text-left">{t("removePhoto")}</button>
                      )}
                      <span className="text-[10px] text-ink-3">{t("photoHint")}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>{t("fullName")} *</label>
                      <input value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Əli Hüseynov" />
                    </div>
                    <div>
                      <label className={labelCls}>{t("email")}</label>
                      <input value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} placeholder="ali@email.com" />
                    </div>
                    <div>
                      <label className={labelCls}>{t("phone")}</label>
                      <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} placeholder="+994 50 ..." />
                    </div>
                    <div>
                      <label className={labelCls}>{t("dateOfBirth")}</label>
                      <input type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t("gender")}</label>
                      <select value={form.gender} onChange={(e) => set("gender", e.target.value)} className={inputCls}>
                        <option value="">—</option>
                        <option value="male">{t("male")}</option>
                        <option value="female">{t("female")}</option>
                        <option value="other">{t("other")}</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t("nationality")}</label>
                      <input value={form.nationality} onChange={(e) => set("nationality", e.target.value)} className={inputCls} placeholder="Azərbaycan" />
                    </div>
                    <div>
                      <label className={labelCls}>{t("maritalStatus")}</label>
                      <select value={form.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)} className={inputCls}>
                        <option value="">—</option>
                        <option value="single">{t("single")}</option>
                        <option value="married">{t("married")}</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t("currentCity")}</label>
                      <input value={form.currentCity} onChange={(e) => set("currentCity", e.target.value)} className={inputCls} placeholder="Baku" />
                    </div>
                    <div>
                      <label className={labelCls}>{t("country")}</label>
                      <input value={form.currentCountry} onChange={(e) => set("currentCountry", e.target.value)} className={inputCls} placeholder="Azərbaycan" />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>{t("address")}</label>
                    <input value={form.address} onChange={(e) => set("address", e.target.value)} className={inputCls} />
                  </div>
                </div>

                {/* Status / Sponsorship */}
                <div className={cardCls}>
                  <h3 className={sectionTitle}>{t("statusVisa")}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>{t("visaStatus")}</label>
                      <input value={form.visaStatus} onChange={(e) => set("visaStatus", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t("availableFrom")}</label>
                      <input type="date" value={form.availableFrom} onChange={(e) => set("availableFrom", e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t("salaryExpectation")}</label>
                      <input value={form.salaryExpectation} onChange={(e) => set("salaryExpectation", e.target.value)} className={inputCls} placeholder="2500€" />
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                      <input type="checkbox" checked={form.needsSponsorship} onChange={(e) => set("needsSponsorship", e.target.checked)} className="w-4 h-4" />
                      {t("needsSponsorship")}
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-ink">
                      <input type="checkbox" checked={form.willingToRelocate} onChange={(e) => set("willingToRelocate", e.target.checked)} className="w-4 h-4" />
                      {t("willingToRelocate")}
                    </label>
                  </div>
                </div>

                {/* Professional */}
                <div className={cardCls}>
                  <h3 className={sectionTitle}>{t("professionalInfo")}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>{t("occupation")} * <span className="text-ink-3">({t("occupationManual")})</span></label>
                      <input list="cand-beruf" value={form.beruf} onChange={(e) => set("beruf", e.target.value)} className={inputCls} placeholder="Schweißer, Pflege..." />
                      <datalist id="cand-beruf">{BERUF_LIST.map((b) => <option key={b} value={b} />)}</datalist>
                    </div>
                    <div>
                      <label className={labelCls}>{t("desiredPosition")}</label>
                      <input value={form.desiredPosition} onChange={(e) => set("desiredPosition", e.target.value)} className={inputCls} placeholder="Küchenchef" />
                    </div>
                    <div>
                      <label className={labelCls}>{t("yearsExperience")}</label>
                      <input type="number" min="0" value={form.yearsExperience} onChange={(e) => set("yearsExperience", e.target.value)} className={inputCls} placeholder="5" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-ink-3 block mb-1.5">{t("preferredRegions")}</label>
                    <div className="flex flex-wrap gap-2">
                      {REGIONS_DE.map((r) => (
                        <button key={r} onClick={() => toggleArr("regionPrefs", r)} type="button"
                          className={`px-2.5 py-1.5 rounded text-xs font-medium ${form.regionPrefs.includes(r) ? "bg-blue-600 text-white" : "bg-card-2 text-ink-2 hover:bg-line"}`}>
                          {r === "Deutschland" ? t("allGermany") : r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>{t("drivingLicense")}</label>
                    <input value={form.drivingLicense} onChange={(e) => set("drivingLicense", e.target.value)} className={inputCls} placeholder="B, C, CE" />
                  </div>
                </div>

                {/* Work experience */}
                <div className={cardCls}>
                  <div className="flex items-center justify-between">
                    <h3 className={sectionTitle}>{t("workExperience")}</h3>
                    <button type="button" onClick={addExp} className="text-xs text-blue-400 hover:text-blue-300">{t("addEntry")}</button>
                  </div>
                  {form.experience.length === 0 && <div className="text-xs text-ink-3">{t("noExperience")}</div>}
                  {form.experience.map((exp, i) => (
                    <div key={i} className="bg-card-2/40 rounded-lg p-3 space-y-2 relative">
                      <button type="button" onClick={() => delExp(i)} className="absolute top-2 right-2 text-ink-3 hover:text-red-400 text-xs">{t("delete")}</button>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input value={exp.company} onChange={(e) => updExp(i, "company", e.target.value)} className={inputCls} placeholder={t("company")} />
                        <input value={exp.title} onChange={(e) => updExp(i, "title", e.target.value)} className={inputCls} placeholder={t("position")} />
                        <input value={exp.from} onChange={(e) => updExp(i, "from", e.target.value)} className={inputCls} placeholder={t("startYear")} />
                        <input value={exp.to} onChange={(e) => updExp(i, "to", e.target.value)} className={inputCls} placeholder={t("endYear")} />
                      </div>
                      <textarea value={exp.description} onChange={(e) => updExp(i, "description", e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder={t("expDescription")} />
                    </div>
                  ))}
                </div>

                {/* Education */}
                <div className={cardCls}>
                  <div className="flex items-center justify-between">
                    <h3 className={sectionTitle}>{t("education")}</h3>
                    <button type="button" onClick={addEdu} className="text-xs text-blue-400 hover:text-blue-300">{t("addEntry")}</button>
                  </div>
                  {form.education.length === 0 && <div className="text-xs text-ink-3">{t("noEducation")}</div>}
                  {form.education.map((edu, i) => (
                    <div key={i} className="bg-card-2/40 rounded-lg p-3 space-y-2 relative">
                      <button type="button" onClick={() => delEdu(i)} className="absolute top-2 right-2 text-ink-3 hover:text-red-400 text-xs">{t("delete")}</button>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input value={edu.school} onChange={(e) => updEdu(i, "school", e.target.value)} className={inputCls} placeholder={t("school")} />
                        <input value={edu.degree} onChange={(e) => updEdu(i, "degree", e.target.value)} className={inputCls} placeholder={t("degree")} />
                        <input value={edu.field} onChange={(e) => updEdu(i, "field", e.target.value)} className={inputCls} placeholder={t("field")} />
                        <div className="grid grid-cols-2 gap-2">
                          <input value={edu.from} onChange={(e) => updEdu(i, "from", e.target.value)} className={inputCls} placeholder="2015" />
                          <input value={edu.to} onChange={(e) => updEdu(i, "to", e.target.value)} className={inputCls} placeholder="2019" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Languages */}
                <div className={cardCls}>
                  <h3 className={sectionTitle}>{t("languages")}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{t("germanLevel")}</label>
                      <select value={form.germanLevel} onChange={(e) => set("germanLevel", e.target.value)} className={inputCls}>
                        {GERMAN_LEVELS.map((l) => <option key={l}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-ink-3 block mb-1.5">{t("otherLanguages")}</label>
                    <div className="flex flex-wrap gap-2">
                      {["az", "en", "ru", "tr", "ar", "uk", "fa"].map((l) => (
                        <button key={l} onClick={() => toggleArr("languages", l)} type="button"
                          className={`px-2.5 py-1.5 rounded text-xs font-medium uppercase ${form.languages.includes(l) ? "bg-blue-600 text-white" : "bg-card-2 text-ink-2 hover:bg-line"}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Skills & certificates */}
                <div className={cardCls}>
                  <h3 className={sectionTitle}>{t("skillsCerts")}</h3>
                  <div>
                    <label className={labelCls}>{t("skills")}</label>
                    <input value={form.skills} onChange={(e) => set("skills", e.target.value)} className={inputCls} placeholder="HACCP, ..." />
                  </div>
                  <div>
                    <label className={labelCls}>{t("certificates")}</label>
                    <input value={form.certificates} onChange={(e) => set("certificates", e.target.value)} className={inputCls} placeholder="Goethe B1, ..." />
                  </div>
                </div>

                {/* Notes */}
                <div className={cardCls}>
                  <label className={labelCls}>{t("notes")}</label>
                  <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={`${inputCls} resize-none`} />
                </div>

                {saveMsg && (
                  <div className={`text-sm p-3 rounded ${saveMsg.startsWith("✓") ? "bg-emerald-900/30 text-emerald-400" : "bg-red-900/30 text-red-400"}`}>
                    {saveMsg}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 pb-6">
                  <button onClick={saveCandidate} disabled={saving || !form.name || !form.beruf}
                    className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium">
                    {saving ? t("saving") : t("save")}
                  </button>
                  <button onClick={() => { setShowForm(false); setSaveMsg(null); setEditingId(null); }}
                    className="bg-card-2 hover:bg-line text-ink-2 px-4 py-2.5 rounded-lg text-sm">
                    {t("cancel")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Match results */}
          {selectedCandidate && !showForm && (
            <div>
              {/* Profile header */}
              <div className="card p-5 mb-5">
                <div className="flex items-start gap-4">
                  {selectedCandidate.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selectedCandidate.photoUrl} alt={selectedCandidate.name} className="shrink-0 w-14 h-14 rounded-2xl object-cover shadow-lg" />
                  ) : (
                    <div className={`shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarGradient(selectedCandidate.name)} flex items-center justify-center text-white font-bold text-lg shadow-lg`}>
                      {initials(selectedCandidate.name)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold text-ink truncate">{selectedCandidate.name}</h2>
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLOR[selectedCandidate.status]}`}>{t(`status${selectedCandidate.status}`)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-card-2 text-ink border border-line-strong/60 font-medium">{selectedCandidate.beruf}</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-card-2 text-ink-2 border border-line-strong/60">
                        {selectedCandidate.regionPrefs.length > 0 ? selectedCandidate.regionPrefs.join(", ") : t("allGermany")}
                      </span>
                      {selectedCandidate.languages.map((l) => (
                        <span key={l} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-card-2 text-ink-2 border border-line-strong/60 uppercase">{l}</span>
                      ))}
                      {selectedCandidate.needsSponsorship && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30">★ {t("needsSponsorshipShort")}</span>
                      )}
                    </div>
                  {(selectedCandidate.phone || selectedCandidate.email) && (
                    <div className="mt-2 flex flex-wrap gap-4 text-xs">
                      {selectedCandidate.phone && (
                        <a href={`tel:${selectedCandidate.phone}`} className="flex items-center gap-1 text-ink-2 hover:text-ink">
                          📞 {selectedCandidate.phone}
                        </a>
                      )}
                      {selectedCandidate.email && (
                        <a href={`mailto:${selectedCandidate.email}`} className="flex items-center gap-1 text-ink-2 hover:text-ink">
                          ✉️ {selectedCandidate.email}
                        </a>
                      )}
                    </div>
                  )}
                  </div>
                  <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
                    <select
                      value={selectedCandidate.status}
                      onChange={(e) => changeStatus(selectedCandidate.id, e.target.value)}
                      className="bg-card-2 text-ink text-xs rounded-lg px-2.5 py-1.5 border border-line-strong"
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(`status${s}`)}</option>)}
                    </select>
                    <div className="flex gap-1.5">
                      <button onClick={sendTestLetter} disabled={testLetterLoading} className="text-xs text-violet-300 hover:text-violet-200 bg-violet-900/20 hover:bg-violet-900/40 disabled:opacity-50 px-3 py-1.5 rounded-lg">{testLetterLoading ? t("preparing") : t("testLetter")}</button>
                      <button onClick={() => startEdit(selectedCandidate.id)} className="text-xs text-ink-2 hover:text-ink bg-card-2 hover:bg-line px-3 py-1.5 rounded-lg">{t("edit")}</button>
                      <button onClick={() => deleteCandidate(selectedCandidate.id)} className="text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 px-3 py-1.5 rounded-lg">{t("deleteCandidate")}</button>
                    </div>
                  </div>
                </div>
                {/* Performance — how this candidate is doing, at a glance.
                    Keyed on the candidate so the count-up re-runs on each open. */}
                <div key={selectedCandidate.id} className="mt-4 pt-4 border-t border-line">
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {[
                      { label: t("statMatches"), value: matches.length, cls: "text-emerald-400" },
                      { label: t("perfSent"), value: perfSent, cls: "text-blue-400" },
                      { label: t("perfOpened"), value: perfOpened, cls: "text-violet-400" },
                      { label: t("perfReplied"), value: perfReplied, cls: "text-green-400" },
                      { label: t("perfInterview"), value: perfInterview, cls: "text-amber-400" },
                    ].map((s) => (
                      <div key={s.label} className="bg-card-2 border border-line rounded-lg px-2.5 py-2 transition-colors hover:border-line-strong">
                        <div className={`tabular text-xl font-bold ${s.cls}`}><CountUp value={s.value} /></div>
                        <div className="text-[10px] text-ink-3 truncate">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Reply-rate bar — the money metric for this person */}
                  {perfSent > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-ink-3">{t("replyRateLabel")}</span>
                        <span className="tabular font-semibold text-ink"><CountUp value={perfReplyRate} />% <span className="text-ink-3 font-normal">({perfReplied}/{perfSent})</span></span>
                      </div>
                      <div className="h-1.5 rounded-full bg-card-2 overflow-hidden">
                        <div className="h-full bg-accent rounded-full" style={{ width: `${perfReplyRate}%`, transition: "width 500ms ease" }} />
                      </div>
                    </div>
                  )}
                  {/* Profile completeness — nudge toward a stronger letter + auto-send readiness */}
                  {completeness && completeness.pct < 100 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-ink-3">{t("profileCompleteness")}</span>
                        <span className="tabular font-semibold text-ink"><CountUp value={completeness.pct} />%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-card-2 overflow-hidden">
                        <div className={`h-full rounded-full ${completeness.pct >= 75 ? "bg-emerald-500" : completeness.pct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${completeness.pct}%`, transition: "width 500ms ease" }} />
                      </div>
                      {completeness.missing.length > 0 && (
                        <div className="text-[10px] text-ink-3 mt-1">{t("missing")}: {completeness.missing.join(" · ")}</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Mobile actions row (desktop shows them in the header top-right) */}
                <div className="sm:hidden mt-3">
                  <div className="w-full flex items-center gap-1.5 pt-1">
                    <select
                      value={selectedCandidate.status}
                      onChange={(e) => changeStatus(selectedCandidate.id, e.target.value)}
                      className="bg-card-2 text-ink text-xs rounded-lg px-2 py-1.5 border border-line-strong flex-1"
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(`status${s}`)}</option>)}
                    </select>
                    <button onClick={() => startEdit(selectedCandidate.id)} className="text-xs text-ink-2 bg-card-2 px-3 py-1.5 rounded-lg shrink-0">{t("edit")}</button>
                    <button onClick={() => deleteCandidate(selectedCandidate.id)} className="text-xs text-red-400 bg-red-900/20 px-3 py-1.5 rounded-lg shrink-0">✕</button>
                  </div>
                </div>
              </div>

              {/* Placement pipeline + visa/document checklist */}
              <PipelineDocsPanel candidateId={selectedCandidate.id} />

              {/* Tabs — sticky so they stay reachable while scrolling long lists */}
              <div className="flex gap-1 border-b border-line mb-4 sticky top-0 z-20 bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
                {([
                  ["matches", t("tabMatches"), pendingMatches.length],
                  ["comms", t("tabComms"), comms.length],
                  ["replies", t("tabReplies"), comms.filter((c) => c.repliedAt || c.status === "REPLIED").length],
                ] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === key ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
                  >
                    {label}
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${activeTab === key ? "bg-blue-600/30 text-blue-200" : "bg-card-2 text-ink-3"}`}>{count}</span>
                    {activeTab === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
                  </button>
                ))}
              </div>

              {/* Matches tab */}
              {activeTab === "matches" && (
                matchesLoading ? (
                  <div className="space-y-3">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="bg-card border border-line rounded-2xl p-4">
                        <div className="flex items-center gap-3">
                          <div className="skeleton w-10 h-10 rounded-full shrink-0" />
                          <div className="flex-1 space-y-2">
                            <div className="skeleton h-3.5 w-1/3" />
                            <div className="skeleton h-3 w-2/3" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : pendingMatches.length === 0 ? (
                  matchFilterActive && pendingUnfiltered > 0 ? (
                    <div className="bg-card border border-line rounded-2xl p-8 text-center">
                      <div className="text-3xl mb-2">🔎</div>
                      <div className="text-ink-2 text-sm mb-3">{t("filterNoMatch", { count: pendingUnfiltered })}</div>
                      <button
                        onClick={() => setMatchFilters({ sponsor: false, applyType: "all" })}
                        className="btn btn-ghost text-xs"
                      >
                        {t("resetFilters")}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-card border border-line rounded-2xl p-8 text-center">
                      <div className="text-ink-2 text-sm mb-3">{comms.length > 0 ? t("allSent") : t("noVacancyTitle")}</div>
                      <div className="text-ink-3 text-xs">{comms.length > 0 ? t("allSentHint") : t("noVacancyHint")}</div>
                    </div>
                  )
                ) : (
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={selectedMatchIds.size === pendingMatches.length && pendingMatches.length > 0}
                            onChange={toggleSelectAll}
                            className="w-4 h-4 accent-emerald-500 cursor-pointer"
                          />
                          {t("selectAll")}
                        </label>
                        {/* Quick-select first N */}
                        <div className="flex items-center gap-1">
                          {[10, 20, 30].map((n) => (
                            <button
                              key={n}
                              onClick={() => selectFirstN(n)}
                              disabled={pendingMatches.length === 0}
                              className="text-xs px-2 py-1 rounded-md bg-card-2 text-ink-2 hover:bg-line disabled:opacity-40"
                            >
                              {n}
                            </button>
                          ))}
                          {selectedMatchIds.size > 0 && (
                            <button
                              onClick={() => setSelectedMatchIds(new Set())}
                              className="text-xs px-2 py-1 rounded-md text-ink-3 hover:text-ink-2"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <div className="text-sm text-ink-2">
                          <span className="text-ink font-bold text-lg">{pendingMatches.length}</span> {t("found")}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end gap-2">
                        <button
                          onClick={() => findEmailsForMatches()}
                          disabled={enrichingMatches || sendingAll}
                          className="bg-card-2 hover:bg-line active:bg-card disabled:opacity-50 text-ink text-sm px-4 py-2.5 sm:py-2 rounded-lg font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap"
                        >
                          {enrichingMatches ? (
                            <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> {t("findingEmails")}</>
                          ) : (
                            <>🔍 {t("findEmails")}</>
                          )}
                        </button>
                        <button
                          onClick={sendAllOutreach}
                          disabled={sendingAll}
                          className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2.5 sm:py-2 rounded-lg font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap"
                        >
                          {sendingAll ? (
                            <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> {t("sendingAll")}</>
                          ) : selectedMatchIds.size > 0 ? (
                            <>✉️ {t("sendSelected", { count: selectedMatchIds.size })}</>
                          ) : (
                            <>✉️ {t("sendAll")}</>
                          )}
                        </button>
                        {selectedMatchIds.size > 0 && (
                          <>
                            <select
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              title={t("rejectReasonLabel")}
                              className="bg-card-2 text-ink-2 border border-line-strong text-xs rounded-lg px-2 py-2.5 sm:py-2 max-w-[9rem] truncate"
                            >
                              <option value="">{t("rejectReasonLabel")}</option>
                              {REJECT_REASONS.map((r) => (
                                <option key={r} value={r}>{(REASON_LABELS[locale] ?? REASON_LABELS.az)[r]}</option>
                              ))}
                            </select>
                            <button
                              onClick={bulkRejectMatches}
                              disabled={rejecting || sendingAll}
                              className="bg-card-2 hover:bg-line text-rose-500 border border-line-strong disabled:opacity-50 text-sm px-4 py-2.5 sm:py-2 rounded-lg font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap"
                            >
                              {rejecting ? "…" : <>✕ {t("rejectSelected", { count: selectedMatchIds.size })}</>}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Filter + sort */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-3">
                      <button
                        onClick={() => setMatchFilters((f) => ({ ...f, sponsor: !f.sponsor }))}
                        className={`text-xs px-2.5 py-1 rounded-md border ${matchFilters.sponsor ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" : "bg-card-2 text-ink-2 border-line hover:bg-line"}`}
                      >
                        ★ {t("filterSponsor")}
                      </button>
                      {/* Apply type: separate email-apply from form-apply jobs */}
                      <div className="inline-flex rounded-md border border-line overflow-hidden">
                        {([
                          ["all", t("applyAll"), ""],
                          ["email", `✉️ ${t("applyEmail")} (${emailCount})`, "text-blue-400"],
                          ["form", `📝 ${t("applyForm")} (${formCount})`, "text-amber-400"],
                        ] as const).map(([key, label, color]) => (
                          <button
                            key={key}
                            onClick={() => setMatchFilters((f) => ({ ...f, applyType: key }))}
                            className={`text-xs px-2.5 py-1 ${matchFilters.applyType === key ? `bg-line-strong text-ink ${color}` : "bg-card-2 text-ink-3 hover:bg-line"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="ml-auto flex items-center gap-1 text-xs text-ink-3">
                        <span>{t("sortColon")}:</span>
                        <select
                          value={matchSort}
                          onChange={(e) => setMatchSort(e.target.value as typeof matchSort)}
                          className="bg-card-2 text-ink-2 rounded-md text-xs px-1.5 py-1 border border-line focus:outline-none"
                        >
                          <option value="email">{t("filterEmailReady")}</option>
                          <option value="fit">{t("sortFit")}</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {pendingMatches.map((m) => {
                        const jobLink = m.vacancy.url
                          || (m.vacancy.applyValue && /^https?:\/\//.test(m.vacancy.applyValue) ? m.vacancy.applyValue : null);
                        return (
                          <div key={m.id} className={`group bg-card border rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10 ${selectedMatchIds.has(m.id) ? "border-emerald-600/60" : "border-line hover:border-line-strong"}`}>
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                              <input
                                type="checkbox"
                                checked={selectedMatchIds.has(m.id)}
                                onChange={() => toggleMatchSelect(m.id)}
                                className="mt-1 w-4 h-4 accent-emerald-500 cursor-pointer shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-ink">{m.employer.name}</span>
                                  {m.employer.stars && <span className="text-amber-400 text-xs">{"★".repeat(m.employer.stars)}</span>}
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SIGNAL_COLOR[m.employer.sponsorshipSignal]}`}>
                                    {m.employer.sponsorshipSignal === "YES" ? t("sponsorshipYes") :
                                      m.employer.sponsorshipSignal === "LIKELY" ? t("sponsorshipLikely") :
                                        m.employer.sponsorshipSignal === "NO" ? t("sponsorshipNo") : t("sponsorshipUnknown")}
                                  </span>
                                  {m.vacancy.source && <span className="text-[10px] text-ink-3 uppercase tracking-wide">{m.vacancy.source}</span>}
                                  {m.relevant === false && (
                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/30">
                                      ⚠ {t("notRelevantPill")}
                                    </span>
                                  )}
                                  {typeof m.fitScore === "number" && (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedFit(expandedFit === m.id ? null : m.id)}
                                      title={t("fitTooltip", { score: m.fitScore })}
                                      className="ml-auto shrink-0 relative w-9 h-9"
                                    >
                                      <div
                                        className="w-9 h-9 rounded-full"
                                        style={{ background: `conic-gradient(rgb(var(--accent)) ${Math.round(m.fitScore * 3.6)}deg, rgb(var(--card-2)) 0deg)` }}
                                      />
                                      <div className="absolute inset-[3px] rounded-full bg-card flex items-center justify-center">
                                        <span className="tabular text-[11px] font-bold text-ink">{m.fitScore}</span>
                                      </div>
                                    </button>
                                  )}
                                </div>
                                {expandedFit === m.id && m.fitBreakdown && (
                                  <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 gap-2 bg-card-2 border border-line rounded-lg p-2.5">
                                    {Object.entries(m.fitBreakdown).map(([key, val]) => (
                                      <div key={key} className="text-center">
                                        <div className="text-[9px] uppercase text-ink-3 truncate">{key}</div>
                                        <div className="tabular text-sm font-bold text-ink">{val}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="text-sm text-ink-2 mt-0.5">
                                  {m.employer.city}, {m.employer.region} · {m.vacancy.title}
                                </div>

                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                                  <div className="flex items-center gap-2">
                                    <span className="text-ink-3 w-24">{t("totalScore")}</span>
                                    <div className="flex-1 bg-card-2 rounded-full h-1.5">
                                      <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${m.employer.score}%` }} />
                                    </div>
                                    <span className={`font-bold w-6 text-right ${SCORE_COLOR(m.employer.score)}`}>{m.employer.score}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-ink-3 w-24">{t("fitScore")}</span>
                                    <div className="flex-1 bg-card-2 rounded-full h-1.5">
                                      <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${m.fitScore}%` }} />
                                    </div>
                                    <span className={`font-bold w-6 text-right ${SCORE_COLOR(m.fitScore)}`}>{m.fitScore}</span>
                                  </div>
                                </div>

                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                                  {jobLink && (
                                    <a href={jobLink} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 bg-blue-600/15 text-blue-300 border border-blue-600/30 hover:bg-blue-600/25 px-2.5 py-1 rounded-md font-medium">
                                      🔗 {t("jobListing")}
                                    </a>
                                  )}
                                  {/* FORM listings: open the application form with the
                                      #mzfill hash so the extension autofills THIS candidate. */}
                                  {m.vacancy.applyChannel === "FORM" && selectedId
                                    && (m.employer.applyFormUrl || jobLink) && (
                                    <a
                                      href={withFillHash(m.employer.applyFormUrl || jobLink!, selectedId)}
                                      target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 bg-purple-600/15 text-purple-300 border border-purple-600/30 hover:bg-purple-600/25 px-2.5 py-1 rounded-md font-medium">
                                      📝 {t("openForm")}
                                    </a>
                                  )}
                                  {m.employer.genericEmail ? (
                                    <span className="inline-flex items-center gap-1">
                                      <a href={`mailto:${m.employer.genericEmail}`}
                                        className="inline-flex items-center gap-1 bg-emerald-600/15 text-emerald-300 border border-emerald-600/30 hover:bg-emerald-600/25 px-2.5 py-1 rounded-md font-medium truncate max-w-[260px]"
                                        title={m.employer.genericEmail}>
                                        ✉ {m.employer.genericEmail}
                                      </a>
                                      {m.employer.emailSource && (
                                        <span className="text-[9px] uppercase tracking-wide text-ink-3" title={t("sourceTip")}>
                                          {m.employer.emailSource}
                                        </span>
                                      )}
                                      {m.employer.emailStatus === "undeliverable" && (
                                        <span className="text-[9px] text-red-400" title={t("undeliverableTip")}>⚠</span>
                                      )}
                                      {m.employer.emailStatus === "deliverable" && (
                                        <span className="text-[9px] text-emerald-400" title={t("verifiedTip")}>✓</span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 bg-red-900/20 text-red-400 border border-red-800/30 px-2.5 py-1 rounded-md text-[11px]">
                                      ✕ email yox
                                    </span>
                                  )}
                                  {m.employer.website && (
                                    <a href={m.employer.website.startsWith("http") ? m.employer.website : `https://${m.employer.website}`}
                                      target="_blank" rel="noopener noreferrer"
                                      className="text-blue-400 hover:underline truncate max-w-[200px]">{m.employer.website}</a>
                                  )}
                                  {m.employer.phone && (
                                    <>
                                      <a href={`https://wa.me/${phoneDigits(m.employer.phone)}`}
                                        target="_blank" rel="noopener noreferrer"
                                        title={`WhatsApp: ${m.employer.phone}`}
                                        className="inline-flex items-center gap-1 bg-green-600/15 text-green-300 border border-green-600/30 hover:bg-green-600/25 px-2 py-1 rounded-md font-medium">
                                        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.978-.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                        WhatsApp
                                      </a>
                                      <a href={`tel:+${phoneDigits(m.employer.phone)}`}
                                        title={t("callTip", { phone: m.employer.phone })}
                                        className="inline-flex items-center gap-1 bg-line/40 text-ink-2 border border-line-strong/40 hover:bg-line/60 px-2 py-1 rounded-md font-medium">
                                        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                        {m.employer.phone}
                                      </a>
                                    </>
                                  )}
                                </div>
                              </div>

                              <div className="shrink-0 sm:text-right">
                                {m.outreach.some((o) => o.status === "SENT") ? (
                                  <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium ${OUTREACH_COLOR["SENT"] ?? "bg-line text-ink-2"}`}>
                                    SENT
                                  </span>
                                ) : m.employer.optedOut ? (
                                  <span
                                    className="inline-block px-2.5 py-1 rounded-md text-[11px] font-medium bg-red-900/20 text-red-400 border border-red-800/30"
                                    title={t("optedOutTip")}
                                  >
                                    🚫 {t("optedOutPill")}
                                  </span>
                                ) : m.employerLastSentAt ? (
                                  <span
                                    className="inline-block px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-900/20 text-amber-400 border border-amber-800/30"
                                    title={t("alreadySentTip", { date: new Date(m.employerLastSentAt).toLocaleDateString() })}
                                  >
                                    ✓ {t("alreadySentPill")}
                                  </span>
                                ) : (
                                  <div className="flex flex-col items-stretch sm:items-end gap-1">
                                    <button
                                      onClick={() => createOutreachDraft(m.id)}
                                      disabled={outreachLoading === m.id}
                                      className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-3 py-2 sm:py-1.5 rounded-lg"
                                    >
                                      {outreachLoading === m.id ? t("preparing") : t("writeApplication")}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

              {/* Communication tab — which employers were contacted, what was sent */}
              {activeTab === "comms" && (
                commsLoading ? (
                  <div className="text-ink-3 text-sm">{t("searching")}</div>
                ) : comms.length === 0 ? (
                  <div className="bg-card border border-line rounded-2xl p-8 text-center">
                    <div className="text-ink-2 text-sm mb-2">{t("noOutreach")}</div>
                    <div className="text-ink-3 text-xs">{t("noOutreachHint")}</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-ink-2">
                        <span className="text-ink font-bold">{comms.length}</span> {t("statSent")}
                      </div>
                      <button
                        onClick={resetOutreach}
                        className="text-xs px-3 py-1.5 rounded-lg border border-red-900/60 text-red-300 hover:bg-red-950/40"
                      >
                        ↺ {t("resetOutreach")}
                      </button>
                    </div>
                    {comms.map((o) => (
                      <div key={o.id} className="relative bg-card border border-line rounded-2xl pl-5 pr-4 py-4 overflow-hidden">
                        {/* status spine */}
                        <span className={`absolute left-0 top-0 bottom-0 w-1 ${OUTREACH_DOT[o.status] ?? "bg-line-strong"}`} />
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-ink">{o.match.employer.name}</span>
                              <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${OUTREACH_COLOR[o.status] ?? "bg-line text-ink-2"}`}>{o.status}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${SIGNAL_COLOR[o.match.employer.sponsorshipSignal]}`}>{o.match.employer.sponsorshipSignal}</span>
                              {o.relevant === false && (
                                <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/30">
                                  ⚠ {t("notRelevantPill")}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-ink-2 mt-0.5">{o.match.vacancy.title}</div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-ink-3">
                              <span><span className="text-ink-3">{t("commTo")}:</span> {o.toAddress ?? "—"}</span>
                              <span><span className="text-ink-3">{t("commCreated")}:</span> {fmtDate(o.createdAt)}</span>
                              {o.sentAt && <span className="text-emerald-400">{t("commSent")}: {fmtDate(o.sentAt)}</span>}
                              {o.repliedAt && <span className="text-green-400">{t("commReplied")}: {fmtDate(o.repliedAt)}</span>}
                            </div>
                            {/* Engagement chips — at a glance: delivered / opened / replied / bounced / follow-ups */}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {o.deliveredAt && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">✓ {t("deliveredPill")}</span>
                              )}
                              {(o.openedAt || o.openCount > 0) && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/15 text-violet-300 border border-violet-500/25">
                                  👁 {t("openedPill")}{o.openCount > 1 ? ` ×${o.openCount}` : ""}
                                </span>
                              )}
                              {o.repliedAt && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/20 text-green-300 border border-green-500/30">💬 {t("repliedPill")}</span>
                              )}
                              {o.bouncedAt && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/15 text-red-300 border border-red-500/25">⚠ {t("bouncedPill")}</span>
                              )}
                              {o.followUpCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20">
                                  ↻ {t("followupPill")} ×{o.followUpCount}
                                </span>
                              )}
                            </div>
                            {(o.replyText || o.repliedAt) && (
                              <div className="mt-2 text-xs bg-green-900/15 border border-green-800/30 rounded-lg px-2.5 py-2">
                                <div className="flex items-center gap-1.5 text-green-300 font-medium mb-1">
                                  💬 {t("commReplied")}
                                  {o.replyFrom && <span className="text-green-400/60 font-normal">· {o.replyFrom}</span>}
                                </div>
                                {o.replySubject && <div className="text-green-200/90 font-medium mb-1">{o.replySubject}</div>}
                                {o.replyText && (
                                  <div className="text-green-100/70 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                                    {o.replyText}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* Placement pipeline — advance the application's stage.
                                Click the active stage again to clear it. */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                              <span className="text-[10px] text-ink-3 uppercase tracking-wide mr-0.5">{t("stageLabel")}:</span>
                              {PIPELINE_STAGES.map((s) => {
                                const isActive = o.match.status === s.key;
                                // Toggle off: clicking the active stage reverts to replied/sent base.
                                const target = isActive ? (o.repliedAt ? "REPLIED" : "SENT") : s.key;
                                const stageLabel = t(`pip${s.key}` as never);
                                return (
                                  <button
                                    key={s.key}
                                    onClick={() => setMatchStage(o.matchId, target)}
                                    title={isActive ? t("cancelStage") : stageLabel}
                                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors ${
                                      isActive ? s.active : "bg-card-2/40 text-ink-3 border-line-strong/50 hover:text-ink-2 hover:border-line-strong"
                                    }`}
                                  >
                                    {stageLabel}{isActive && <span className="ml-1 opacity-60">✕</span>}
                                  </button>
                                );
                              })}
                            </div>
                            {o.subject && <div className="mt-2 text-sm text-ink-2"><span className="text-ink-3 text-xs">{t("commSubject")}:</span> {o.subject}</div>}
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {o.match.vacancy.url && (
                              <a href={o.match.vacancy.url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:underline">🔗</a>
                            )}
                            <button onClick={() => setExpandedComm(expandedComm === o.id ? null : o.id)}
                              className="text-xs text-ink-2 hover:text-ink bg-card-2 hover:bg-line px-3 py-1.5 rounded-lg">
                              {expandedComm === o.id ? t("commHideMessage") : t("commViewMessage")}
                            </button>
                          </div>
                        </div>
                        {expandedComm === o.id && (
                          <div className="mt-3 pt-3 border-t border-line text-sm text-ink-2 whitespace-pre-wrap leading-relaxed bg-surface/50 rounded-lg p-3">
                            {o.draftBody}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Replies tab — only the employer responses received for this candidate */}
              {activeTab === "replies" && (() => {
                const replies = comms.filter((c) => c.repliedAt || c.status === "REPLIED");
                if (commsLoading) return <div className="text-ink-3 text-sm">{t("searching")}</div>;
                if (replies.length === 0) return (
                  <div className="bg-card border border-line rounded-2xl p-8 text-center">
                    <div className="text-ink-2 text-sm mb-2">{t("noRepliesYet")}</div>
                    <div className="text-ink-3 text-xs">{t("noRepliesHint2")}</div>
                  </div>
                );
                return (
                  <div className="space-y-3">
                    {replies.map((o) => (
                      <div key={o.id} className="bg-card border border-green-900/40 rounded-2xl p-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-ink">{o.match.employer.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/15 text-green-300 border border-green-500/25">💬 {t("replyShort")}</span>
                          <span className="text-xs text-ink-3 ml-auto">{fmtDate(o.repliedAt)}</span>
                        </div>
                        <div className="text-sm text-ink-2 mt-0.5">{o.match.vacancy.title}</div>
                        {o.replyFrom && <div className="text-xs text-ink-3 mt-1"><span className="text-ink-3">{t("fromLabel")}:</span> {o.replyFrom}</div>}
                        {o.replySubject && <div className="text-sm text-green-200/90 font-medium mt-2">{o.replySubject}</div>}
                        {o.replyText && (
                          <div className="mt-2 text-sm text-ink-2 whitespace-pre-wrap leading-relaxed bg-surface/50 rounded-lg p-3 max-h-72 overflow-y-auto">
                            {o.replyText}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Empty state */}
          {!selectedCandidate && !showForm && (
            <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-teal-600/20 border border-line flex items-center justify-center mb-4">
                <svg viewBox="0 0 24 24" className="w-7 h-7 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="text-ink font-semibold mb-1">{t("selectOrAdd")}</div>
              <div className="text-ink-3 text-sm mb-5 max-w-xs">{t("selectOrAddSub")}</div>
              <button onClick={startNewCandidate} className="btn btn-primary">
                {t("addFirst")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
