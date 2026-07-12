const DEFAULT_BASE = "https://mzcvai-production.up.railway.app";
const $ = (id) => document.getElementById(id);

function setStatus(msg) { $("status").textContent = msg; }

async function loadStored() {
  const { mzBaseUrl, mzCandidateId } = await chrome.storage.sync.get(["mzBaseUrl", "mzCandidateId"]);
  $("base").value = mzBaseUrl || DEFAULT_BASE;
  if (mzCandidateId) {
    const o = document.createElement("option");
    o.value = mzCandidateId; o.textContent = `(gespeichert) ${mzCandidateId}`; o.selected = true;
    $("cand").appendChild(o);
  }
}

async function loadCandidates() {
  const base = ($("base").value || DEFAULT_BASE).replace(/\/+$/, "");
  setStatus("Lade Kandidaten…");
  let data;
  try {
    const res = await fetch(`${base}/api/candidates`, { credentials: "include" });
    if (res.status === 401) { setStatus("Nicht eingeloggt — bitte in der MZ-App anmelden."); return; }
    if (!res.ok) { setStatus(`Fehler ${res.status}.`); return; }
    data = await res.json();
  } catch { setStatus("Keine Verbindung zur MZ-App."); return; }

  const list = Array.isArray(data) ? data : (data.candidates || data.data || []);
  const sel = $("cand");
  sel.innerHTML = "";
  for (const c of list) {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = `${c.name || c.id}${c.beruf ? " — " + c.beruf : ""}`;
    sel.appendChild(o);
  }
  setStatus(`${list.length} Kandidaten geladen.`);
}

async function save() {
  const mzBaseUrl = ($("base").value || DEFAULT_BASE).replace(/\/+$/, "");
  const mzCandidateId = $("cand").value;
  if (!mzCandidateId) { setStatus("Bitte einen Kandidaten wählen."); return; }
  await chrome.storage.sync.set({ mzBaseUrl, mzCandidateId });
  setStatus("Gespeichert ✓");
}

$("load").addEventListener("click", loadCandidates);
$("save").addEventListener("click", save);
loadStored();
