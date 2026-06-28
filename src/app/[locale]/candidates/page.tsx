"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BERUF_LIST, REGIONS_DE, GERMAN_LEVELS } from "@/lib/berufMap";
import TopNav from "../_components/TopNav";
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
  _count: { matches: number };
}

interface Match {
  id: string;
  fitScore: number;
  fitBreakdown: Record<string, number> | null;
  status: string;
  vacancy: { title: string; beruf: string; region: string; applyChannel: string; applyValue: string | null; url?: string | null; source?: string };
  employer: {
    name: string; city: string | null; region: string | null; stars: number | null;
    score: number; sponsorshipSignal: string; scoreBreakdown: Record<string, unknown> | null;
    genericEmail: string | null; applyFormUrl: string | null; website: string | null;
  };
  outreach: { id: string; status: string }[];
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
  repliedAt: string | null;
  match: {
    employer: { name: string; city: string | null; region: string | null; sponsorshipSignal: string };
    vacancy: { title: string; url: string | null; source: string };
  };
}

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

const SIGNAL_COLOR: Record<string, string> = {
  YES: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  LIKELY: "bg-blue-500/20 text-blue-300 border border-blue-500/40",
  UNKNOWN: "bg-gray-600/30 text-gray-400 border border-gray-600/40",
  NO: "bg-red-500/20 text-red-400 border border-red-500/40",
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-blue-500/20 text-blue-300 border border-blue-500/40",
  PENDING: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40",
  PLACED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  ARCHIVED: "bg-gray-600/30 text-gray-400 border border-gray-600/40",
};

const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, PENDING: 1, PLACED: 2, ARCHIVED: 3 };
const STATUS_OPTIONS = ["ACTIVE", "PENDING", "PLACED", "ARCHIVED"] as const;

const SCORE_COLOR = (s: number) =>
  s >= 80 ? "text-emerald-400" : s >= 60 ? "text-blue-400" : s >= 40 ? "text-yellow-400" : "text-gray-400";

const BLANK_FORM = {
  name: "", email: "", phone: "", beruf: "Housekeeping",
  regionPrefs: [] as string[], languages: [] as string[],
  needsSponsorship: true, visaStatus: "", notes: "",
  germanLevel: "A1",
  dateOfBirth: "", gender: "", nationality: "", maritalStatus: "",
  currentCity: "", currentCountry: "", address: "",
  desiredPosition: "", yearsExperience: "", salaryExpectation: "",
  availableFrom: "", willingToRelocate: true, drivingLicense: "",
  skills: "", certificates: "",
  status: "ACTIVE",
  experience: [] as ExperienceRow[],
  education: [] as EducationRow[],
};

const inputCls = "w-full bg-gray-800 text-white rounded px-3 py-2 text-sm mt-1 border border-transparent focus:border-blue-500 focus:outline-none";
const labelCls = "text-xs text-gray-500";
const cardCls = "bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3";
const sectionTitle = "text-sm font-semibold text-gray-400 uppercase tracking-wide";

export default function CandidatesPage() {
  const { locale } = useParams() as { locale: string };
  const t = useTranslations("candidates");
  const toast = useToast();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [activeTab, setActiveTab] = useState<"matches" | "comms">("matches");
  const [comms, setComms] = useState<OutreachItem[]>([]);
  const [commsLoading, setCommsLoading] = useState(false);
  const [expandedComm, setExpandedComm] = useState<string | null>(null);

  async function loadCandidates() {
    const { data } = await jsonFetch("/api/candidates");
    setCandidates((data.candidates as Candidate[]) ?? []);
  }

  async function loadMatches(id: string) {
    setMatchesLoading(true);
    const res = await fetch(`/api/candidates/${id}/matches`);
    const data = await res.json();
    setMatches(data.matches ?? []);
    setMatchesLoading(false);
  }

  async function loadComms(id: string) {
    setCommsLoading(true);
    const res = await fetch(`/api/candidates/${id}/outreach`);
    const data = await res.json();
    setComms(data.outreach ?? []);
    setCommsLoading(false);
  }

  useEffect(() => { loadCandidates(); }, []);

  function selectCandidate(id: string) {
    setSelectedId(id);
    setShowForm(false);
    setActiveTab("matches");
    setExpandedComm(null);
    loadMatches(id);
    loadComms(id);
  }

  function startNewCandidate() {
    setEditingId(null);
    setForm(BLANK_FORM);
    setSaveMsg(null);
    setCvFile(null);
    setExistingCvName(null);
    setSelectedId(null);
    setShowForm(true);
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
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = await res.json();
      if (data.ok) {
        toast(t("draftCreated"), "success");
        if (selectedId) { loadMatches(selectedId); loadComms(selectedId); }
      } else {
        toast(data.error ?? t("parseError"), "error");
      }
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
  async function sendAllOutreach() {
    if (!selectedId) return;
    if (!confirm(t("sendAllConfirm", { count: matches.length }))) return;
    setSendingAll(true);
    try {
      const { ok, data } = await jsonFetch(`/api/candidates/${selectedId}/send-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "bulk-send" }),
      });
      if (ok && data.ok) {
        toast(
          t("bulkResult", {
            sent: Number(data.sent ?? 0),
            skipped: Number(data.skippedNoEmail ?? 0) + Number(data.skippedCooldown ?? 0) + Number(data.alreadySent ?? 0),
          }),
          "success"
        );
        if (data.limitReached) toast(t("dailyLimitReached"), "info");
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
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <TopNav active="candidates" />

      {/* Sub-header */}
      <div className="border-b border-gray-800 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <span className="font-semibold text-white text-sm">{t("title")}</span>
        <button
          onClick={startNewCandidate}
          className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm px-3 sm:px-4 py-2 rounded-lg font-medium"
        >
          + <span className="hidden sm:inline">{t("newCandidate")}</span><span className="sm:hidden">{t("new")}</span>
        </button>
      </div>

      <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-110px)]">
        {/* Left — candidate list */}
        <div className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-gray-800 overflow-y-auto p-3 space-y-1 max-h-56 lg:max-h-none shrink-0">
          {/* Search + status filter / sort */}
          {candidates.length > 0 && (
            <div className="pb-2 mb-1 border-b border-gray-800 sticky top-0 bg-gray-950 z-10 space-y-2">
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">🔍</span>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="w-full bg-gray-900 text-white rounded-lg pl-7 pr-7 py-1.5 text-xs border border-gray-700 focus:border-blue-500 focus:outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white text-xs">✕</button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {["ALL", ...STATUS_OPTIONS].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-2 py-1 rounded text-[11px] font-medium ${statusFilter === s ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                  >
                    {s === "ALL" ? t("filterAll") : t(`status${s}`)}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-gray-600">{t("candidateCount", { shown: visibleCandidates.length, total: candidates.length })}</div>
            </div>
          )}
          {candidates.length === 0 && (
            <div className="text-gray-500 text-sm p-3">{t("noCandidates")}</div>
          )}
          {candidates.length > 0 && visibleCandidates.length === 0 && (
            <div className="text-gray-500 text-xs p-3">{t("noSearchResults")}</div>
          )}
          {visibleCandidates.map((c) => (
            <button
              key={c.id}
              onClick={() => selectCandidate(c.id)}
              className={`w-full text-left p-3 rounded-lg transition-colors ${selectedId === c.id ? "bg-blue-600/20 border border-blue-600/40" : "hover:bg-gray-800/50"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-white text-sm truncate">{c.name}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${STATUS_COLOR[c.status]}`}>{t(`status${c.status}`)}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{c.beruf} · {c.regionPrefs.join(", ") || t("anywhere")}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {t("matchCount", { count: c._count.matches })}
                {c.needsSponsorship && <span className="ml-2 text-yellow-500">{t("needsSponsorshipShort")}</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Right — form or match results */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">

          {/* Add candidate form */}
          {showForm && (
            <div className="max-w-3xl mx-auto lg:mx-0">
              <h2 className="text-lg font-bold text-white mb-5">{t("cvData")}</h2>

              {/* CV import → Claude auto-fills the form (PDF or pasted text) */}
              <div className="mb-4 bg-gradient-to-r from-blue-600/15 to-purple-600/15 border border-blue-600/30 rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">✨ {t("uploadCV")}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{t("uploadHint")}</div>
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
                      className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm px-4 py-2.5 rounded-lg font-medium disabled:opacity-60"
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
                      className="w-full bg-gray-900 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none resize-y"
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
                    <span className="text-gray-500">{t("noCvYet")}</span>
                  )}
                  <label className="cursor-pointer text-gray-400 hover:text-white underline">
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
                      <label className="text-xs text-gray-500 block mb-1.5">{t("statusLabel")}</label>
                      <div className="flex flex-wrap gap-2">
                        {STATUS_OPTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => set("status", s)}
                            className={`px-3 py-1.5 rounded text-xs font-medium border ${form.status === s ? STATUS_COLOR[s] : "bg-gray-800 text-gray-400 border-transparent hover:bg-gray-700"}`}
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
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-white">
                      <input type="checkbox" checked={form.needsSponsorship} onChange={(e) => set("needsSponsorship", e.target.checked)} className="w-4 h-4" />
                      {t("needsSponsorship")}
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-white">
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
                      <label className={labelCls}>{t("occupation")} * <span className="text-gray-600">({t("occupationManual")})</span></label>
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
                    <label className="text-xs text-gray-500 block mb-1.5">{t("preferredRegions")}</label>
                    <div className="flex flex-wrap gap-2">
                      {REGIONS_DE.map((r) => (
                        <button key={r} onClick={() => toggleArr("regionPrefs", r)} type="button"
                          className={`px-2.5 py-1.5 rounded text-xs font-medium ${form.regionPrefs.includes(r) ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
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
                  {form.experience.length === 0 && <div className="text-xs text-gray-600">{t("noExperience")}</div>}
                  {form.experience.map((exp, i) => (
                    <div key={i} className="bg-gray-800/40 rounded-lg p-3 space-y-2 relative">
                      <button type="button" onClick={() => delExp(i)} className="absolute top-2 right-2 text-gray-500 hover:text-red-400 text-xs">{t("delete")}</button>
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
                  {form.education.length === 0 && <div className="text-xs text-gray-600">{t("noEducation")}</div>}
                  {form.education.map((edu, i) => (
                    <div key={i} className="bg-gray-800/40 rounded-lg p-3 space-y-2 relative">
                      <button type="button" onClick={() => delEdu(i)} className="absolute top-2 right-2 text-gray-500 hover:text-red-400 text-xs">{t("delete")}</button>
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
                    <label className="text-xs text-gray-500 block mb-1.5">{t("otherLanguages")}</label>
                    <div className="flex flex-wrap gap-2">
                      {["az", "en", "ru", "tr", "ar", "uk", "fa"].map((l) => (
                        <button key={l} onClick={() => toggleArr("languages", l)} type="button"
                          className={`px-2.5 py-1.5 rounded text-xs font-medium uppercase ${form.languages.includes(l) ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
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
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2.5 rounded-lg text-sm">
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
              <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-900/30 border border-gray-800 rounded-2xl p-5 mb-5">
                <div className="flex items-start gap-4">
                  <div className={`shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarGradient(selectedCandidate.name)} flex items-center justify-center text-white font-bold text-lg shadow-lg`}>
                    {initials(selectedCandidate.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold text-white truncate">{selectedCandidate.name}</h2>
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLOR[selectedCandidate.status]}`}>{t(`status${selectedCandidate.status}`)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-gray-800 text-gray-200 border border-gray-700/60 font-medium">{selectedCandidate.beruf}</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-gray-800 text-gray-300 border border-gray-700/60">
                        {selectedCandidate.regionPrefs.length > 0 ? selectedCandidate.regionPrefs.join(", ") : t("allGermany")}
                      </span>
                      {selectedCandidate.languages.map((l) => (
                        <span key={l} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-gray-800 text-gray-400 border border-gray-700/60 uppercase">{l}</span>
                      ))}
                      {selectedCandidate.needsSponsorship && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30">★ {t("needsSponsorshipShort")}</span>
                      )}
                    </div>
                  </div>
                  <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
                    <select
                      value={selectedCandidate.status}
                      onChange={(e) => changeStatus(selectedCandidate.id, e.target.value)}
                      className="bg-gray-800 text-white text-xs rounded-lg px-2.5 py-1.5 border border-gray-700"
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(`status${s}`)}</option>)}
                    </select>
                    <div className="flex gap-1.5">
                      <button onClick={sendTestLetter} disabled={testLetterLoading} className="text-xs text-violet-300 hover:text-violet-200 bg-violet-900/20 hover:bg-violet-900/40 disabled:opacity-50 px-3 py-1.5 rounded-lg">{testLetterLoading ? t("preparing") : t("testLetter")}</button>
                      <button onClick={() => startEdit(selectedCandidate.id)} className="text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg">{t("edit")}</button>
                      <button onClick={() => deleteCandidate(selectedCandidate.id)} className="text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 px-3 py-1.5 rounded-lg">{t("deleteCandidate")}</button>
                    </div>
                  </div>
                </div>
                {/* Quick stats */}
                <div className="flex items-center gap-6 mt-4 pt-4 border-t border-gray-800">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-emerald-400">{matches.length}</span>
                    <span className="text-xs text-gray-500">{t("statMatches")}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-blue-400">{comms.filter((c) => c.status === "SENT" || c.sentAt).length}</span>
                    <span className="text-xs text-gray-500">{t("statSent")}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-amber-400">{comms.filter((c) => c.status === "DRAFT").length}</span>
                    <span className="text-xs text-gray-500">{t("draft")}</span>
                  </div>
                  {/* Mobile actions */}
                  <div className="sm:hidden ml-auto flex gap-1.5">
                    <button onClick={() => startEdit(selectedCandidate.id)} className="text-xs text-gray-300 bg-gray-800 px-3 py-1.5 rounded-lg">{t("edit")}</button>
                    <button onClick={() => deleteCandidate(selectedCandidate.id)} className="text-xs text-red-400 bg-red-900/20 px-3 py-1.5 rounded-lg">✕</button>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-gray-800 mb-4">
                {([["matches", t("tabMatches"), matches.length], ["comms", t("tabComms"), comms.length]] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === key ? "text-white" : "text-gray-500 hover:text-gray-300"}`}
                  >
                    {label}
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${activeTab === key ? "bg-blue-600/30 text-blue-200" : "bg-gray-800 text-gray-500"}`}>{count}</span>
                    {activeTab === key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
                  </button>
                ))}
              </div>

              {/* Matches tab */}
              {activeTab === "matches" && (
                matchesLoading ? (
                  <div className="text-gray-500 text-sm">{t("searching")}</div>
                ) : matches.length === 0 ? (
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
                    <div className="text-gray-400 text-sm mb-3">{t("noVacancyTitle")}</div>
                    <div className="text-gray-500 text-xs">{t("noVacancyHint")}</div>
                  </div>
                ) : (
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                      <div className="text-sm text-gray-400">
                        <span className="text-white font-bold text-lg">{matches.length}</span> {t("found")}
                      </div>
                      <button
                        onClick={sendAllOutreach}
                        disabled={sendingAll}
                        className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg font-medium inline-flex items-center justify-center gap-2"
                      >
                        {sendingAll ? (
                          <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> {t("sendingAll")}</>
                        ) : (
                          <>✉️ {t("sendAll")}</>
                        )}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {matches.map((m) => {
                        const jobLink = m.vacancy.url
                          || (m.vacancy.applyValue && /^https?:\/\//.test(m.vacancy.applyValue) ? m.vacancy.applyValue : null);
                        return (
                          <div key={m.id} className="group bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-2xl p-4 transition-colors">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-white">{m.employer.name}</span>
                                  {m.employer.stars && <span className="text-amber-400 text-xs">{"★".repeat(m.employer.stars)}</span>}
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SIGNAL_COLOR[m.employer.sponsorshipSignal]}`}>
                                    {m.employer.sponsorshipSignal === "YES" ? t("sponsorshipYes") :
                                      m.employer.sponsorshipSignal === "LIKELY" ? t("sponsorshipLikely") :
                                        m.employer.sponsorshipSignal === "NO" ? t("sponsorshipNo") : t("sponsorshipUnknown")}
                                  </span>
                                  {m.vacancy.source && <span className="text-[10px] text-gray-600 uppercase tracking-wide">{m.vacancy.source}</span>}
                                </div>
                                <div className="text-sm text-gray-400 mt-0.5">
                                  {m.employer.city}, {m.employer.region} · {m.vacancy.title}
                                </div>

                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-500 w-24">{t("totalScore")}</span>
                                    <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                                      <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${m.employer.score}%` }} />
                                    </div>
                                    <span className={`font-bold w-6 text-right ${SCORE_COLOR(m.employer.score)}`}>{m.employer.score}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-500 w-24">{t("fitScore")}</span>
                                    <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                                      <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${m.fitScore}%` }} />
                                    </div>
                                    <span className={`font-bold w-6 text-right ${SCORE_COLOR(m.fitScore)}`}>{m.fitScore}</span>
                                  </div>
                                </div>

                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                                  {jobLink && (
                                    <a href={jobLink} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 bg-blue-600/15 text-blue-300 border border-blue-600/30 hover:bg-blue-600/25 px-2.5 py-1 rounded-md font-medium">
                                      🔗 {t("jobListing")}
                                    </a>
                                  )}
                                  {m.employer.genericEmail && <span>📧 {m.employer.genericEmail}</span>}
                                  {m.employer.website && (
                                    <a href={m.employer.website.startsWith("http") ? m.employer.website : `https://${m.employer.website}`}
                                      target="_blank" rel="noopener noreferrer"
                                      className="text-blue-400 hover:underline truncate max-w-[200px]">{m.employer.website}</a>
                                  )}
                                </div>
                              </div>

                              <div className="shrink-0 sm:text-right">
                                {m.outreach.length > 0 ? (
                                  <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium ${OUTREACH_COLOR[m.outreach[0].status] ?? "bg-gray-700 text-gray-300"}`}>
                                    {m.outreach[0].status}
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
                                    {!m.employer.genericEmail && (
                                      <span className="text-[10px] text-gray-500 text-right">{t("formOnly")}</span>
                                    )}
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
                  <div className="text-gray-500 text-sm">{t("searching")}</div>
                ) : comms.length === 0 ? (
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
                    <div className="text-gray-400 text-sm mb-2">{t("noOutreach")}</div>
                    <div className="text-gray-500 text-xs">{t("noOutreachHint")}</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {comms.map((o) => (
                      <div key={o.id} className="relative bg-gray-900 border border-gray-800 rounded-2xl pl-5 pr-4 py-4 overflow-hidden">
                        {/* status spine */}
                        <span className={`absolute left-0 top-0 bottom-0 w-1 ${OUTREACH_DOT[o.status] ?? "bg-gray-600"}`} />
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-white">{o.match.employer.name}</span>
                              <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${OUTREACH_COLOR[o.status] ?? "bg-gray-700 text-gray-300"}`}>{o.status}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${SIGNAL_COLOR[o.match.employer.sponsorshipSignal]}`}>{o.match.employer.sponsorshipSignal}</span>
                            </div>
                            <div className="text-sm text-gray-400 mt-0.5">{o.match.vacancy.title}</div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                              <span><span className="text-gray-600">{t("commTo")}:</span> {o.toAddress ?? "—"}</span>
                              <span><span className="text-gray-600">{t("commCreated")}:</span> {fmtDate(o.createdAt)}</span>
                              {o.sentAt && <span className="text-emerald-400">{t("commSent")}: {fmtDate(o.sentAt)}</span>}
                              {o.repliedAt && <span className="text-green-400">{t("commReplied")}: {fmtDate(o.repliedAt)}</span>}
                            </div>
                            {o.subject && <div className="mt-2 text-sm text-gray-300"><span className="text-gray-600 text-xs">{t("commSubject")}:</span> {o.subject}</div>}
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {o.match.vacancy.url && (
                              <a href={o.match.vacancy.url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:underline">🔗</a>
                            )}
                            <button onClick={() => setExpandedComm(expandedComm === o.id ? null : o.id)}
                              className="text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg">
                              {expandedComm === o.id ? t("commHideMessage") : t("commViewMessage")}
                            </button>
                          </div>
                        </div>
                        {expandedComm === o.id && (
                          <div className="mt-3 pt-3 border-t border-gray-800 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed bg-gray-950/50 rounded-lg p-3">
                            {o.draftBody}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}

          {/* Empty state */}
          {!selectedCandidate && !showForm && (
            <div className="flex flex-col items-center justify-center h-full min-h-[40vh] text-center">
              <div className="text-gray-500 text-sm mb-4">{t("selectOrAdd")}</div>
              <button onClick={startNewCandidate}
                className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
                {t("addFirst")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
