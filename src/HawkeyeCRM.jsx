import { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import ImportCSVModal from "./ImportCSVModal";

// ── Palette & helpers ────────────────────────────────────────────────
const STAGES = ["New Lead","Researched","Contacted","Follow-up Due","Meeting Booked","Proposal Sent","Won / Active","Lost / Dead"];
const SOURCES = ["Scraped","LinkedIn","Framework","Award Notice","Referral","Inbound","Other"];
const FRAMEWORKS = ["CCS RM6277","CCS RM6290","CCS RM6376","YPO","ESPO","Crown Commercial","G-Cloud","Other"];
const ACTIVITY_TYPES = ["Email","Call","LinkedIn","Meeting","Note"];
const TAGS_PRESET = ["warm","key target","re-engage","do not contact","decision maker","framework"];
const WIN_LOSS_REASONS = {
  "Won / Active": ["Best value","Strong relationship","Framework position","Timing","Referral"],
  "Lost / Dead":  ["Price too high","Went with incumbent","No response","Bad timing","Out of scope"]
};

const STAGE_STYLE = {
  "New Lead":        { bg:"#E6F1FB", color:"#0C447C" },
  "Researched":      { bg:"#EEEDFE", color:"#3C3489" },
  "Contacted":       { bg:"#FAEEDA", color:"#633806" },
  "Follow-up Due":   { bg:"#FCEBEB", color:"#791F1F" },
  "Meeting Booked":  { bg:"#EAF3DE", color:"#27500A" },
  "Proposal Sent":   { bg:"#FBEAF0", color:"#72243E" },
  "Won / Active":    { bg:"#E1F5EE", color:"#085041" },
  "Lost / Dead":     { bg:"#F1EFE8", color:"#444441" },
};
const ACT_STYLE = {
  Email:    { bg:"#FAEEDA", color:"#633806", abbr:"Em" },
  Call:     { bg:"#E6F1FB", color:"#0C447C", abbr:"Ca" },
  LinkedIn: { bg:"#EEEDFE", color:"#3C3489", abbr:"Li" },
  Meeting:  { bg:"#EAF3DE", color:"#27500A", abbr:"Mt" },
  Note:     { bg:"#F1EFE8", color:"#444441", abbr:"No" },
};
const AV_COLORS = [
  {bg:"#E6F1FB",color:"#0C447C"},{bg:"#EEEDFE",color:"#3C3489"},
  {bg:"#E1F5EE",color:"#085041"},{bg:"#FAEEDA",color:"#633806"},
  {bg:"#EAF3DE",color:"#27500A"},{bg:"#FBEAF0",color:"#72243E"},
];
function avColor(name){ return AV_COLORS[(name||"").charCodeAt(0)%AV_COLORS.length]; }
function initials(name){ return (name||"").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase(); }
function daysAgo(dateStr){
  if(!dateStr) return null;
  const d = Math.floor((Date.now()-new Date(dateStr))/(1000*60*60*24));
  if(d===0) return "Today"; if(d===1) return "Yesterday"; if(d<0) return `In ${-d}d`;
  return `${d}d ago`;
}
function isOverdue(dateStr){
  if(!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

function mapContact(row){
  return {
    id: row.id,
    company: row.company,
    contactName: row.contact_name,
    title: row.title||"",
    email: row.email||"",
    phone: row.phone||"",
    linkedin: row.linkedin||"",
    location: row.location||"",
    companySize: row.company_size||"",
    website: row.website||"",
    industry: row.industry||"",
    stage: row.stage||"New Lead",
    source: row.source||"",
    assignedTo: row.assigned_to||"You",
    addedDate: row.added_date||"",
    lastContacted: row.last_contacted||"",
    followUpDate: row.follow_up_date||"",
    currentSupplier: row.current_supplier||"",
    contractEnd: row.contract_end||"",
    frameworks: row.frameworks||[],
    tags: row.tags||[],
    lossReason: row.loss_reason||"",
    estimatedValue: row.estimated_value||"",
    notes: row.notes||"",
    activities: [],
  };
}

function mapActivity(row){
  return { id:row.id, type:row.type, note:row.note, date:row.date, by:row.by };
}

function mapTemplate(row){
  return { id:row.id, name:row.name, subject:row.subject||"", body:row.body||"" };
}

// Supabase caps a single unpaginated query at 1000 rows — page through with
// .range() until a page comes back short, rather than relying on a project
// dashboard setting that silently truncates data as tables grow past it.
const PAGE_SIZE = 1000;
async function fetchAllRows(table, orderCol, ascending){
  let all = [], from = 0;
  while(true){
    const { data, error } = await supabase.from(table).select("*")
      .order(orderCol, { ascending }).range(from, from + PAGE_SIZE - 1);
    if(error) throw error;
    all = all.concat(data || []);
    if(!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// ── Sub-components ─────────────────────────────────────────────────────
const StagePill = ({stage, small})=>{
  const s = STAGE_STYLE[stage]||{bg:"#eee",color:"#333"};
  return <span style={{fontSize:small?"10px":"11px",padding:small?"2px 6px":"3px 8px",borderRadius:10,fontWeight:500,background:s.bg,color:s.color,whiteSpace:"nowrap"}}>{stage}</span>;
};

const Avatar = ({name, size=28})=>{
  const c = avColor(name);
  return <div style={{width:size,height:size,borderRadius:"50%",background:c.bg,color:c.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size<32?10:13,fontWeight:500,flexShrink:0}}>{initials(name)}</div>;
};

const Modal = ({children, onClose})=>(
  <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#ffffff",borderRadius:12,border:"1px solid #E0E0E0",boxShadow:"0 8px 40px rgba(0,0,0,0.18)",width:"100%",maxWidth:560,maxHeight:"85vh",overflowY:"auto",padding:24}}>
      {children}
    </div>
  </div>
);

// ── Live tender matching ────────────────────────────────────────────────
// UK postcode area -> the broad region names used by the tender board.
// Approximate at the boundaries (a handful of areas straddle two regions)
// but good enough to surface "is there live work near this contact".
const POSTCODE_AREA_TO_REGION = {
  E:"London",EC:"London",N:"London",NW:"London",SE:"London",SW:"London",W:"London",WC:"London",
  BR:"South East England",CR:"South East England",DA:"South East England",EN:"South East England",HA:"South East England",IG:"South East England",KT:"South East England",RM:"South East England",SM:"South East England",TW:"South East England",UB:"South East England",WD:"South East England",
  GU:"South East England",ME:"South East England",MK:"South East England",OX:"South East England",PO:"South East England",RG:"South East England",SL:"South East England",SO:"South East England",TN:"South East England",RH:"South East England",BN:"South East England",HP:"South East England",AL:"South East England",LU:"South East England",SG:"South East England",
  BA:"South West England",BH:"South West England",BS:"South West England",DT:"South West England",EX:"South West England",GL:"South West England",PL:"South West England",SN:"South West England",SP:"South West England",TA:"South West England",TQ:"South West England",TR:"South West England",
  CB:"East of England",CM:"East of England",CO:"East of England",IP:"East of England",NR:"East of England",SS:"East of England",
  DE:"East Midlands",LE:"East Midlands",LN:"East Midlands",NG:"East Midlands",NN:"East Midlands",PE:"East Midlands",
  B:"West Midlands",CV:"West Midlands",DY:"West Midlands",HR:"West Midlands",ST:"West Midlands",SY:"West Midlands",TF:"West Midlands",WR:"West Midlands",WS:"West Midlands",WV:"West Midlands",
  BD:"Yorkshire and The Humber",DN:"Yorkshire and The Humber",HD:"Yorkshire and The Humber",HG:"Yorkshire and The Humber",HU:"Yorkshire and The Humber",HX:"Yorkshire and The Humber",LS:"Yorkshire and The Humber",S:"Yorkshire and The Humber",WF:"Yorkshire and The Humber",YO:"Yorkshire and The Humber",
  BB:"North West England",BL:"North West England",CH:"North West England",CW:"North West England",FY:"North West England",L:"North West England",LA:"North West England",M:"North West England",OL:"North West England",PR:"North West England",SK:"North West England",WA:"North West England",WN:"North West England",
  CA:"North East England",DH:"North East England",DL:"North East England",NE:"North East England",SR:"North East England",TS:"North East England",
  CF:"Wales",LD:"Wales",LL:"Wales",NP:"Wales",SA:"Wales",
  AB:"Scotland",DD:"Scotland",DG:"Scotland",EH:"Scotland",FK:"Scotland",G:"Scotland",HS:"Scotland",IV:"Scotland",KA:"Scotland",KW:"Scotland",KY:"Scotland",ML:"Scotland",PA:"Scotland",PH:"Scotland",TD:"Scotland",ZE:"Scotland",
  BT:"Northern Ireland",
};

const UK_REGIONS = ["North East England","North West England","Yorkshire and The Humber","East Midlands","West Midlands","East of England","London","South East England","South West England","Wales","Scotland","Northern Ireland"];

function regionFromLocation(location){
  if(!location) return null;
  const match = location.toUpperCase().match(/\b([A-Z]{1,2})\d/);
  if(!match) return null;
  return POSTCODE_AREA_TO_REGION[match[1]] || null;
}

function matchTenders(tenders, region, limit=5){
  if(!region || !tenders?.length) return [];
  const inRegion = tenders.filter(t=>t.region===region);
  inRegion.sort((a,b)=>{
    const aRel = a.sector==="Recruitment & Staffing" ? 0 : 1;
    const bRel = b.sector==="Recruitment & Staffing" ? 0 : 1;
    if(aRel!==bRel) return aRel-bRel;
    return new Date(a.deadline||"9999") - new Date(b.deadline||"9999");
  });
  return inRegion.slice(0, limit);
}

const STOPWORDS = new Set(["about","above","across","after","again","against","below","between","could","every","other","should","through","under","while","with","from","have","that","this","will","your","their","staff","services","service","provision","recruitment"]);
function keywordsOf(text){
  return new Set((text||"").toLowerCase().split(/[^a-z]+/).filter(w=>w.length>4 && !STOPWORDS.has(w)));
}
// Given a tender, rank CRM contacts in the same region by how well their
// known specialism (website blurb / industry) overlaps the tender's own
// wording — a rough but genuinely useful stand-in until every lead has a
// clean specialism tag.
function matchContactsForTender(contacts, tender, limit=8){
  if(!tender?.region) return [];
  const tenderWords = keywordsOf(`${tender.title} ${tender.sector} ${tender.description||""}`);
  return contacts
    .map(c=>({contact:c, region:regionFromLocation(c.location)}))
    .filter(x=>x.region===tender.region)
    .map(({contact})=>{
      const contactWords = keywordsOf(`${contact.notes||""} ${contact.industry||""}`);
      let overlap = 0;
      contactWords.forEach(w=>{ if(tenderWords.has(w)) overlap++; });
      let score = overlap*3;
      if((contact.tags||[]).includes("tier-1")) score += 2;
      if((contact.tags||[]).includes("framework")) score += 1;
      return {contact, score};
    })
    .sort((a,b)=>b.score-a.score)
    .slice(0, limit)
    .map(x=>x.contact);
}

// ── Main App ──────────────────────────────────────────────────────────
export default function HawkeyeCRM({ session }){
  const [contacts, setContacts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("pipeline");
  const [selectedContact, setSelectedContact] = useState(null);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterSize, setFilterSize] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [filterFramework, setFilterFramework] = useState("");
  const [filterResearched, setFilterResearched] = useState("");
  const [filterMine, setFilterMine] = useState(false);
  const [contactSort, setContactSort] = useState("newest");
  const [selected, setSelected] = useState([]);
  const [newActivity, setNewActivity] = useState({type:"Email",note:""});
  const [toastMsg, setToastMsg] = useState("");
  const [tenders, setTenders] = useState([]);

  const toast = (msg)=>{ setToastMsg(msg); setTimeout(()=>setToastMsg(""),2500); };
  const closeModal = ()=>setModal(null);
  const openContact = (c)=>{ setSelectedContact(c.id); setView("contact"); };

  const loadData = useCallback(async ()=>{
    setLoading(true);
    try {
      const [contactRows, activityRows, templateRows] = await Promise.all([
        fetchAllRows("contacts", "created_at", false),
        fetchAllRows("activities", "date", false),
        fetchAllRows("templates", "created_at", true),
      ]);
      const mapped = (contactRows||[]).map(mapContact);
      (activityRows||[]).forEach(a=>{
        const c = mapped.find(x=>x.id===a.contact_id);
        if(c) c.activities.push(mapActivity(a));
      });
      setContacts(mapped);
      setTemplates((templateRows||[]).map(mapTemplate));
    } catch(e){ toast("Error loading data"); }
    setLoading(false);
  }, []);

  useEffect(()=>{ loadData(); }, [loadData]);

  useEffect(()=>{
    fetch("https://hawkeye-solutions.co.uk/uk-tenders.json")
      .then(r=>r.ok ? r.json() : [])
      .then(setTenders)
      .catch(()=>setTenders([])); // non-critical — profile just shows no tender matches
  }, []);

  const addContact = async (data)=>{
    const { data: row, error } = await supabase.from("contacts").insert([{
      company: data.company, contact_name: data.contactName, title: data.title,
      email: data.email, phone: data.phone, linkedin: data.linkedin,
      location: data.location, company_size: data.companySize, website: data.website,
      industry: data.industry, stage: data.stage||"New Lead", source: data.source,
      assigned_to: data.assignedTo||session?.user?.email||"You", follow_up_date: data.followUpDate||null,
      current_supplier: data.currentSupplier, contract_end: data.contractEnd,
      frameworks: data.frameworks||[], tags: data.tags||[], estimated_value: data.estimatedValue,
      notes: data.notes||null,
    }]).select().single();
    if(error){ toast("Error adding contact"); return; }
    setContacts(cs=>[{...mapContact(row), activities:[]}, ...cs]);
    toast("Contact added");
  };

  const updateContact = async (id, patch)=>{
    const dbPatch = {};
    const map = {stage:"stage",followUpDate:"follow_up_date",lastContacted:"last_contacted",tags:"tags",frameworks:"frameworks",lossReason:"loss_reason",company:"company",contactName:"contact_name",title:"title",email:"email",phone:"phone",linkedin:"linkedin",location:"location",companySize:"company_size",website:"website",industry:"industry",source:"source",assignedTo:"assigned_to",currentSupplier:"current_supplier",contractEnd:"contract_end",estimatedValue:"estimated_value",notes:"notes"};
    Object.entries(patch).forEach(([k,v])=>{ if(map[k]) dbPatch[map[k]] = v; });
    if(Object.keys(dbPatch).length > 0){
      const { error } = await supabase.from("contacts").update(dbPatch).eq("id", id);
      if(error){ toast("Error saving"); return; }
    }
    setContacts(cs=>cs.map(c=>c.id===id?{...c,...patch}:c));
  };

  const moveStage = (id, stage)=>{
    const c = contacts.find(x=>x.id===id);
    const needsReason = ["Won / Active","Lost / Dead"].includes(stage) && !["Won / Active","Lost / Dead"].includes(c?.stage);
    if(needsReason){ setModal({type:"winloss",id,stage}); return; }
    updateContact(id,{stage});
    toast(`Moved to ${stage}`);
  };

  const bulkStage = (stage)=>{ selected.forEach(id=>moveStage(id,stage)); setSelected([]); };

  const deleteContact = async (id)=>{
    await supabase.from("activities").delete().eq("contact_id", id);
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if(error){ toast("Error deleting contact"); return; }
    setContacts(cs=>cs.filter(c=>c.id!==id));
    toast("Contact deleted");
  };

  const bulkDelete = ()=>{
    if(!window.confirm(`Delete ${selected.length} contact(s)? This can't be undone.`)) return;
    selected.forEach(id=>deleteContact(id));
    setSelected([]);
  };

  const logActivity = async (contactId)=>{
    if(!newActivity.note.trim()) return;
    const today = new Date().toISOString().slice(0,10);
    const activityDate = newActivity.date || today;
    const { data: row, error } = await supabase.from("activities").insert([{
      contact_id: contactId, type: newActivity.type, note: newActivity.note,
      date: activityDate, by: session?.user?.email||"You",
    }]).select().single();
    if(error){ toast("Error logging activity"); return; }
    setContacts(cs=>cs.map(c=>c.id===contactId?{...c,activities:[mapActivity(row),...c.activities].sort((a,b)=>new Date(b.date)-new Date(a.date)),lastContacted:today}:c));
    await supabase.from("contacts").update({last_contacted:today}).eq("id",contactId);
    // Logging any interaction implies contact's been made — nudge a brand-new lead forward automatically
    const contact = contacts.find(c=>c.id===contactId);
    if(contact?.stage==="New Lead"){
      updateContact(contactId,{stage:"Contacted"});
      toast("Activity logged — moved to Contacted");
    } else {
      toast("Activity logged");
    }
    setNewActivity({type:"Email",note:"",date:""});
  };

  const logTenderInterest = async (contactId, tender)=>{
    const today = new Date().toISOString().slice(0,10);
    const closes = tender.deadline ? new Date(tender.deadline).toLocaleDateString("en-GB") : "n/a";
    const note = `Matched to live tender: "${tender.title}" — ${tender.buyer} (${tender.region||"region n/a"}), closes ${closes}. ${tender.url}`;
    const { data: row, error } = await supabase.from("activities").insert([{
      contact_id: contactId, type: "Note", note, date: today, by: session?.user?.email||"You",
    }]).select().single();
    if(error){ toast("Error logging"); return; }
    setContacts(cs=>cs.map(c=>c.id===contactId?{...c,activities:[mapActivity(row),...c.activities].sort((a,b)=>new Date(b.date)-new Date(a.date)),lastContacted:today}:c));
    await supabase.from("contacts").update({last_contacted:today}).eq("id",contactId);
    const contact = contacts.find(c=>c.id===contactId);
    toast(`Tender flagged on ${contact?.company||"contact"}`);
  };

  const saveTemplate = async (data)=>{
    if(data.id){
      const { error } = await supabase.from("templates").update({name:data.name,subject:data.subject,body:data.body}).eq("id",data.id);
      if(error){ toast("Error saving template"); return; }
      setTemplates(ts=>ts.map(t=>t.id===data.id?data:t));
    } else {
      const { data: row, error } = await supabase.from("templates").insert([{name:data.name,subject:data.subject,body:data.body}]).select().single();
      if(error){ toast("Error saving template"); return; }
      setTemplates(ts=>[...ts, mapTemplate(row)]);
    }
    toast("Template saved");
  };

  const deleteTemplate = async (id)=>{
    await supabase.from("templates").delete().eq("id",id);
    setTemplates(ts=>ts.filter(t=>t.id!==id));
    toast("Template deleted");
  };

  const signOut = async ()=>{ await supabase.auth.signOut(); };

  const filteredContacts = useMemo(()=>contacts.filter(c=>{
    const q = search.toLowerCase();
    const haystack = [c.company,c.contactName,c.industry,c.location,c.currentSupplier,c.notes,...(c.tags||[]),...(c.frameworks||[])].join(" ").toLowerCase();
    const matchQ = !q||haystack.includes(q);
    const matchMine = !filterMine||c.assignedTo===session?.user?.email;
    const matchRegion = !filterRegion||regionFromLocation(c.location)===filterRegion;
    const matchFramework = !filterFramework||(c.frameworks||[]).includes(filterFramework);
    const matchResearched = !filterResearched||(filterResearched==="yes"?!!c.notes:!c.notes);
    return matchQ&&(!filterStage||c.stage===filterStage)&&(!filterSource||c.source===filterSource)&&(!filterSize||c.companySize===filterSize)&&matchMine&&matchRegion&&matchFramework&&matchResearched;
  }).sort(CONTACT_SORTS[contactSort]),[contacts,search,filterStage,filterSource,filterSize,filterRegion,filterFramework,filterResearched,filterMine,contactSort,session]);

  const exportCSV = (rows)=>{
    const headers = ["Company","Contact Name","Title","Email","Phone","LinkedIn","Location","Company Size","Website","Industry","Stage","Source","Current Supplier","Contract End","Frameworks","Tags"];
    const escape = (v)=>{ const s = String(v??""); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
    const lines = [headers.join(",")];
    rows.forEach(c=>{
      lines.push([c.company,c.contactName,c.title,c.email,c.phone,c.linkedin,c.location,c.companySize,c.website,c.industry,c.stage,c.source,c.currentSupplier,c.contractEnd,(c.frameworks||[]).join("|"),(c.tags||[]).join("|")].map(escape).join(","));
    });
    const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hawkeye-contacts-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`Exported ${rows.length} contacts`);
  };

  const overdueContacts = contacts.filter(c=>!["Won / Active","Lost / Dead"].includes(c.stage)&&isOverdue(c.followUpDate));
  const stalContacts = contacts.filter(c=>!["Won / Active","Lost / Dead","New Lead"].includes(c.stage)&&c.lastContacted&&(Math.floor((Date.now()-new Date(c.lastContacted))/(86400000)))>=14);
  const contact = contacts.find(c=>c.id===selectedContact);

  const navItems = [
    {id:"dashboard",label:"Dashboard",icon:<DashIcon/>},
    {id:"followups",label:"Follow-ups",icon:<ClockIcon/>,badge:overdueContacts.length||null},
    {id:"pipeline",label:"Pipeline",icon:<PipeIcon/>},
    {id:"contacts",label:"Contacts",icon:<PersonIcon/>},
    {id:"clients",label:"Active Clients",icon:<StarIcon/>},
    {id:"tenders",label:"Tender Matches",icon:<TargetIcon/>},
    {id:"templates",label:"Templates",icon:<DocIcon/>},
  ];

  if(loading) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui",color:"#888",fontSize:13}}>Loading HawkeyeCRM…</div>;

  return (
    <div style={{display:"flex",height:"100vh",fontFamily:"'DM Sans', system-ui, sans-serif",background:"var(--color-background-tertiary)",fontSize:13,color:"var(--color-text-primary)"}}>
      <div style={{width:192,flexShrink:0,background:"var(--color-background-primary)",borderRight:"0.5px solid var(--color-border-tertiary)",display:"flex",flexDirection:"column",padding:"16px 0"}}>
        <div style={{padding:"0 16px 16px",borderBottom:"0.5px solid var(--color-border-tertiary)",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:"#185FA5",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:8,height:8,borderRadius:"50%",background:"white"}}/></div>
            <span style={{fontSize:14,fontWeight:600,letterSpacing:"-0.3px"}}>HawkeyeCRM</span>
          </div>
          <div style={{fontSize:10,color:"var(--color-text-tertiary)",marginTop:3,paddingLeft:29}}>Recruitment outreach</div>
        </div>
        <div style={{flex:1,padding:"4px 0"}}>
          {navItems.map(n=>(
            <div key={n.id} onClick={()=>setView(n.id)} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 16px",fontSize:12,cursor:"pointer",color:view===n.id?"#185FA5":"var(--color-text-secondary)",background:view===n.id?"var(--color-background-secondary)":"transparent",borderRight:view===n.id?"2px solid #185FA5":"2px solid transparent",fontWeight:view===n.id?500:400}}>
              <span style={{opacity:view===n.id?1:0.6,display:"flex"}}>{n.icon}</span>
              {n.label}
              {n.badge?<span style={{marginLeft:"auto",background:"#FCEBEB",color:"#A32D2D",fontSize:10,fontWeight:600,padding:"1px 5px",borderRadius:8}}>{n.badge}</span>:null}
            </div>
          ))}
        </div>
        <div style={{borderTop:"0.5px solid var(--color-border-tertiary)",padding:"10px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <Avatar name={session?.user?.email||"You"} size={26}/>
            <div style={{flex:1,overflow:"hidden"}}>
              <div style={{fontSize:11,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{session?.user?.email||"You"}</div>
              <div style={{fontSize:10,color:"var(--color-text-tertiary)"}}>Admin</div>
            </div>
          </div>
          <button onClick={signOut} style={{...btnStyle,width:"100%",fontSize:11,textAlign:"center"}}>Sign out</button>
        </div>
      </div>

      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{background:"var(--color-background-primary)",borderBottom:"0.5px solid var(--color-border-tertiary)",padding:"0 20px",height:50,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <span style={{fontSize:14,fontWeight:500}}>
            {view==="contact"&&contact?`${contact.company} — ${contact.contactName}`:view==="dashboard"?"Dashboard":view==="followups"?"Follow-ups":view==="pipeline"?"Pipeline":view==="contacts"?"Contacts":view==="clients"?"Active Clients":view==="tenders"?"Tender Matches":"Templates"}
          </span>
          <div style={{display:"flex",gap:8}}>
            {view==="contacts"&&selected.length>0&&(
              <>
                <select onChange={e=>{if(e.target.value){bulkStage(e.target.value);e.target.value=""}}} style={btnStyle} defaultValue="">
                  <option value="">Bulk move ({selected.length})…</option>
                  {STAGES.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                <button style={{...btnStyle,color:"#A32D2D",borderColor:"#F09595"}} onClick={bulkDelete}>Delete ({selected.length})</button>
              </>
            )}
            {view==="contacts"&&<button style={btnStyle} onClick={()=>exportCSV(filteredContacts)}>Export CSV</button>}
            <button style={btnStyle} onClick={()=>setModal({type:"import"})}>Import CSV</button>
            <button style={{...btnStyle,background:"#185FA5",color:"white",border:"none"}} onClick={()=>setModal({type:"addContact",stage:""})}>+ Add contact</button>
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:18}}>
          {view==="dashboard"&&<DashboardView contacts={contacts} openContact={openContact}/>}
          {view==="followups"&&<FollowupsView contacts={contacts} openContact={openContact} updateContact={updateContact} toast={toast}/>}
          {view==="pipeline"&&<PipelineView contacts={contacts} openContact={openContact} moveStage={moveStage} setModal={setModal} stalContacts={stalContacts} updateContact={updateContact}/>}
          {view==="contacts"&&<ContactsView contacts={filteredContacts} allContacts={contacts} search={search} setSearch={setSearch} filterStage={filterStage} setFilterStage={setFilterStage} filterSource={filterSource} setFilterSource={setFilterSource} filterSize={filterSize} setFilterSize={setFilterSize} filterRegion={filterRegion} setFilterRegion={setFilterRegion} filterFramework={filterFramework} setFilterFramework={setFilterFramework} filterResearched={filterResearched} setFilterResearched={setFilterResearched} filterMine={filterMine} setFilterMine={setFilterMine} contactSort={contactSort} setContactSort={setContactSort} selected={selected} setSelected={setSelected} openContact={openContact}/>}
          {view==="contact"&&contact&&<ContactProfile contact={contact} updateContact={updateContact} moveStage={moveStage} newActivity={newActivity} setNewActivity={setNewActivity} logActivity={logActivity} setView={setView} setModal={setModal} templates={templates} tenders={tenders} deleteContact={deleteContact}/>}
          {view==="clients"&&<ClientsView contacts={contacts} openContact={openContact}/>}
          {view==="tenders"&&<TendersView tenders={tenders} contacts={contacts} openContact={openContact} logTenderInterest={logTenderInterest}/>}
          {view==="templates"&&<TemplatesView templates={templates} saveTemplate={saveTemplate} deleteTemplate={deleteTemplate} setModal={setModal}/>}
        </div>
      </div>

      {modal?.type==="addContact"&&<AddContactModal onClose={closeModal} onSave={(d)=>{addContact({...d,stage:modal.stage||"New Lead"});closeModal();}} prefillStage={modal.stage} currentUserEmail={session?.user?.email}/>}
      {modal?.type==="editContact"&&<AddContactModal edit contact={modal.contact} onClose={closeModal} onSave={(d)=>{updateContact(modal.contact.id,d);closeModal();toast("Saved");}} currentUserEmail={session?.user?.email}/>}
      {modal?.type==="winloss"&&<WinLossModal stage={modal.stage} onClose={closeModal} onSave={(reason)=>{updateContact(modal.id,{stage:modal.stage,lossReason:reason});closeModal();toast(`Moved to ${modal.stage}`);}}/>}
      {modal?.type==="template"&&<TemplateModal template={modal.template} onClose={closeModal} onSave={(t)=>{saveTemplate(t);closeModal();}}/>}
{modal?.type==="import" && (
        <ImportCSVModal
          onClose={closeModal}
          supabase={supabase}
          currentUserEmail={session?.user?.email}
          onImportComplete={(count) => {
            loadData();
            toast(`${count} contacts imported`);
            closeModal();
          }}
        />
      )}
      {toastMsg&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#185FA5",color:"white",padding:"8px 18px",borderRadius:20,fontSize:12,fontWeight:500,zIndex:2000,pointerEvents:"none"}}>{toastMsg}</div>}
    </div>
  );
}

function parseValue(v){
  if(!v) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g,""));
  return isNaN(n) ? 0 : n;
}
function formatGBP(n){
  if(n>=1000000) return `£${(n/1000000).toFixed(1)}m`;
  if(n>=1000) return `£${Math.round(n/1000)}k`;
  return `£${Math.round(n)}`;
}

function DashboardView({contacts,openContact}){
  const stageCounts = STAGES.map(s=>({stage:s,count:contacts.filter(c=>c.stage===s).length}));
  const overdue = contacts.filter(c=>!["Won / Active","Lost / Dead"].includes(c.stage)&&isOverdue(c.followUpDate));
  const recentActs = contacts.flatMap(c=>(c.activities||[]).map(a=>({...a,company:c.company,contactId:c.id}))).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6);
  const barMax = Math.max(...stageCounts.map(s=>s.count),1);
  const BAR_COLORS = {"New Lead":"#B5D4F4","Researched":"#CECBF6","Contacted":"#FAC775","Follow-up Due":"#F09595","Meeting Booked":"#C0DD97","Proposal Sent":"#F4C0D1","Won / Active":"#5DCAA5","Lost / Dead":"#D3D1C7"};
  const activeContacts = contacts.filter(c=>!["Won / Active","Lost / Dead"].includes(c.stage));
  const pipelineValue = activeContacts.reduce((sum,c)=>sum+parseValue(c.estimatedValue),0);
  const sourceCounts = SOURCES.map(s=>({source:s,count:contacts.filter(c=>c.source===s).length})).filter(s=>s.count>0);
  const sourceMax = Math.max(...sourceCounts.map(s=>s.count),1);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:10,marginBottom:16}}>
        {[{label:"Total contacts",value:contacts.length},{label:"Active pipeline",value:activeContacts.length},{label:"Pipeline value",value:formatGBP(pipelineValue)},{label:"Won / active",value:contacts.filter(c=>c.stage==="Won / Active").length,up:true},{label:"Overdue follow-ups",value:overdue.length,warn:overdue.length>0}].map((m,i)=>(
          <div key={i} style={{background:"var(--color-background-secondary)",borderRadius:8,padding:"11px 14px"}}>
            <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>{m.label}</div>
            <div style={{fontSize:22,fontWeight:500,color:m.warn?"#A32D2D":"var(--color-text-primary)"}}>{m.value}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div style={cardStyle}>
          <div style={{fontSize:12,fontWeight:500,marginBottom:12}}>Pipeline breakdown</div>
          <div style={{display:"flex",gap:5,alignItems:"flex-end",height:80}}>
            {stageCounts.map(({stage,count})=>(
              <div key={stage} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                <div style={{width:"100%",background:BAR_COLORS[stage],borderRadius:"3px 3px 0 0",height:count?`${Math.round((count/barMax)*70)+6}px`:"4px"}}/>
                <div style={{fontSize:9,color:"var(--color-text-secondary)"}}>{stage.split(" ")[0]}</div>
                <div style={{fontSize:9,fontWeight:500}}>{count}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{fontSize:12,fontWeight:500,marginBottom:10}}>Overdue follow-ups</div>
          {overdue.length===0?<div style={{fontSize:12,color:"var(--color-text-tertiary)",padding:"12px 0"}}>All clear!</div>:
          overdue.slice(0,4).map(c=>(
            <div key={c.id} onClick={()=>openContact(c)} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",cursor:"pointer"}}>
              <Avatar name={c.contactName} size={24}/>
              <div style={{flex:1,overflow:"hidden"}}><div style={{fontSize:11,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.company}</div><div style={{fontSize:10,color:"var(--color-text-secondary)"}}>{c.contactName}</div></div>
              <div style={{fontSize:10,color:"#A32D2D",fontWeight:500}}>{daysAgo(c.followUpDate)}</div>
            </div>
          ))}
        </div>
        <div style={cardStyle}>
          <div style={{fontSize:12,fontWeight:500,marginBottom:12}}>Leads by source</div>
          {sourceCounts.map(({source,count})=>(
            <div key={source} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
              <div style={{width:72,fontSize:11,color:"var(--color-text-secondary)",flexShrink:0}}>{source}</div>
              <div style={{flex:1,background:"var(--color-background-secondary)",borderRadius:4,height:14,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${Math.round((count/sourceMax)*100)}%`,background:"#185FA5",borderRadius:4}}/>
              </div>
              <div style={{width:28,fontSize:11,fontWeight:500,textAlign:"right"}}>{count}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={cardStyle}>
        <div style={{fontSize:12,fontWeight:500,marginBottom:10}}>Recent activity</div>
        {recentActs.length===0?<div style={{fontSize:12,color:"var(--color-text-tertiary)"}}>No activity logged yet.</div>:
        recentActs.map(a=>(
          <div key={a.id} onClick={()=>openContact({id:a.contactId})} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",cursor:"pointer"}}>
            <div style={{fontSize:11,color:"var(--color-text-tertiary)",width:64,flexShrink:0,paddingTop:1}}>{daysAgo(a.date)}</div>
            <div style={{fontSize:11,color:"var(--color-text-secondary)",marginRight:4,flexShrink:0}}>{a.type}</div>
            <div style={{fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><strong style={{color:"#185FA5"}}>{a.company}</strong> — {a.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FollowupsView({contacts,openContact,updateContact,toast}){
  const overdue = contacts.filter(c=>!["Won / Active","Lost / Dead"].includes(c.stage)&&isOverdue(c.followUpDate)&&c.followUpDate);
  const today = new Date().toISOString().slice(0,10);
  const upcoming = contacts.filter(c=>!["Won / Active","Lost / Dead"].includes(c.stage)&&c.followUpDate&&!isOverdue(c.followUpDate)).sort((a,b)=>new Date(a.followUpDate)-new Date(b.followUpDate)).slice(0,8);
  const noDate = contacts.filter(c=>!["Won / Active","Lost / Dead","New Lead"].includes(c.stage)&&!c.followUpDate);
  const setFollowUp=(id,date)=>{ updateContact(id,{followUpDate:date}); toast("Follow-up date set"); };
  const FUItem=({c,urgent})=>(
    <div onClick={()=>openContact(c)} style={{...cardStyle,display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",borderLeft:urgent?"3px solid #E24B4A":"0.5px solid var(--color-border-tertiary)",borderRadius:urgent?0:8,marginBottom:6}}>
      <div style={{width:7,height:7,borderRadius:"50%",background:urgent?"#E24B4A":"#1D9E75",flexShrink:0}}/>
      <Avatar name={c.contactName} size={26}/>
      <div style={{flex:1}}><div style={{fontSize:12,fontWeight:500}}>{c.company} — {c.contactName}</div><div style={{fontSize:11,color:"var(--color-text-secondary)",marginTop:1}}>{c.activities?.[0]?.note?.slice(0,60)||"No recent activity"}</div></div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}><div style={{fontSize:11,color:urgent?"#A32D2D":"var(--color-text-tertiary)",fontWeight:urgent?500:400}}>{daysAgo(c.followUpDate)}</div><StagePill stage={c.stage} small/></div>
    </div>
  );
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10,marginBottom:16}}>
        {[{label:"Overdue",value:overdue.length,warn:true},{label:"Due today",value:contacts.filter(c=>c.followUpDate===today).length},{label:"This week",value:upcoming.length}].map((m,i)=>(
          <div key={i} style={{background:"var(--color-background-secondary)",borderRadius:8,padding:"11px 14px"}}>
            <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>{m.label}</div>
            <div style={{fontSize:22,fontWeight:500,color:m.warn&&m.value>0?"#A32D2D":"var(--color-text-primary)"}}>{m.value}</div>
          </div>
        ))}
      </div>
      {overdue.length>0&&<><div style={{fontSize:12,fontWeight:500,marginBottom:8,color:"#791F1F"}}>Overdue</div>{overdue.map(c=><FUItem key={c.id} c={c} urgent/>)}</>}
      {upcoming.length>0&&<><div style={{fontSize:12,fontWeight:500,margin:"14px 0 8px"}}>Coming up</div>{upcoming.map(c=><FUItem key={c.id} c={c}/>)}</>}
      {noDate.length>0&&(<><div style={{fontSize:12,fontWeight:500,margin:"14px 0 8px",color:"var(--color-text-secondary)"}}>No follow-up date set ({noDate.length})</div>
        {noDate.slice(0,5).map(c=>(
          <div key={c.id} style={{...cardStyle,display:"flex",alignItems:"center",gap:10,padding:"8px 12px",marginBottom:6}}>
            <Avatar name={c.contactName} size={24}/><div style={{flex:1}}><div style={{fontSize:12,fontWeight:500}}>{c.company}</div><StagePill stage={c.stage} small/></div>
            <input type="date" defaultValue="" onChange={e=>setFollowUp(c.id,e.target.value)} style={{fontSize:11,padding:"4px 7px",border:"0.5px solid var(--color-border-secondary)",borderRadius:6,background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>
          </div>
        ))}</>)}
      {overdue.length===0&&upcoming.length===0&&noDate.length===0&&<div style={{textAlign:"center",padding:"48px 0",color:"var(--color-text-tertiary)",fontSize:12}}>No follow-ups to show yet.</div>}
    </div>
  );
}

const PIPELINE_SORTS = {
  "newest":  (a,b)=>new Date(b.addedDate||0)-new Date(a.addedDate||0),
  "oldest":  (a,b)=>new Date(a.addedDate||0)-new Date(b.addedDate||0),
  "az":      (a,b)=>a.company.localeCompare(b.company),
};
const CONTACT_SORTS = {
  newest:        (a,b)=>new Date(b.addedDate||0)-new Date(a.addedDate||0),
  oldest:        (a,b)=>new Date(a.addedDate||0)-new Date(b.addedDate||0),
  az:            (a,b)=>a.company.localeCompare(b.company),
  recent_touch:  (a,b)=>new Date(b.lastContacted||0)-new Date(a.lastContacted||0),
  stale_touch:   (a,b)=>new Date(a.lastContacted||"9999")-new Date(b.lastContacted||"9999"),
};

function tierOf(c){ return (c.tags||[]).find(t=>t.startsWith("tier-"))||""; }
function isPriority(c){ return (c.tags||[]).includes("priority"); }
function togglePriority(c, updateContact){
  const tags = isPriority(c) ? (c.tags||[]).filter(t=>t!=="priority") : [...(c.tags||[]),"priority"];
  updateContact(c.id, {tags});
}

function PipelineView({contacts,openContact,moveStage,setModal,stalContacts,updateContact}){
  const [sortBy,setSortBy]=useState("priority");
  const [filterRegion,setFilterRegion]=useState("");
  const [filterTier,setFilterTier]=useState("");
  const [priorityOnly,setPriorityOnly]=useState(false);
  const [search,setSearch]=useState("");
  const stalIds = new Set(stalContacts.map(c=>c.id));

  const visible = contacts.filter(c=>{
    const q = search.toLowerCase();
    const haystack = [c.company,c.contactName,c.industry,c.notes,...(c.tags||[])].join(" ").toLowerCase();
    const matchQ = !q||haystack.includes(q);
    const matchRegion = !filterRegion||regionFromLocation(c.location)===filterRegion;
    const matchTier = !filterTier||tierOf(c)===filterTier;
    const matchPriority = !priorityOnly||isPriority(c);
    return matchQ&&matchRegion&&matchTier&&matchPriority;
  });

  const sorters = {
    ...PIPELINE_SORTS,
    priority: (a,b)=>{
      const pa = isPriority(a)?0:1, pb = isPriority(b)?0:1;
      if(pa!==pb) return pa-pb;
      return PIPELINE_SORTS.newest(a,b);
    },
  };

  return (
    <div>
      {stalContacts.length>0&&<div style={{background:"#FAEEDA",border:"0.5px solid #EF9F27",borderRadius:8,padding:"8px 12px",marginBottom:12}}><span style={{fontSize:11,color:"#633806"}}>⚠ {stalContacts.length} contact{stalContacts.length>1?"s":""} not touched in 14+ days: {stalContacts.map(c=>c.company).join(", ")}</span></div>}
      {contacts.length===0&&<div style={{textAlign:"center",padding:"48px 0",color:"var(--color-text-tertiary)",fontSize:12}}>No contacts yet. Click "+ Add contact" to get started.</div>}
      <div style={{display:"flex",justifyContent:"flex-end",gap:7,marginBottom:8,flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{...inputStyle,fontSize:11,width:140}}/>
        <select value={filterTier} onChange={e=>setFilterTier(e.target.value)} style={{...inputStyle,fontSize:11}}>
          <option value="">All tiers</option>
          <option value="tier-1">Tier 1</option>
          <option value="tier-2">Tier 2</option>
          <option value="tier-3">Tier 3</option>
        </select>
        <select value={filterRegion} onChange={e=>setFilterRegion(e.target.value)} style={{...inputStyle,fontSize:11}}>
          <option value="">All regions</option>
          {UK_REGIONS.map(r=><option key={r}>{r}</option>)}
        </select>
        <button onClick={()=>setPriorityOnly(p=>!p)} style={{...btnStyle,fontSize:11,background:priorityOnly?"#185FA5":undefined,color:priorityOnly?"white":undefined,border:priorityOnly?"none":undefined}}>★ Priority only</button>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...inputStyle,fontSize:11}}>
          <option value="priority">Sort: Priority first</option>
          <option value="newest">Sort: Newest added</option>
          <option value="oldest">Sort: Oldest added</option>
          <option value="az">Sort: Company A–Z</option>
        </select>
      </div>
      <div style={{display:"flex",gap:9,overflowX:"auto",paddingBottom:8}}>
        {STAGES.map(stage=>{
          const cols=visible.filter(c=>c.stage===stage).sort(sorters[sortBy]);
          const {bg,color}=STAGE_STYLE[stage];
          return (
            <div key={stage} style={{minWidth:168,flexShrink:0}}>
              <div style={{fontSize:11,fontWeight:500,padding:"5px 9px",borderRadius:8,marginBottom:8,background:bg,color,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:110}}>{stage}</span>
                <span style={{fontSize:10,background:"rgba(0,0,0,.07)",padding:"1px 5px",borderRadius:8,flexShrink:0,marginLeft:4}}>{cols.length}</span>
              </div>
              {cols.map(c=>(
                <div key={c.id} onClick={()=>openContact(c)} style={{background:"var(--color-background-primary)",border:stalIds.has(c.id)?"1px solid #EF9F27":"0.5px solid var(--color-border-tertiary)",borderRadius:8,padding:"9px",marginBottom:5,cursor:"pointer",opacity:stage==="Lost / Dead"?0.55:1,position:"relative"}}>
                  <span onClick={e=>{e.stopPropagation();togglePriority(c,updateContact);}} title={isPriority(c)?"Remove priority":"Mark as priority"} style={{position:"absolute",top:7,right:7,fontSize:13,color:isPriority(c)?"#EF9F27":"var(--color-border-secondary)",cursor:"pointer"}}>★</span>
                  <div style={{fontSize:12,fontWeight:500,marginBottom:1,paddingRight:16,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.company}</div>
                  <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.contactName} · {c.title}</div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontSize:10,padding:"2px 5px",borderRadius:6,background:"var(--color-background-secondary)",color:"var(--color-text-secondary)"}}>{c.source}</span>
                    <span style={{fontSize:10,color:isOverdue(c.followUpDate)?"#A32D2D":stalIds.has(c.id)?"#854F0B":"var(--color-text-tertiary)",fontWeight:isOverdue(c.followUpDate)?500:400}}>{isOverdue(c.followUpDate)?"Overdue":stalIds.has(c.id)?"Stale":daysAgo(c.addedDate)||""}</span>
                  </div>
                  {(c.tags||[]).length>0&&<div style={{marginTop:5,display:"flex",flexWrap:"wrap",gap:3}}>{c.tags.filter(t=>t!=="priority").slice(0,2).map(t=><span key={t} style={{fontSize:9,padding:"1px 5px",borderRadius:8,background:"#E6F1FB",color:"#0C447C"}}>{t}</span>)}</div>}
                </div>
              ))}
              <button onClick={()=>setModal({type:"addContact",stage})} style={{width:"100%",border:"0.5px dashed var(--color-border-secondary)",borderRadius:8,padding:"6px",fontSize:11,color:"var(--color-text-tertiary)",background:"transparent",cursor:"pointer",marginTop:2}}>+ Add here</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContactsView({contacts,allContacts,search,setSearch,filterStage,setFilterStage,filterSource,setFilterSource,filterSize,setFilterSize,filterRegion,setFilterRegion,filterFramework,setFilterFramework,filterResearched,setFilterResearched,filterMine,setFilterMine,contactSort,setContactSort,selected,setSelected,openContact}){
  const availableFrameworks = useMemo(()=>[...new Set(allContacts.flatMap(c=>c.frameworks||[]))].sort(),[allContacts]);
  const [groupByCompany,setGroupByCompany]=useState(false);
  const toggleSelect=(id)=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const allSelected=contacts.length>0&&contacts.every(c=>selected.includes(c.id));
  const toggleAll=()=>setSelected(allSelected?[]:contacts.map(c=>c.id));

  const companyGroups = useMemo(()=>{
    if(!groupByCompany) return null;
    const groups = {}; // normalised name -> {label, people}
    contacts.forEach(c=>{
      const label = c.company || "(No company)";
      const key = label.trim().toLowerCase();
      if(!groups[key]) groups[key] = {label, people:[]};
      groups[key].people.push(c);
    });
    return Object.values(groups).sort((a,b)=>b.people.length-a.people.length);
  },[groupByCompany,contacts]);

  return (
    <div>
      <div style={{display:"flex",gap:7,marginBottom:12,flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search company, contact, industry, location, specialism notes, tags…" style={{flex:1,minWidth:180,...inputStyle}}/>
        <select value={filterStage} onChange={e=>setFilterStage(e.target.value)} style={inputStyle}><option value="">All stages</option>{STAGES.map(s=><option key={s}>{s}</option>)}</select>
        <select value={filterSource} onChange={e=>setFilterSource(e.target.value)} style={inputStyle}><option value="">All sources</option>{SOURCES.map(s=><option key={s}>{s}</option>)}</select>
        <select value={filterSize} onChange={e=>setFilterSize(e.target.value)} style={inputStyle}><option value="">All sizes</option>{["1-10","11-50","51-200","200+"].map(s=><option key={s}>{s}</option>)}</select>
        <select value={filterRegion} onChange={e=>setFilterRegion(e.target.value)} style={inputStyle}><option value="">All regions</option>{UK_REGIONS.map(r=><option key={r}>{r}</option>)}</select>
        {availableFrameworks.length>0&&<select value={filterFramework} onChange={e=>setFilterFramework(e.target.value)} style={inputStyle}><option value="">All frameworks</option>{availableFrameworks.map(f=><option key={f}>{f}</option>)}</select>}
        <select value={filterResearched} onChange={e=>setFilterResearched(e.target.value)} style={inputStyle}>
          <option value="">Researched: all</option>
          <option value="yes">Researched: yes</option>
          <option value="no">Researched: not yet</option>
        </select>
        <select value={contactSort} onChange={e=>setContactSort(e.target.value)} style={inputStyle}>
          <option value="newest">Sort: Newest added</option>
          <option value="oldest">Sort: Oldest added</option>
          <option value="az">Sort: Company A–Z</option>
          <option value="recent_touch">Sort: Recently touched</option>
          <option value="stale_touch">Sort: Longest untouched</option>
        </select>
        <button style={{...btnStyle,background:filterMine?"#185FA5":undefined,color:filterMine?"white":undefined,border:filterMine?"none":undefined}} onClick={()=>setFilterMine(m=>!m)}>My contacts</button>
        <button style={{...btnStyle,background:groupByCompany?"#185FA5":undefined,color:groupByCompany?"white":undefined,border:groupByCompany?"none":undefined}} onClick={()=>setGroupByCompany(g=>!g)}>Group by company</button>
      </div>
      {groupByCompany ? (
        <div>
          {companyGroups.map(({label,people})=>(
            <div key={label} style={{...cardStyle,marginBottom:8,padding:"10px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:people.length>1?8:0}}>
                <span style={{fontSize:12,fontWeight:500}}>{label}</span>
                <span style={{fontSize:10,background:"var(--color-background-secondary)",color:"var(--color-text-secondary)",padding:"1px 6px",borderRadius:8}}>{people.length} {people.length===1?"contact":"contacts"}</span>
              </div>
              {people.map(c=>(
                <div key={c.id} onClick={()=>openContact(c)} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderTop:"0.5px solid var(--color-border-tertiary)",cursor:"pointer"}}>
                  <Avatar name={c.contactName} size={22}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.contactName}{c.title?` · ${c.title}`:""}</div>
                  </div>
                  <StagePill stage={c.stage} small/>
                </div>
              ))}
            </div>
          ))}
          {contacts.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:"var(--color-text-tertiary)",fontSize:12}}>No contacts match your filters.</div>}
        </div>
      ) : (
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
          <thead><tr style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
            <th style={{width:28,padding:"5px 8px"}}><input type="checkbox" checked={allSelected} onChange={toggleAll}/></th>
            <th style={thStyle}>Company</th><th style={thStyle}>Contact</th><th style={thStyle}>Stage</th><th style={thStyle}>Framework/Tags</th><th style={thStyle}>Supplier</th><th style={thStyle}>Follow-up</th><th style={thStyle}>Source</th>
          </tr></thead>
          <tbody>
            {contacts.map(c=>(
              <tr key={c.id} onClick={()=>openContact(c)} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="var(--color-background-secondary)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"8px"}} onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected.includes(c.id)} onChange={()=>toggleSelect(c.id)}/></td>
                <td style={{padding:"8px",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  <span title={c.notes?"Has research notes":"No research notes yet"} style={{display:"inline-block",width:6,height:6,borderRadius:"50%",marginRight:6,flexShrink:0,background:c.notes?"#1D9E75":"transparent",border:c.notes?"none":"1px solid var(--color-border-secondary)"}}/>
                  {c.company}
                </td>
                <td style={{padding:"8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><Avatar name={c.contactName} size={22}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.contactName}</span></div></td>
                <td style={{padding:"8px"}}><StagePill stage={c.stage} small/></td>
                <td style={{padding:"8px"}}><div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                  {(c.frameworks||[]).slice(0,2).map(f=><span key={f} style={{fontSize:9,padding:"1px 5px",borderRadius:8,background:"#EEEDFE",color:"#3C3489"}}>{f}</span>)}
                  {(c.tags||[]).filter(t=>t!=="framework"&&!t.startsWith("tier-")).slice(0,2).map(t=><span key={t} style={{fontSize:9,padding:"1px 5px",borderRadius:8,background:"#E6F1FB",color:"#0C447C"}}>{t}</span>)}
                </div></td>
                <td style={{padding:"8px",fontSize:11,color:"var(--color-text-secondary)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.currentSupplier||"—"}</td>
                <td style={{padding:"8px",fontSize:11,color:isOverdue(c.followUpDate)?"#A32D2D":"var(--color-text-secondary)",fontWeight:isOverdue(c.followUpDate)?500:400}}>{c.followUpDate?daysAgo(c.followUpDate):"Not set"}</td>
                <td style={{padding:"8px",fontSize:11,color:"var(--color-text-secondary)"}}>{c.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {contacts.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:"var(--color-text-tertiary)",fontSize:12}}>No contacts match your filters.</div>}
      </div>
      )}
    </div>
  );
}

function ContactProfile({contact,updateContact,moveStage,newActivity,setNewActivity,logActivity,setView,setModal,templates,tenders,deleteContact}){
  const [tagInput,setTagInput]=useState("");
  const [showTemplates,setShowTemplates]=useState(false);
  const [editFollowUp,setEditFollowUp]=useState(false);
  const [editAssigned,setEditAssigned]=useState(false);
  const [emailSubject,setEmailSubject]=useState("");
  const region = regionFromLocation(contact.location);
  const matchedTenders = matchTenders(tenders, region);
  const addTag=(t)=>{ if(!t.trim()||contact.tags?.includes(t)) return; updateContact(contact.id,{tags:[...(contact.tags||[]),t.trim()]}); setTagInput(""); };
  const removeTag=(t)=>updateContact(contact.id,{tags:(contact.tags||[]).filter(x=>x!==t)});
  const applyTemplate=(tmpl)=>{
    const fill = s=>(s||"").replace(/\[Name\]/g,contact.contactName.split(" ")[0]).replace(/\[Company\]/g,contact.company);
    setNewActivity(a=>({...a,type:"Email",note:fill(tmpl.body)}));
    setEmailSubject(fill(tmpl.subject));
    setShowTemplates(false);
  };
  const mailtoHref = contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(newActivity.note||"")}` : null;
  const handleDelete = ()=>{
    if(!window.confirm(`Delete ${contact.company}? This can't be undone.`)) return;
    deleteContact(contact.id);
    setView("contacts");
  };
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
        <button style={btnStyle} onClick={()=>setView("contacts")}>← Back</button>
        <span style={{fontSize:11,color:"var(--color-text-secondary)"}}>Contacts / {contact.company}</span>
        <div style={{marginLeft:"auto",display:"flex",gap:7}}>
          <button style={btnStyle} onClick={()=>setModal({type:"editContact",contact})}>Edit</button>
          <button style={{...btnStyle,color:"#A32D2D",borderColor:"#F09595"}} onClick={handleDelete}>Delete</button>
          <select value={contact.stage} onChange={e=>moveStage(contact.id,e.target.value)} style={{...inputStyle,fontSize:11}}>{STAGES.map(s=><option key={s} value={s}>{s}</option>)}</select>
        </div>
      </div>
      <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
        <div style={{width:224,flexShrink:0,display:"flex",flexDirection:"column",gap:10}}>
          <div style={cardStyle}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <Avatar name={contact.contactName} size={44}/>
              <div><div style={{fontSize:14,fontWeight:500}}>{contact.contactName}</div><div style={{fontSize:11,color:"var(--color-text-secondary)",marginTop:1}}>{contact.title}</div><div style={{fontSize:11,color:"#185FA5",marginTop:1}}>{contact.company}</div></div>
            </div>
            {[{l:"Email",v:contact.email,link:true},{l:"Phone",v:contact.phone},{l:"LinkedIn",v:contact.linkedin?"View profile":null,link:true},{l:"Location",v:contact.location},{l:"Size",v:contact.companySize},{l:"Industry",v:contact.industry}].filter(x=>x.v).map(({l,v,link})=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",gap:8}}>
                <span style={{fontSize:11,color:"var(--color-text-secondary)",flexShrink:0}}>{l}</span>
                <span style={{fontSize:11,color:link?"#185FA5":"var(--color-text-primary)",textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
              </div>
            ))}
          </div>
          {region && matchedTenders.length>0 && (
            <div style={{...cardStyle,background:"#E6F1FB",border:"0.5px solid #B5D4F4"}}>
              <div style={{fontSize:10,fontWeight:500,color:"#0C447C",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Live tenders in {region}</div>
              {matchedTenders.map(t=>(
                <a key={t.id} href={t.url} target="_blank" rel="noreferrer" style={{display:"block",textDecoration:"none",padding:"6px 0",borderBottom:"0.5px solid #B5D4F4"}}>
                  <div style={{fontSize:11,fontWeight:500,color:"#0C447C",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {t.sector==="Recruitment & Staffing" && "⭐ "}{t.title}
                  </div>
                  <div style={{fontSize:10,color:"#185FA5",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.buyer}</div>
                  <div style={{fontSize:10,color:"var(--color-text-tertiary)",marginTop:1}}>{t.sector} · closes {t.deadline ? new Date(t.deadline).toLocaleDateString("en-GB") : "n/a"}</div>
                </a>
              ))}
            </div>
          )}
          <div style={cardStyle}>
            <div style={{fontSize:10,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Pipeline</div>
            {[{l:"Stage",v:<StagePill stage={contact.stage} small/>},{l:"Added",v:contact.addedBy?`${contact.addedDate} by ${contact.addedBy}`:contact.addedDate},{l:"Last contact",v:contact.lastContacted?daysAgo(contact.lastContacted):"Never"}].map(({l,v})=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",gap:8}}>
                <span style={{fontSize:11,color:"var(--color-text-secondary)"}}>{l}</span><span style={{fontSize:11}}>{v}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",gap:8}}>
              <span style={{fontSize:11,color:"var(--color-text-secondary)"}}>Assigned</span>
              {editAssigned?<input defaultValue={contact.assignedTo||""} onBlur={e=>{updateContact(contact.id,{assignedTo:e.target.value});setEditAssigned(false);}} autoFocus style={{fontSize:11,padding:"2px 5px",border:"0.5px solid var(--color-border-secondary)",borderRadius:4,background:"var(--color-background-primary)",color:"var(--color-text-primary)",width:140}}/>:<span onClick={()=>setEditAssigned(true)} style={{fontSize:11,color:"#185FA5",cursor:"pointer"}}>{contact.assignedTo||"Unassigned"}</span>}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",gap:8}}>
              <span style={{fontSize:11,color:"var(--color-text-secondary)"}}>Source</span>
              <select value={contact.source} onChange={e=>updateContact(contact.id,{source:e.target.value})} style={{fontSize:11,padding:"2px 4px",border:"0.5px solid var(--color-border-secondary)",borderRadius:4,background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}>{SOURCES.map(s=><option key={s} value={s}>{s}</option>)}</select>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",gap:8}}>
              <span style={{fontSize:11,color:"var(--color-text-secondary)"}}>Follow-up</span>
              {editFollowUp?<input type="date" defaultValue={contact.followUpDate||""} onBlur={e=>{updateContact(contact.id,{followUpDate:e.target.value});setEditFollowUp(false);}} autoFocus style={{fontSize:10,padding:"2px 5px",border:"0.5px solid var(--color-border-secondary)",borderRadius:4,background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>:<span onClick={()=>setEditFollowUp(true)} style={{fontSize:11,color:isOverdue(contact.followUpDate)?"#A32D2D":"#185FA5",cursor:"pointer",fontWeight:isOverdue(contact.followUpDate)?500:400}}>{contact.followUpDate?daysAgo(contact.followUpDate):"Set date"}</span>}
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{fontSize:10,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Company Research</div>
            {contact.notes && <div style={{fontSize:11,color:"var(--color-text-primary)",lineHeight:1.5,marginBottom:8,paddingBottom:8,borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{contact.notes}</div>}
            {[{l:"Curr. supplier",v:contact.currentSupplier},{l:"Contract end",v:contact.contractEnd}].filter(x=>x.v).map(({l,v})=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",gap:8}}><span style={{fontSize:11,color:"var(--color-text-secondary)"}}>{l}</span><span style={{fontSize:11}}>{v}</span></div>
            ))}
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:8}}>
              {(contact.frameworks||[]).map(f=><span key={f} style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#EEEDFE",color:"#3C3489"}}>{f}</span>)}
              {(contact.frameworks||[]).length===0&&!contact.notes&&<span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>No research or frameworks added yet</span>}
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{fontSize:10,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Tags</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>{(contact.tags||[]).map(t=><span key={t} onClick={()=>removeTag(t)} style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#E6F1FB",color:"#0C447C",cursor:"pointer"}}>{t} ×</span>)}</div>
            <div style={{display:"flex",gap:4,marginBottom:6}}>
              <input value={tagInput} onChange={e=>setTagInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag(tagInput)} placeholder="Add tag…" style={{flex:1,fontSize:11,...inputStyle,padding:"4px 7px"}}/>
              <button style={{...btnStyle,fontSize:11,padding:"4px 8px"}} onClick={()=>addTag(tagInput)}>+</button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:3}}>{TAGS_PRESET.filter(t=>!(contact.tags||[]).includes(t)).map(t=><span key={t} onClick={()=>addTag(t)} style={{fontSize:9,padding:"2px 6px",borderRadius:8,background:"var(--color-background-secondary)",color:"var(--color-text-secondary)",cursor:"pointer"}}>{t}</span>)}</div>
          </div>
          {contact.lossReason&&<div style={{...cardStyle,background:"#F1EFE8"}}><div style={{fontSize:10,fontWeight:500,color:"#5F5E5A",marginBottom:4}}>LOSS REASON</div><div style={{fontSize:12,color:"#444441"}}>{contact.lossReason}</div></div>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={cardStyle}>
            <div style={{fontSize:10,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.05em"}}>Activity & notes</div>
            <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
              <select value={newActivity.type} onChange={e=>setNewActivity(a=>({...a,type:e.target.value}))} style={{...inputStyle,fontSize:11}}>{ACTIVITY_TYPES.map(t=><option key={t}>{t}</option>)}</select>
              <input type="date" value={newActivity.date||new Date().toISOString().slice(0,10)} onChange={e=>setNewActivity(a=>({...a,date:e.target.value}))} title="Backdate this activity if it happened earlier" style={{...inputStyle,fontSize:11,width:118}}/>
              <div style={{flex:1,minWidth:180}}><input value={newActivity.note} onChange={e=>setNewActivity(a=>({...a,note:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&logActivity(contact.id)} placeholder="Log an interaction or note… (Enter to save)" style={{...inputStyle,width:"100%"}}/></div>
              <button style={{...btnStyle,fontSize:11}} onClick={()=>setShowTemplates(s=>!s)}>Templates</button>
              {mailtoHref && <a href={mailtoHref} style={{...btnStyle,fontSize:11,textDecoration:"none",display:"inline-flex",alignItems:"center"}}>Open in email →</a>}
              <button style={{...btnStyle,background:"#185FA5",color:"white",border:"none",fontSize:11}} onClick={()=>logActivity(contact.id)}>Log</button>
            </div>
            {showTemplates&&<div style={{background:"var(--color-background-secondary)",borderRadius:8,padding:10,marginBottom:12}}><div style={{fontSize:11,fontWeight:500,marginBottom:8}}>Choose a template</div><div style={{display:"flex",flexDirection:"column",gap:5}}>{templates.map(t=><div key={t.id} onClick={()=>applyTemplate(t)} style={{fontSize:11,padding:"6px 10px",borderRadius:6,background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",cursor:"pointer"}}><div style={{fontWeight:500}}>{t.name}</div><div style={{color:"var(--color-text-secondary)",marginTop:1}}>{t.subject}</div></div>)}</div></div>}
            <div>
              {(contact.activities||[]).length===0&&<div style={{fontSize:12,color:"var(--color-text-tertiary)",padding:"16px 0"}}>No activity yet. Log your first interaction above.</div>}
              {(contact.activities||[]).map((a,i)=>{ const s=ACT_STYLE[a.type]||ACT_STYLE.Note; return (
                <div key={a.id} style={{display:"flex",gap:10,padding:"10px 0",borderBottom:i<contact.activities.length-1?"0.5px solid var(--color-border-tertiary)":"none"}}>
                  <div style={{width:30,height:30,borderRadius:"50%",background:s.bg,color:s.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:500,flexShrink:0}}>{s.abbr}</div>
                  <div style={{flex:1}}><div style={{fontSize:11,fontWeight:500,marginBottom:2}}>{a.type}</div><div style={{fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.5}}>{a.note}</div><div style={{fontSize:10,color:"var(--color-text-tertiary)",marginTop:4}}>{a.date} · {a.by}</div></div>
                </div>
              );})}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplatesView({templates,saveTemplate,deleteTemplate,setModal}){
  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}><button style={{...btnStyle,background:"#185FA5",color:"white",border:"none"}} onClick={()=>setModal({type:"template",template:null})}>+ New template</button></div>
      {templates.length===0&&<div style={{textAlign:"center",padding:"48px 0",color:"var(--color-text-tertiary)",fontSize:12}}>No templates yet.</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
        {templates.map(t=>(
          <div key={t.id} style={cardStyle}>
            <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>{t.name}</div>
            <div style={{fontSize:11,color:"#185FA5",marginBottom:8}}>{t.subject}</div>
            <div style={{fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.6,whiteSpace:"pre-wrap",maxHeight:80,overflow:"hidden"}}>{t.body}</div>
            <div style={{display:"flex",gap:7,marginTop:12}}>
              <button style={btnStyle} onClick={()=>setModal({type:"template",template:t})}>Edit</button>
              <button style={{...btnStyle,color:"#A32D2D",borderColor:"#F09595"}} onClick={()=>deleteTemplate(t.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddContactModal({onClose,onSave,prefillStage,edit,contact,currentUserEmail}){
  const [form,setForm]=useState(contact||{company:"",contactName:"",title:"",email:"",phone:"",linkedin:"",location:"",companySize:"",website:"",stage:prefillStage||"New Lead",source:"Scraped",assignedTo:currentUserEmail||"You",followUpDate:"",currentSupplier:"",contractEnd:"",frameworks:[],tags:[],industry:"",estimatedValue:"",notes:""});
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const toggleFW=(fw)=>set("frameworks",form.frameworks.includes(fw)?form.frameworks.filter(x=>x!==fw):[...form.frameworks,fw]);
  return (
    <Modal onClose={onClose}>
      <div style={{fontSize:15,fontWeight:500,marginBottom:16}}>{edit?"Edit contact":"Add contact"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        {[["Company","company"],["Contact name","contactName"],["Job title","title"],["Email","email"],["Phone","phone"],["LinkedIn URL","linkedin"],["Location","location"],["Website","website"],["Current supplier","currentSupplier"],["Contract end (e.g. 2026-09)","contractEnd"],["Industry","industry"]].map(([l,k])=>(
          <div key={k}><div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>{l}</div><input value={form[k]||""} onChange={e=>set(k,e.target.value)} style={{...inputStyle,width:"100%"}}/></div>
        ))}
        <div><div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>Company size</div><select value={form.companySize} onChange={e=>set("companySize",e.target.value)} style={{...inputStyle,width:"100%"}}><option value="">Select…</option>{["1-10","11-50","51-200","200+"].map(s=><option key={s}>{s}</option>)}</select></div>
        <div><div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>Stage</div><select value={form.stage} onChange={e=>set("stage",e.target.value)} style={{...inputStyle,width:"100%"}}>{STAGES.map(s=><option key={s}>{s}</option>)}</select></div>
        <div><div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>Source</div><select value={form.source} onChange={e=>set("source",e.target.value)} style={{...inputStyle,width:"100%"}}>{SOURCES.map(s=><option key={s}>{s}</option>)}</select></div>
        <div><div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>Follow-up date</div><input type="date" value={form.followUpDate||""} onChange={e=>set("followUpDate",e.target.value)} style={{...inputStyle,width:"100%"}}/></div>
        <div><div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>Assigned to</div><input value={form.assignedTo||""} onChange={e=>set("assignedTo",e.target.value)} placeholder="email" style={{...inputStyle,width:"100%"}}/></div>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:5}}>Frameworks</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>{FRAMEWORKS.map(fw=><span key={fw} onClick={()=>toggleFW(fw)} style={{fontSize:10,padding:"3px 9px",borderRadius:10,cursor:"pointer",background:form.frameworks.includes(fw)?"#EEEDFE":"var(--color-background-secondary)",color:form.frameworks.includes(fw)?"#3C3489":"var(--color-text-secondary)",border:form.frameworks.includes(fw)?"0.5px solid #AFA9EC":"0.5px solid transparent"}}>{fw}</span>)}</div>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:5}}>Research notes (specialism, what they actually do, anything useful before outreach)</div>
        <textarea value={form.notes||""} onChange={e=>set("notes",e.target.value)} rows={3} style={{...inputStyle,width:"100%",resize:"vertical"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:8}}>
        <button style={btnStyle} onClick={onClose}>Cancel</button>
        <button style={{...btnStyle,background:"#185FA5",color:"white",border:"none"}} onClick={()=>onSave(form)}>Save contact</button>
      </div>
    </Modal>
  );
}

function WinLossModal({stage,onClose,onSave}){
  const [reason,setReason]=useState("");
  const reasons=WIN_LOSS_REASONS[stage]||[];
  return (
    <Modal onClose={onClose}>
      <div style={{fontSize:15,fontWeight:500,marginBottom:6}}>Moving to {stage}</div>
      <div style={{fontSize:12,color:"var(--color-text-secondary)",marginBottom:14}}>What was the {stage==="Won / Active"?"winning":"loss"} reason?</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:16}}>{reasons.map(r=><span key={r} onClick={()=>setReason(r)} style={{fontSize:12,padding:"6px 12px",borderRadius:8,cursor:"pointer",background:reason===r?STAGE_STYLE[stage].bg:"var(--color-background-secondary)",color:reason===r?STAGE_STYLE[stage].color:"var(--color-text-secondary)"}}>{r}</span>)}</div>
      <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Or type your own reason…" style={{...inputStyle,width:"100%",marginBottom:14}}/>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
        <button style={btnStyle} onClick={onClose}>Cancel</button>
        <button style={{...btnStyle,background:"#185FA5",color:"white",border:"none"}} onClick={()=>onSave(reason)}>Confirm</button>
      </div>
    </Modal>
  );
}

function TemplateModal({template,onClose,onSave}){
  const [form,setForm]=useState(template||{name:"",subject:"",body:""});
  return (
    <Modal onClose={onClose}>
      <div style={{fontSize:15,fontWeight:500,marginBottom:14}}>{template?"Edit template":"New template"}</div>
      <div style={{marginBottom:10}}><div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>Template name</div><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} style={{...inputStyle,width:"100%"}}/></div>
      <div style={{marginBottom:10}}><div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>Subject line</div><input value={form.subject} onChange={e=>setForm(f=>({...f,subject:e.target.value}))} style={{...inputStyle,width:"100%"}}/></div>
      <div style={{marginBottom:10}}><div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>Body — use [Name], [Company] as placeholders</div><textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={10} style={{...inputStyle,width:"100%",resize:"vertical",lineHeight:1.6}}/></div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
        <button style={btnStyle} onClick={onClose}>Cancel</button>
        <button style={{...btnStyle,background:"#185FA5",color:"white",border:"none"}} onClick={()=>onSave(form)}>Save</button>
      </div>
    </Modal>
  );
}

const cardStyle={background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,padding:"13px 14px"};
const btnStyle={fontSize:12,padding:"6px 12px",borderRadius:7,border:"0.5px solid var(--color-border-secondary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)",cursor:"pointer",fontFamily:"inherit"};
const inputStyle={fontSize:12,padding:"6px 10px",borderRadius:7,border:"0.5px solid var(--color-border-secondary)",background:"var(--color-background-primary)",color:"var(--color-text-primary)",fontFamily:"inherit"};
const thStyle={textAlign:"left",fontSize:10,fontWeight:500,color:"var(--color-text-secondary)",padding:"5px 8px"};

const DashIcon=()=><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3"/></svg>;
const ClockIcon=()=><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 4.5V8.5L10.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>;
const PipeIcon=()=><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M4 8h8M6 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;
const PersonIcon=()=><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>;
const DocIcon=()=><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>;
const StarIcon=()=><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l2 4.2 4.5.6-3.3 3.2.8 4.5L8 11.8l-4 2.2.8-4.5-3.3-3.2 4.5-.6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>;
const TargetIcon=()=><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="3.3" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="0.8" fill="currentColor"/></svg>;

function parseContractEnd(s){
  if(!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})/);
  return m ? new Date(parseInt(m[1]),parseInt(m[2])-1,1) : null;
}
function isRenewalDueSoon(s){
  const d = parseContractEnd(s);
  if(!d) return false;
  const days = Math.floor((d-new Date())/86400000);
  return days<=60; // includes already-past (should've renewed by now)
}

function ClientsView({contacts,openContact}){
  const clients = contacts.filter(c=>c.stage==="Won / Active");
  const totalValue = clients.reduce((sum,c)=>sum+parseValue(c.estimatedValue),0);
  const renewalsDue = clients.filter(c=>isRenewalDueSoon(c.contractEnd));
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10,marginBottom:16}}>
        {[{label:"Active clients",value:clients.length},{label:"Total active value",value:formatGBP(totalValue)},{label:"Renewals due (60d)",value:renewalsDue.length,warn:renewalsDue.length>0}].map((m,i)=>(
          <div key={i} style={{background:"var(--color-background-secondary)",borderRadius:8,padding:"11px 14px"}}>
            <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>{m.label}</div>
            <div style={{fontSize:22,fontWeight:500,color:m.warn?"#A32D2D":"var(--color-text-primary)"}}>{m.value}</div>
          </div>
        ))}
      </div>
      {clients.length===0 ? (
        <div style={{textAlign:"center",padding:"48px 0",color:"var(--color-text-tertiary)",fontSize:12}}>No active clients yet — move a contact to "Won / Active" to see them here.</div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
          {clients.map(c=>{
            const renewalSoon = isRenewalDueSoon(c.contractEnd);
            return (
              <div key={c.id} onClick={()=>openContact(c)} style={{...cardStyle,cursor:"pointer",border:renewalSoon?"1px solid #EF9F27":cardStyle.border}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <Avatar name={c.contactName} size={30}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.company}</div>
                    <div style={{fontSize:10,color:"var(--color-text-secondary)"}}>{c.contactName}</div>
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--color-text-secondary)",padding:"3px 0",borderTop:"0.5px solid var(--color-border-tertiary)"}}>
                  <span>Value</span><span style={{color:"var(--color-text-primary)"}}>{c.estimatedValue?formatGBP(parseValue(c.estimatedValue)):"—"}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,padding:"3px 0"}}>
                  <span style={{color:"var(--color-text-secondary)"}}>Contract end</span>
                  <span style={{color:renewalSoon?"#A32D2D":"var(--color-text-primary)",fontWeight:renewalSoon?500:400}}>{c.contractEnd||"—"}{renewalSoon?" ⚠":""}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TendersView({tenders,contacts,openContact,logTenderInterest}){
  const [search,setSearch]=useState("");
  const [filterRegion,setFilterRegion]=useState("");
  const [filterSector,setFilterSector]=useState("");
  const [expandedId,setExpandedId]=useState(null);

  const regions = useMemo(()=>[...new Set(tenders.map(t=>t.region).filter(Boolean))].sort(),[tenders]);
  const sectors = useMemo(()=>[...new Set(tenders.map(t=>t.sector).filter(Boolean))].sort(),[tenders]);

  const filtered = useMemo(()=>{
    const q = search.toLowerCase();
    return tenders.filter(t=>{
      const matchQ = !q || `${t.title} ${t.buyer} ${t.sector}`.toLowerCase().includes(q);
      return matchQ && (!filterRegion||t.region===filterRegion) && (!filterSector||t.sector===filterSector);
    }).sort((a,b)=>new Date(a.deadline||"9999-12-31")-new Date(b.deadline||"9999-12-31"));
  },[tenders,search,filterRegion,filterSector]);

  if(!tenders.length) return <div style={{textAlign:"center",padding:"48px 0",color:"var(--color-text-tertiary)",fontSize:12}}>Loading live tender data…</div>;

  const filterLabel = [filterRegion,filterSector].filter(Boolean).join(" + ");
  return (
    <div>
      <div style={{display:"flex",gap:7,marginBottom:8,flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tenders by title, buyer, sector…" style={{flex:1,minWidth:200,...inputStyle}}/>
        <select value={filterRegion} onChange={e=>setFilterRegion(e.target.value)} style={inputStyle}><option value="">All regions</option>{regions.map(r=><option key={r}>{r}</option>)}</select>
        <select value={filterSector} onChange={e=>setFilterSector(e.target.value)} style={inputStyle}><option value="">All sectors</option>{sectors.map(s=><option key={s}>{s}</option>)}</select>
      </div>
      <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginBottom:8}}>
        {filtered.length} tender{filtered.length!==1?"s":""}{filterLabel?` — ${filterLabel}`:""}, soonest-closing first{filtered.length>100?" — showing first 100, search to narrow":""}
      </div>
      {filtered.slice(0,100).map(t=>{
        const expanded = expandedId===t.id;
        const matches = expanded ? matchContactsForTender(contacts,t) : [];
        return (
          <div key={t.id} style={{...cardStyle,marginBottom:8,padding:"10px 14px",cursor:"pointer"}} onClick={()=>setExpandedId(expanded?null:t.id)}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                <div style={{fontSize:11,color:"var(--color-text-secondary)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.buyer} · {t.region||"—"} · {t.sector||"—"}</div>
              </div>
              <div style={{fontSize:11,color:"var(--color-text-tertiary)",flexShrink:0,textAlign:"right"}}>
                {t.deadline?<div>closes {new Date(t.deadline).toLocaleDateString("en-GB")}</div>:null}
                {t.value?<div>{formatGBP(t.value)}</div>:null}
              </div>
            </div>
            {expanded && (
              <div style={{marginTop:10,paddingTop:10,borderTop:"0.5px solid var(--color-border-tertiary)"}} onClick={e=>e.stopPropagation()}>
                <div style={{fontSize:10,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>Matching companies in {t.region||"—"}</div>
                {matches.length===0 ? <div style={{fontSize:11,color:"var(--color-text-tertiary)"}}>No CRM contacts located in this region yet.</div> :
                  matches.map(c=>(
                    <div key={c.id} onClick={()=>openContact(c)} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",cursor:"pointer"}}>
                      <Avatar name={c.contactName} size={22}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.company}</div>
                        <div style={{fontSize:10,color:"var(--color-text-secondary)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.notes?c.notes.slice(0,90):c.contactName}</div>
                      </div>
                      {(c.tags||[]).includes("tier-1")&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:8,background:"#EEEDFE",color:"#3C3489",flexShrink:0}}>framework</span>}
                      <button onClick={e=>{e.stopPropagation();logTenderInterest(c.id,t);}} style={{...btnStyle,fontSize:10,padding:"3px 8px",flexShrink:0}}>Flag interest</button>
                    </div>
                  ))
                }
                <a href={t.url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#185FA5",display:"inline-block",marginTop:8}}>View full tender →</a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
