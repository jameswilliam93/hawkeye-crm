import { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

// ── Palette & helpers ────────────────────────────────────────────────
const STAGES = ["New Lead","Researched","Contacted","Follow-up Due","Meeting Booked","Proposal Sent","Won / Active","Lost / Dead"];
const SOURCES = ["Scraped","LinkedIn","Framework","Referral","Inbound","Other"];
const FRAMEWORKS = ["CCS RM6277","CCS RM3749","YPO 660","ESPO 660","Crown Commercial","G-Cloud","Other"];
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
  const [selected, setSelected] = useState([]);
  const [newActivity, setNewActivity] = useState({type:"Email",note:""});
  const [toastMsg, setToastMsg] = useState("");

  const toast = (msg)=>{ setToastMsg(msg); setTimeout(()=>setToastMsg(""),2500); };
  const closeModal = ()=>setModal(null);
  const openContact = (c)=>{ setSelectedContact(c.id); setView("contact"); };

  const loadData = useCallback(async ()=>{
    setLoading(true);
    try {
      const [{ data: contactRows }, { data: activityRows }, { data: templateRows }] = await Promise.all([
        supabase.from("contacts").select("*").order("created_at", { ascending: false }),
        supabase.from("activities").select("*").order("date", { ascending: false }),
        supabase.from("templates").select("*").order("created_at", { ascending: true }),
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

  const addContact = async (data)=>{
    const { data: row, error } = await supabase.from("contacts").insert([{
      company: data.company, contact_name: data.contactName, title: data.title,
      email: data.email, phone: data.phone, linkedin: data.linkedin,
      location: data.location, company_size: data.companySize, website: data.website,
      industry: data.industry, stage: data.stage||"New Lead", source: data.source,
      assigned_to: data.assignedTo||"You", follow_up_date: data.followUpDate||null,
      current_supplier: data.currentSupplier, contract_end: data.contractEnd,
      frameworks: data.frameworks||[], tags: data.tags||[], estimated_value: data.estimatedValue,
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

  const logActivity = async (contactId)=>{
    if(!newActivity.note.trim()) return;
    const today = new Date().toISOString().slice(0,10);
    const { data: row, error } = await supabase.from("activities").insert([{
      contact_id: contactId, type: newActivity.type, note: newActivity.note,
      date: today, by: session?.user?.email||"You",
    }]).select().single();
    if(error){ toast("Error logging activity"); return; }
    setContacts(cs=>cs.map(c=>c.id===contactId?{...c,activities:[mapActivity(row),...c.activities],lastContacted:today}:c));
    await supabase.from("contacts").update({last_contacted:today}).eq("id",contactId);
    setNewActivity({type:"Email",note:""});
    toast("Activity logged");
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
    const matchQ = !q||c.company.toLowerCase().includes(q)||c.contactName.toLowerCase().includes(q)||(c.tags||[]).join(" ").toLowerCase().includes(q);
    return matchQ&&(!filterStage||c.stage===filterStage)&&(!filterSource||c.source===filterSource);
  }),[contacts,search,filterStage,filterSource]);

  const overdueContacts = contacts.filter(c=>!["Won / Active","Lost / Dead"].includes(c.stage)&&isOverdue(c.followUpDate));
  const stalContacts = contacts.filter(c=>!["Won / Active","Lost / Dead","New Lead"].includes(c.stage)&&c.lastContacted&&(Math.floor((Date.now()-new Date(c.lastContacted))/(86400000)))>=14);
  const contact = contacts.find(c=>c.id===selectedContact);

  const navItems = [
    {id:"dashboard",label:"Dashboard",icon:<DashIcon/>},
    {id:"followups",label:"Follow-ups",icon:<ClockIcon/>,badge:overdueContacts.length||null},
    {id:"pipeline",label:"Pipeline",icon:<PipeIcon/>},
    {id:"contacts",label:"Contacts",icon:<PersonIcon/>},
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
            {view==="contact"&&contact?`${contact.company} — ${contact.contactName}`:view==="dashboard"?"Dashboard":view==="followups"?"Follow-ups":view==="pipeline"?"Pipeline":view==="contacts"?"Contacts":"Templates"}
          </span>
          <div style={{display:"flex",gap:8}}>
            {view==="contacts"&&selected.length>0&&(
              <select onChange={e=>{if(e.target.value){bulkStage(e.target.value);e.target.value=""}}} style={btnStyle} defaultValue="">
                <option value="">Bulk move ({selected.length})…</option>
                {STAGES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <button style={btnStyle} onClick={()=>setModal({type:"import"})}>Import CSV</button>
            <button style={{...btnStyle,background:"#185FA5",color:"white",border:"none"}} onClick={()=>setModal({type:"addContact",stage:""})}>+ Add contact</button>
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:18}}>
          {view==="dashboard"&&<DashboardView contacts={contacts} openContact={openContact}/>}
          {view==="followups"&&<FollowupsView contacts={contacts} openContact={openContact} updateContact={updateContact} toast={toast}/>}
          {view==="pipeline"&&<PipelineView contacts={contacts} openContact={openContact} moveStage={moveStage} setModal={setModal} stalContacts={stalContacts}/>}
          {view==="contacts"&&<ContactsView contacts={filteredContacts} search={search} setSearch={setSearch} filterStage={filterStage} setFilterStage={setFilterStage} filterSource={filterSource} setFilterSource={setFilterSource} selected={selected} setSelected={setSelected} openContact={openContact}/>}
          {view==="contact"&&contact&&<ContactProfile contact={contact} updateContact={updateContact} moveStage={moveStage} newActivity={newActivity} setNewActivity={setNewActivity} logActivity={logActivity} setView={setView} setModal={setModal} templates={templates}/>}
          {view==="templates"&&<TemplatesView templates={templates} saveTemplate={saveTemplate} deleteTemplate={deleteTemplate} setModal={setModal}/>}
        </div>
      </div>

      {modal?.type==="addContact"&&<AddContactModal onClose={closeModal} onSave={(d)=>{addContact({...d,stage:modal.stage||"New Lead"});closeModal();}} prefillStage={modal.stage}/>}
      {modal?.type==="editContact"&&<AddContactModal edit contact={modal.contact} onClose={closeModal} onSave={(d)=>{updateContact(modal.contact.id,d);closeModal();toast("Saved");}}/>}
      {modal?.type==="winloss"&&<WinLossModal stage={modal.stage} onClose={closeModal} onSave={(reason)=>{updateContact(modal.id,{stage:modal.stage,lossReason:reason});closeModal();toast(`Moved to ${modal.stage}`);}}/>}
      {modal?.type==="template"&&<TemplateModal template={modal.template} onClose={closeModal} onSave={(t)=>{saveTemplate(t);closeModal();}}/>}
      {modal?.type==="import"&&<Modal onClose={closeModal}><div style={{textAlign:"center",padding:"20px 0"}}><div style={{fontSize:15,fontWeight:500,marginBottom:8}}>Import contacts from CSV</div><div style={{fontSize:12,color:"var(--color-text-secondary)",marginBottom:16}}>CSV should have columns: Company, Contact Name, Title, Email, Phone, Stage, Source, Tags</div><div style={{border:"2px dashed var(--color-border-secondary)",borderRadius:8,padding:"32px 16px",color:"var(--color-text-tertiary)",fontSize:12}}>Drop CSV file here or click to browse</div><button style={{...btnStyle,marginTop:16}} onClick={closeModal}>Close</button></div></Modal>}
      {toastMsg&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#185FA5",color:"white",padding:"8px 18px",borderRadius:20,fontSize:12,fontWeight:500,zIndex:2000,pointerEvents:"none"}}>{toastMsg}</div>}
    </div>
  );
}

function DashboardView({contacts,openContact}){
  const stageCounts = STAGES.map(s=>({stage:s,count:contacts.filter(c=>c.stage===s).length}));
  const overdue = contacts.filter(c=>!["Won / Active","Lost / Dead"].includes(c.stage)&&isOverdue(c.followUpDate));
  const recentActs = contacts.flatMap(c=>(c.activities||[]).map(a=>({...a,company:c.company}))).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6);
  const barMax = Math.max(...stageCounts.map(s=>s.count),1);
  const BAR_COLORS = {"New Lead":"#B5D4F4","Researched":"#CECBF6","Contacted":"#FAC775","Follow-up Due":"#F09595","Meeting Booked":"#C0DD97","Proposal Sent":"#F4C0D1","Won / Active":"#5DCAA5","Lost / Dead":"#D3D1C7"};
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:10,marginBottom:16}}>
        {[{label:"Total contacts",value:contacts.length},{label:"Active pipeline",value:contacts.filter(c=>!["Won / Active","Lost / Dead"].includes(c.stage)).length},{label:"Won / active",value:contacts.filter(c=>c.stage==="Won / Active").length,up:true},{label:"Overdue follow-ups",value:overdue.length,warn:overdue.length>0}].map((m,i)=>(
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
      </div>
      <div style={cardStyle}>
        <div style={{fontSize:12,fontWeight:500,marginBottom:10}}>Recent activity</div>
        {recentActs.length===0?<div style={{fontSize:12,color:"var(--color-text-tertiary)"}}>No activity logged yet.</div>:
        recentActs.map(a=>(
          <div key={a.id} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
            <div style={{fontSize:11,color:"var(--color-text-tertiary)",width:64,flexShrink:0,paddingTop:1}}>{daysAgo(a.date)}</div>
            <div style={{fontSize:11,color:"var(--color-text-secondary)",marginRight:4,flexShrink:0}}>{a.type}</div>
            <div style={{fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><strong>{a.company}</strong> — {a.note}</div>
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

function PipelineView({contacts,openContact,moveStage,setModal,stalContacts}){
  const stalIds = new Set(stalContacts.map(c=>c.id));
  return (
    <div>
      {stalContacts.length>0&&<div style={{background:"#FAEEDA",border:"0.5px solid #EF9F27",borderRadius:8,padding:"8px 12px",marginBottom:12}}><span style={{fontSize:11,color:"#633806"}}>⚠ {stalContacts.length} contact{stalContacts.length>1?"s":""} not touched in 14+ days: {stalContacts.map(c=>c.company).join(", ")}</span></div>}
      {contacts.length===0&&<div style={{textAlign:"center",padding:"48px 0",color:"var(--color-text-tertiary)",fontSize:12}}>No contacts yet. Click "+ Add contact" to get started.</div>}
      <div style={{display:"flex",gap:9,overflowX:"auto",paddingBottom:8}}>
        {STAGES.map(stage=>{
          const cols=contacts.filter(c=>c.stage===stage);
          const {bg,color}=STAGE_STYLE[stage];
          return (
            <div key={stage} style={{minWidth:168,flexShrink:0}}>
              <div style={{fontSize:11,fontWeight:500,padding:"5px 9px",borderRadius:8,marginBottom:8,background:bg,color,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:110}}>{stage}</span>
                <span style={{fontSize:10,background:"rgba(0,0,0,.07)",padding:"1px 5px",borderRadius:8,flexShrink:0,marginLeft:4}}>{cols.length}</span>
              </div>
              {cols.map(c=>(
                <div key={c.id} onClick={()=>openContact(c)} style={{background:"var(--color-background-primary)",border:stalIds.has(c.id)?"1px solid #EF9F27":"0.5px solid var(--color-border-tertiary)",borderRadius:8,padding:"9px",marginBottom:5,cursor:"pointer",opacity:stage==="Lost / Dead"?0.55:1}}>
                  <div style={{fontSize:12,fontWeight:500,marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.company}</div>
                  <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.contactName} · {c.title}</div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontSize:10,padding:"2px 5px",borderRadius:6,background:"var(--color-background-secondary)",color:"var(--color-text-secondary)"}}>{c.source}</span>
                    <span style={{fontSize:10,color:isOverdue(c.followUpDate)?"#A32D2D":stalIds.has(c.id)?"#854F0B":"var(--color-text-tertiary)",fontWeight:isOverdue(c.followUpDate)?500:400}}>{isOverdue(c.followUpDate)?"Overdue":stalIds.has(c.id)?"Stale":daysAgo(c.addedDate)||""}</span>
                  </div>
                  {(c.tags||[]).length>0&&<div style={{marginTop:5,display:"flex",flexWrap:"wrap",gap:3}}>{c.tags.slice(0,2).map(t=><span key={t} style={{fontSize:9,padding:"1px 5px",borderRadius:8,background:"#E6F1FB",color:"#0C447C"}}>{t}</span>)}</div>}
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

function ContactsView({contacts,search,setSearch,filterStage,setFilterStage,filterSource,setFilterSource,selected,setSelected,openContact}){
  const toggleSelect=(id)=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const allSelected=contacts.length>0&&contacts.every(c=>selected.includes(c.id));
  const toggleAll=()=>setSelected(allSelected?[]:contacts.map(c=>c.id));
  return (
    <div>
      <div style={{display:"flex",gap:7,marginBottom:12,flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search contacts, companies, tags…" style={{flex:1,minWidth:180,...inputStyle}}/>
        <select value={filterStage} onChange={e=>setFilterStage(e.target.value)} style={inputStyle}><option value="">All stages</option>{STAGES.map(s=><option key={s}>{s}</option>)}</select>
        <select value={filterSource} onChange={e=>setFilterSource(e.target.value)} style={inputStyle}><option value="">All sources</option>{SOURCES.map(s=><option key={s}>{s}</option>)}</select>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
          <thead><tr style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
            <th style={{width:28,padding:"5px 8px"}}><input type="checkbox" checked={allSelected} onChange={toggleAll}/></th>
            <th style={thStyle}>Company</th><th style={thStyle}>Contact</th><th style={thStyle}>Stage</th><th style={thStyle}>Tags</th><th style={thStyle}>Supplier</th><th style={thStyle}>Follow-up</th><th style={thStyle}>Source</th>
          </tr></thead>
          <tbody>
            {contacts.map(c=>(
              <tr key={c.id} onClick={()=>openContact(c)} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="var(--color-background-secondary)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"8px"}} onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected.includes(c.id)} onChange={()=>toggleSelect(c.id)}/></td>
                <td style={{padding:"8px",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.company}</td>
                <td style={{padding:"8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><Avatar name={c.contactName} size={22}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.contactName}</span></div></td>
                <td style={{padding:"8px"}}><StagePill stage={c.stage} small/></td>
                <td style={{padding:"8px"}}><div style={{display:"flex",flexWrap:"wrap",gap:3}}>{(c.tags||[]).slice(0,2).map(t=><span key={t} style={{fontSize:9,padding:"1px 5px",borderRadius:8,background:"#E6F1FB",color:"#0C447C"}}>{t}</span>)}</div></td>
                <td style={{padding:"8px",fontSize:11,color:"var(--color-text-secondary)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.currentSupplier||"—"}</td>
                <td style={{padding:"8px",fontSize:11,color:isOverdue(c.followUpDate)?"#A32D2D":"var(--color-text-secondary)",fontWeight:isOverdue(c.followUpDate)?500:400}}>{c.followUpDate?daysAgo(c.followUpDate):"Not set"}</td>
                <td style={{padding:"8px",fontSize:11,color:"var(--color-text-secondary)"}}>{c.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {contacts.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:"var(--color-text-tertiary)",fontSize:12}}>No contacts match your filters.</div>}
      </div>
    </div>
  );
}

function ContactProfile({contact,updateContact,moveStage,newActivity,setNewActivity,logActivity,setView,setModal,templates}){
  const [tagInput,setTagInput]=useState("");
  const [showTemplates,setShowTemplates]=useState(false);
  const [editFollowUp,setEditFollowUp]=useState(false);
  const addTag=(t)=>{ if(!t.trim()||contact.tags?.includes(t)) return; updateContact(contact.id,{tags:[...(contact.tags||[]),t.trim()]}); setTagInput(""); };
  const removeTag=(t)=>updateContact(contact.id,{tags:(contact.tags||[]).filter(x=>x!==t)});
  const applyTemplate=(tmpl)=>{ setNewActivity(a=>({...a,type:"Email",note:tmpl.body.replace(/\[Name\]/g,contact.contactName.split(" ")[0]).replace(/\[Company\]/g,contact.company)})); setShowTemplates(false); };
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
        <button style={btnStyle} onClick={()=>setView("contacts")}>← Back</button>
        <span style={{fontSize:11,color:"var(--color-text-secondary)"}}>Contacts / {contact.company}</span>
        <div style={{marginLeft:"auto",display:"flex",gap:7}}>
          <button style={btnStyle} onClick={()=>setModal({type:"editContact",contact})}>Edit</button>
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
          <div style={cardStyle}>
            <div style={{fontSize:10,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Pipeline</div>
            {[{l:"Stage",v:<StagePill stage={contact.stage} small/>},{l:"Source",v:contact.source},{l:"Assigned",v:contact.assignedTo},{l:"Added",v:contact.addedDate},{l:"Last contact",v:contact.lastContacted?daysAgo(contact.lastContacted):"Never"}].map(({l,v})=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",gap:8}}>
                <span style={{fontSize:11,color:"var(--color-text-secondary)"}}>{l}</span><span style={{fontSize:11}}>{v}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",gap:8}}>
              <span style={{fontSize:11,color:"var(--color-text-secondary)"}}>Follow-up</span>
              {editFollowUp?<input type="date" defaultValue={contact.followUpDate||""} onBlur={e=>{updateContact(contact.id,{followUpDate:e.target.value});setEditFollowUp(false);}} autoFocus style={{fontSize:10,padding:"2px 5px",border:"0.5px solid var(--color-border-secondary)",borderRadius:4,background:"var(--color-background-primary)",color:"var(--color-text-primary)"}}/>:<span onClick={()=>setEditFollowUp(true)} style={{fontSize:11,color:isOverdue(contact.followUpDate)?"#A32D2D":"#185FA5",cursor:"pointer",fontWeight:isOverdue(contact.followUpDate)?500:400}}>{contact.followUpDate?daysAgo(contact.followUpDate):"Set date"}</span>}
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{fontSize:10,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>Supplier & Frameworks</div>
            {[{l:"Curr. supplier",v:contact.currentSupplier},{l:"Contract end",v:contact.contractEnd}].filter(x=>x.v).map(({l,v})=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",gap:8}}><span style={{fontSize:11,color:"var(--color-text-secondary)"}}>{l}</span><span style={{fontSize:11}}>{v}</span></div>
            ))}
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:8}}>
              {(contact.frameworks||[]).map(f=><span key={f} style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#EEEDFE",color:"#3C3489"}}>{f}</span>)}
              {(contact.frameworks||[]).length===0&&<span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>No frameworks added</span>}
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
              <div style={{flex:1,minWidth:180}}><input value={newActivity.note} onChange={e=>setNewActivity(a=>({...a,note:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&logActivity(contact.id)} placeholder="Log an interaction or note… (Enter to save)" style={{...inputStyle,width:"100%"}}/></div>
              <button style={{...btnStyle,fontSize:11}} onClick={()=>setShowTemplates(s=>!s)}>Templates</button>
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

function AddContactModal({onClose,onSave,prefillStage,edit,contact}){
  const [form,setForm]=useState(contact||{company:"",contactName:"",title:"",email:"",phone:"",linkedin:"",location:"",companySize:"",website:"",stage:prefillStage||"New Lead",source:"Scraped",assignedTo:"You",followUpDate:"",currentSupplier:"",contractEnd:"",frameworks:[],tags:[],industry:"",estimatedValue:""});
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
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:5}}>Frameworks</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>{FRAMEWORKS.map(fw=><span key={fw} onClick={()=>toggleFW(fw)} style={{fontSize:10,padding:"3px 9px",borderRadius:10,cursor:"pointer",background:form.frameworks.includes(fw)?"#EEEDFE":"var(--color-background-secondary)",color:form.frameworks.includes(fw)?"#3C3489":"var(--color-text-secondary)",border:form.frameworks.includes(fw)?"0.5px solid #AFA9EC":"0.5px solid transparent"}}>{fw}</span>)}</div>
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