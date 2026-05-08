// ── ImportCSVModal.jsx ────────────────────────────────────────────────
// Drop-in replacement for the placeholder import modal in HawkeyeCRM.
// Paste this component into your App.jsx (or a separate file and import it).
// Then replace the existing modal?.type==="import" block with:
//   {modal?.type==="import" && <ImportCSVModal onClose={closeModal} supabase={supabase} onImportComplete={(count) => { loadData(); toast(`${count} contacts imported`); closeModal(); }} />}

import { useState, useRef, useCallback } from "react";

const REQUIRED_HEADERS = ["Company", "Contact Name"];
const VALID_STAGES = ["New Lead","Researched","Contacted","Follow-up Due","Meeting Booked","Proposal Sent","Won / Active","Lost / Dead"];
const VALID_SIZES  = ["1-10","11-50","51-200","200+"];
const VALID_SOURCES = ["Scraped","LinkedIn","Framework","Referral","Inbound","Other"];

// Maps CSV column names → Supabase DB column names
const COLUMN_MAP = {
  "Company":          "company",
  "Contact Name":     "contact_name",
  "Title":            "title",
  "Email":            "email",
  "Phone":            "phone",
  "LinkedIn":         "linkedin",
  "Location":         "location",
  "Company Size":     "company_size",
  "Website":          "website",
  "Industry":         "industry",
  "Stage":            "stage",
  "Source":           "source",
  "Current Supplier": "current_supplier",
  "Contract End":     "contract_end",
  "Frameworks":       "frameworks",
  "Tags":             "tags",
};

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  // Parse a single CSV line respecting quoted fields
  const parseLine = (line) => {
    const result = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQuotes) { inQuotes = true; continue; }
      if (ch === '"' && inQuotes) {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
        continue;
      }
      if (ch === "," && !inQuotes) { result.push(field.trim()); field = ""; continue; }
      field += ch;
    }
    result.push(field.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(l => {
    const vals = parseLine(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  });

  return { headers, rows };
}

function validateRow(row, index) {
  const errors = [];
  if (!row["Company"]?.trim())       errors.push("Missing Company");
  if (!row["Contact Name"]?.trim())  errors.push("Missing Contact Name");
  if (row["Stage"] && !VALID_STAGES.includes(row["Stage"]))
    errors.push(`Invalid Stage: "${row["Stage"]}"`);
  if (row["Company Size"] && !VALID_SIZES.includes(row["Company Size"]))
    errors.push(`Invalid Company Size: "${row["Company Size"]}"`);
  if (row["Email"] && !row["Email"].includes("@"))
    errors.push(`Invalid email format`);
  return errors;
}

function rowToDbRecord(row) {
  // Parse pipe-separated array fields
  const toArr = (val) => val ? val.split("|").map(s => s.trim()).filter(Boolean) : [];

  return {
    company:          row["Company"]?.trim() || "",
    contact_name:     row["Contact Name"]?.trim() || "",
    title:            row["Title"]?.trim() || null,
    email:            row["Email"]?.trim() || null,
    phone:            row["Phone"]?.trim() || null,
    linkedin:         row["LinkedIn"]?.trim() || null,
    location:         row["Location"]?.trim() || null,
    company_size:     VALID_SIZES.includes(row["Company Size"]) ? row["Company Size"] : null,
    website:          row["Website"]?.trim() || null,
    industry:         row["Industry"]?.trim() || null,
    stage:            VALID_STAGES.includes(row["Stage"]) ? row["Stage"] : "New Lead",
    source:           VALID_SOURCES.includes(row["Source"]) ? row["Source"] : "Scraped",
    current_supplier: row["Current Supplier"]?.trim() || null,
    contract_end:     row["Contract End"]?.trim() || null,
    frameworks:       toArr(row["Frameworks"]),
    tags:             toArr(row["Tags"]),
    assigned_to:      "You",
    follow_up_date:   null,
  };
}

// ── Styles (matching HawkeyeCRM exactly) ─────────────────────────────
const btnStyle = { fontSize:12, padding:"6px 12px", borderRadius:7, border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-primary)", color:"var(--color-text-primary)", cursor:"pointer", fontFamily:"inherit" };
const btnPrimary = { ...btnStyle, background:"#185FA5", color:"white", border:"none" };

export default function ImportCSVModal({ onClose, supabase, onImportComplete }) {
  const [step, setStep]           = useState("drop");   // drop | preview | importing | done
  const [fileName, setFileName]   = useState("");
  const [headers, setHeaders]     = useState([]);
  const [rows, setRows]           = useState([]);
  const [validationMap, setValidationMap] = useState({});  // index → [errors]
  const [isDragging, setIsDragging] = useState(false);
  const [importResult, setImportResult] = useState(null);  // { added, skipped, errors }
  const [importProgress, setImportProgress] = useState(0);
  const fileInputRef = useRef();

  const processFile = useCallback((file) => {
    if (!file || !file.name.endsWith(".csv")) {
      alert("Please upload a .csv file.");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers, rows } = parseCSV(e.target.result);
      const missingRequired = REQUIRED_HEADERS.filter(h => !headers.includes(h));
      if (missingRequired.length > 0) {
        alert(`CSV is missing required columns: ${missingRequired.join(", ")}\n\nFirst row must have exact column names — see the handoff doc for the full list.`);
        return;
      }
      // Validate all rows
      const vmap = {};
      rows.forEach((row, i) => {
        const errs = validateRow(row, i);
        if (errs.length > 0) vmap[i] = errs;
      });
      setHeaders(headers);
      setRows(rows);
      setValidationMap(vmap);
      setStep("preview");
    };
    reader.readAsText(file, "UTF-8");
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  }, [processFile]);

  const handleFileInput = (e) => processFile(e.target.files[0]);

  const validRows   = rows.filter((_, i) => !validationMap[i]);
  const invalidRows = rows.filter((_, i) =>  validationMap[i]);
  const previewRows = rows.slice(0, 5);

  const runImport = async () => {
    setStep("importing");
    setImportProgress(0);

    const toInsert = validRows.map(rowToDbRecord);
    const BATCH = 50;
    let added = 0, skipped = 0, errors = 0;

    // Fetch existing emails + names to detect duplicates
    const { data: existing } = await supabase.from("contacts").select("email, company, contact_name");
    const existingEmails = new Set((existing || []).map(c => c.email?.toLowerCase()).filter(Boolean));
    const existingNames  = new Set((existing || []).map(c => `${c.company?.toLowerCase()}|${c.contact_name?.toLowerCase()}`));

    const deduped = [];
    for (const rec of toInsert) {
      const emailKey = rec.email?.toLowerCase();
      const nameKey  = `${rec.company?.toLowerCase()}|${rec.contact_name?.toLowerCase()}`;
      if ((emailKey && existingEmails.has(emailKey)) || existingNames.has(nameKey)) {
        skipped++;
      } else {
        deduped.push(rec);
        if (emailKey) existingEmails.add(emailKey);
        existingNames.add(nameKey);
      }
    }

    // Insert in batches
    for (let i = 0; i < deduped.length; i += BATCH) {
      const batch = deduped.slice(i, i + BATCH);
      const { error } = await supabase.from("contacts").insert(batch);
      if (error) { errors += batch.length; }
      else        { added  += batch.length; }
      setImportProgress(Math.round(((i + batch.length) / deduped.length) * 100));
    }

    setImportResult({ added, skipped: skipped + invalidRows.length, errors });
    setStep("done");
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--color-background-primary)", borderRadius:12, border:"1px solid var(--color-border-tertiary)", boxShadow:"0 8px 40px rgba(0,0,0,0.18)", width:"100%", maxWidth:640, maxHeight:"88vh", overflowY:"auto", padding:24 }}>

        {/* ── Step 1: Drop zone ── */}
        {step === "drop" && (
          <>
            <div style={{ fontSize:15, fontWeight:500, marginBottom:4 }}>Import contacts from CSV</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:18 }}>
              Upload a CSV exported from a scraper or framework list. Required columns: <strong>Company</strong>, <strong>Contact Name</strong>.
            </div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{ border:`2px dashed ${isDragging ? "#185FA5" : "var(--color-border-secondary)"}`, borderRadius:10, padding:"40px 24px", textAlign:"center", cursor:"pointer", background: isDragging ? "#E6F1FB" : "var(--color-background-secondary)", transition:"all 0.15s" }}
            >
              <div style={{ fontSize:24, marginBottom:8 }}>📂</div>
              <div style={{ fontSize:13, fontWeight:500, marginBottom:4 }}>Drop your CSV here</div>
              <div style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>or click to browse — UTF-8 .csv only</div>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileInput} style={{ display:"none" }} />

            {/* Column reference */}
            <div style={{ marginTop:18, background:"var(--color-background-secondary)", borderRadius:8, padding:"12px 14px" }}>
              <div style={{ fontSize:11, fontWeight:500, marginBottom:7, color:"var(--color-text-secondary)" }}>EXPECTED COLUMN HEADERS</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {Object.keys(COLUMN_MAP).map(h => (
                  <span key={h} style={{ fontSize:10, padding:"2px 8px", borderRadius:8, background: REQUIRED_HEADERS.includes(h) ? "#185FA5" : "var(--color-background-primary)", color: REQUIRED_HEADERS.includes(h) ? "white" : "var(--color-text-secondary)", border:"0.5px solid var(--color-border-secondary)" }}>{h}</span>
                ))}
              </div>
              <div style={{ fontSize:10, color:"var(--color-text-tertiary)", marginTop:8 }}>Blue = required. Frameworks and Tags use pipe separator |</div>
            </div>

            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16 }}>
              <button style={btnStyle} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {/* ── Step 2: Preview & validate ── */}
        {step === "preview" && (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
              <div style={{ fontSize:15, fontWeight:500 }}>Preview — {fileName}</div>
            </div>

            {/* Summary bar */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:16 }}>
              {[
                { label:"Total rows", value:rows.length, color:"var(--color-text-primary)" },
                { label:"Ready to import", value:validRows.length, color:"#0F6E56" },
                { label:"Will be skipped", value:invalidRows.length, color: invalidRows.length > 0 ? "#A32D2D" : "var(--color-text-tertiary)" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background:"var(--color-background-secondary)", borderRadius:8, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:"var(--color-text-secondary)", marginBottom:2 }}>{label}</div>
                  <div style={{ fontSize:20, fontWeight:500, color }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Validation errors */}
            {invalidRows.length > 0 && (
              <div style={{ background:"#FCEBEB", border:"0.5px solid #F09595", borderRadius:8, padding:"10px 12px", marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:500, color:"#791F1F", marginBottom:6 }}>
                  {invalidRows.length} row{invalidRows.length > 1 ? "s" : ""} have validation errors and will be skipped:
                </div>
                {Object.entries(validationMap).slice(0, 5).map(([i, errs]) => (
                  <div key={i} style={{ fontSize:11, color:"#A32D2D", marginBottom:2 }}>
                    Row {+i + 2}: {rows[i]["Company"] || "(no company)"} — {errs.join(", ")}
                  </div>
                ))}
                {Object.keys(validationMap).length > 5 && (
                  <div style={{ fontSize:11, color:"#A32D2D", marginTop:2 }}>…and {Object.keys(validationMap).length - 5} more</div>
                )}
              </div>
            )}

            {/* Detected columns */}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:6 }}>DETECTED COLUMNS ({headers.length})</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {headers.map(h => {
                  const mapped = COLUMN_MAP[h];
                  return (
                    <span key={h} style={{ fontSize:10, padding:"2px 8px", borderRadius:8, background: mapped ? "#E1F5EE" : "#FAEEDA", color: mapped ? "#085041" : "#633806", border:`0.5px solid ${mapped ? "#5DCAA5" : "#EF9F27"}` }}>
                      {h}{mapped ? "" : " ⚠ unrecognised"}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Data preview table */}
            <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:6 }}>
              FIRST {Math.min(5, rows.length)} ROWS
            </div>
            <div style={{ overflowX:"auto", borderRadius:8, border:"0.5px solid var(--color-border-tertiary)", marginBottom:18 }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                <thead>
                  <tr style={{ background:"var(--color-background-secondary)" }}>
                    <th style={{ padding:"6px 10px", textAlign:"left", fontWeight:500, color:"var(--color-text-secondary)", whiteSpace:"nowrap", borderBottom:"0.5px solid var(--color-border-tertiary)", width:24 }}>#</th>
                    {["Company","Contact Name","Title","Email","Stage","Source","Frameworks"].filter(h => headers.includes(h)).map(h => (
                      <th key={h} style={{ padding:"6px 10px", textAlign:"left", fontWeight:500, color:"var(--color-text-secondary)", whiteSpace:"nowrap", borderBottom:"0.5px solid var(--color-border-tertiary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => {
                    const hasError = !!validationMap[i];
                    return (
                      <tr key={i} style={{ background: hasError ? "#FCEBEB" : "transparent", borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
                        <td style={{ padding:"6px 10px", color:"var(--color-text-tertiary)" }}>{i + 2}</td>
                        {["Company","Contact Name","Title","Email","Stage","Source","Frameworks"].filter(h => headers.includes(h)).map(h => (
                          <td key={h} style={{ padding:"6px 10px", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color: hasError ? "#A32D2D" : "var(--color-text-primary)" }}>
                            {row[h] || <span style={{ color:"var(--color-text-tertiary)" }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <button style={btnStyle} onClick={() => setStep("drop")}>← Back</button>
              <div style={{ display:"flex", gap:8 }}>
                <button style={btnStyle} onClick={onClose}>Cancel</button>
                <button
                  style={{ ...btnPrimary, opacity: validRows.length === 0 ? 0.5 : 1 }}
                  disabled={validRows.length === 0}
                  onClick={runImport}
                >
                  Import {validRows.length} contact{validRows.length !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Step 3: Importing progress ── */}
        {step === "importing" && (
          <div style={{ textAlign:"center", padding:"32px 0" }}>
            <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>Importing contacts…</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:20 }}>Please wait — inserting into Supabase</div>
            <div style={{ background:"var(--color-background-secondary)", borderRadius:99, height:8, width:"100%", overflow:"hidden", marginBottom:12 }}>
              <div style={{ height:"100%", background:"#185FA5", borderRadius:99, width:`${importProgress}%`, transition:"width 0.3s ease" }} />
            </div>
            <div style={{ fontSize:12, color:"var(--color-text-tertiary)" }}>{importProgress}%</div>
          </div>
        )}

        {/* ── Step 4: Done summary ── */}
        {step === "done" && importResult && (
          <>
            <div style={{ fontSize:15, fontWeight:500, marginBottom:16 }}>Import complete</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:20 }}>
              {[
                { label:"Contacts added", value:importResult.added, color:"#0F6E56", bg:"#E1F5EE" },
                { label:"Skipped (duplicate / invalid)", value:importResult.skipped, color:"#633806", bg:"#FAEEDA" },
                { label:"Errors", value:importResult.errors, color: importResult.errors > 0 ? "#A32D2D" : "var(--color-text-tertiary)", bg: importResult.errors > 0 ? "#FCEBEB" : "var(--color-background-secondary)" },
              ].map(({ label, value, color, bg }) => (
                <div key={label} style={{ background:bg, borderRadius:8, padding:"12px 14px" }}>
                  <div style={{ fontSize:10, color, opacity:0.8, marginBottom:3 }}>{label}</div>
                  <div style={{ fontSize:24, fontWeight:500, color }}>{value}</div>
                </div>
              ))}
            </div>

            {importResult.added > 0 && (
              <div style={{ background:"#E1F5EE", border:"0.5px solid #5DCAA5", borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:12, color:"#085041" }}>
                ✓ {importResult.added} new contact{importResult.added !== 1 ? "s" : ""} added to your pipeline as <strong>New Lead</strong>. Head to the Pipeline or Contacts view to start qualifying them.
              </div>
            )}

            {importResult.skipped > 0 && (
              <div style={{ background:"#FAEEDA", border:"0.5px solid #EF9F27", borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:12, color:"#633806" }}>
                {importResult.skipped} row{importResult.skipped !== 1 ? "s" : ""} skipped — either duplicate (matched by email or company + contact name) or failed validation.
              </div>
            )}

            <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
              {importResult.added > 0 && (
                <button style={btnPrimary} onClick={() => onImportComplete(importResult.added)}>
                  View contacts →
                </button>
              )}
              <button style={btnStyle} onClick={onClose}>Close</button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
