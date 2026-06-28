// Upload the test CV PDF to the parse-cv endpoint and print the parsed JSON.
import fs from "fs";

const pdfPath = "C:/Users/LOQ/AppData/Local/Temp/claude/C--Users-LOQ-Desktop-mzaicv/a8205b8a-aedb-474b-bbd9-56d2874c5b18/scratchpad/test-cv.pdf";
const buf = fs.readFileSync(pdfPath);
const blob = new Blob([buf], { type: "application/pdf" });
const fd = new FormData();
fd.append("file", blob, "test-cv.pdf");

const res = await fetch("http://localhost:3000/api/candidates/parse-cv", { method: "POST", body: fd });
const json = await res.json();
console.log("HTTP", res.status);
console.log(JSON.stringify(json, null, 2));
