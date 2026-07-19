/**
 * Field → matcher map for German application forms. Each field lists candidate
 * input `names` (matched against name/id), `types`, and visible `labels`
 * (matched against placeholder / aria-label / associated <label> text).
 * content.js resolves each field to an input using these hints.
 *
 * Per-platform overrides can be layered on top by extending window.MZ_SELECTORS
 * before content.js runs (see README → Platform overrides).
 */
window.MZ_SELECTORS = {
  anrede:        { names: ["anrede", "salutation", "title"], labels: ["Anrede", "Salutation"], select: true },
  vorname:       { names: ["vorname", "firstname", "first_name", "given-name", "fname"], labels: ["Vorname", "First name"] },
  nachname:      { names: ["nachname", "lastname", "last_name", "surname", "family-name", "lname"], labels: ["Nachname", "Last name", "Familienname"] },
  name:          { names: ["fullname", "full_name", "name"], labels: ["Name", "Vollständiger Name"] },
  email:         { names: ["email", "e-mail", "mail"], types: ["email"], labels: ["E-Mail", "Email", "E-Mail-Adresse"] },
  telefon:       { names: ["telefon", "phone", "tel", "mobile", "handy"], types: ["tel"], labels: ["Telefon", "Phone", "Mobil", "Handy", "Rufnummer"] },
  geburtsdatum:  { names: ["geburtsdatum", "birthdate", "dob", "birthday"], types: ["date"], labels: ["Geburtsdatum", "Date of birth"] },
  starttermin:   { names: ["starttermin", "eintrittsdatum", "verfuegbar", "verfügbar", "startdate", "availablefrom"], labels: ["Frühestmöglicher Starttermin", "Starttermin", "Eintrittsdatum", "Verfügbar ab", "Earliest start", "Start date"] },
  nationalitaet: { names: ["nationalitaet", "nationality", "staatsangehoerigkeit"], labels: ["Nationalität", "Staatsangehörigkeit", "Nationality"] },
  adresse:       { names: ["adresse", "address", "strasse", "street"], labels: ["Adresse", "Straße", "Anschrift", "Address"] },
  // Desired work location — listed BEFORE `ort` so it claims a "Gewünschter
  // Anstellungsort" field instead of the current-city value grabbing it.
  anstellungsort:{ names: ["anstellungsort", "arbeitsort", "einsatzort", "wunschort", "worklocation"], labels: ["Gewünschter Anstellungsort", "Anstellungsort", "Arbeitsort", "Einsatzort", "Desired location"] },
  ort:           { names: ["ort", "city", "stadt", "wohnort"], labels: ["Ort", "Stadt", "Wohnort", "City"] },
  land:          { names: ["land", "country", "staat"], labels: ["Land", "Country"], select: true },
  beruf:         { names: ["beruf", "position", "jobtitle", "job_title", "taetigkeit"], labels: ["Beruf", "Position", "Tätigkeit", "Berufsbezeichnung"] },
  deutschniveau: { names: ["deutsch", "german", "sprachniveau"], labels: ["Deutschkenntnisse", "Deutsch", "German level"] },
  // Salary + legal-status fields ATS forms (Jobylon, Personio…) commonly ask for.
  // Filled only when the candidate record holds the value (content.js skips empty).
  gehaltswunsch:    { names: ["gehalt", "salary", "gehaltswunsch", "gehaltsvorstellung", "compensation"], labels: ["Gehaltswunsch", "Gehaltsvorstellung", "Gehalt", "Salary", "Salary expectation"] },
  aufenthaltstitel: { names: ["aufenthalt", "aufenthaltstitel", "residence", "residencepermit"], labels: ["Aufenthaltstitel", "Aufenthaltsstatus", "Aufenthalt", "Residence permit", "Residence title"] },
  arbeitserlaubnis: { names: ["arbeitserlaubnis", "arbeitsgenehmigung", "workpermit", "work_permit"], labels: ["Arbeitserlaubnis", "Arbeitsgenehmigung", "Work permit"] },
  fuehrerschein:    { names: ["fuehrerschein", "führerschein", "driverlicense", "drivinglicense", "fuehrerscheinklasse"], labels: ["Führerschein", "Fahrerlaubnis", "Driving license", "Driver's license"] },
  // Working time = full-time. The agency places FULL-TIME candidates only, so on
  // a "how many hours per week?" RADIO group the Vollzeit / full-time option is
  // always the right answer (a business fact, not a guess). Distinctive label so
  // it never selects a part-time option.
  arbeitszeitVollzeit: { radio: true, names: ["vollzeit", "fulltime"], labels: ["40h/Vollzeit", "Vollzeit", "full time", "full-time", "40h", "40 h"] },
  // Same "valid work permit" question, but as a CHECKBOX (Personio-style forms).
  // Ticked only when the candidate is work-authorised (see prefill API) — never
  // guessed. A distinct key so it targets the checkbox, not the free-text field.
  arbeitserlaubnisJa: { checkbox: true, names: ["arbeitserlaubnis", "arbeitsgenehmigung", "workpermit", "work_permit"], labels: ["Gültige Arbeitserlaubnis", "Arbeitserlaubnis", "Arbeitsgenehmigung", "Work permit"] },
};

// File input for the CV / Lebenslauf.
window.MZ_FILE_MATCH = {
  names: ["lebenslauf", "cv", "resume", "datei", "anhang", "upload", "file", "dokument"],
  labels: ["Lebenslauf", "CV", "Anhang", "Datei", "Dokument", "Bewerbungsunterlagen"],
};

// ---- Platform overrides -----------------------------------------------------
// hotelcareer.de (StepStone) uses a quick-apply form whose inputs have NO labels
// or placeholders — only opaque, site-wide property ids (bewdata[PROP_xx]). Map
// each id to the right field so the form is recognised. (The fill is also scoped
// to the application <form> in content.js, so the page's search/login boxes are
// left untouched.)
(function () {
  if (!/(^|\.)hotelcareer\.de$/i.test(location.hostname)) return;
  const S = window.MZ_SELECTORS;
  const add = (key, id) => { if (S[key] && S[key].names) S[key].names.push(id); };
  add("anrede", "prop_95");
  add("vorname", "prop_88");
  add("nachname", "prop_84");
  add("email", "prop_31");
  add("telefon", "prop_39");
  add("beruf", "prop_96");
})();
