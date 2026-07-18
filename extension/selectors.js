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
  nationalitaet: { names: ["nationalitaet", "nationality", "staatsangehoerigkeit"], labels: ["Nationalität", "Staatsangehörigkeit", "Nationality"] },
  adresse:       { names: ["adresse", "address", "strasse", "street"], labels: ["Adresse", "Straße", "Anschrift", "Address"] },
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
