import { useState } from 'react'
import { supabase } from './supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const login = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#F4F5F7',fontFamily:"'DM Sans', system-ui, sans-serif"}}>
      <div style={{background:'white',borderRadius:12,padding:'36px 32px',width:'100%',maxWidth:380,border:'0.5px solid #E0E0E0',boxShadow:'0 4px 24px rgba(0,0,0,0.06)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:24}}>
          <div style={{width:28,height:28,borderRadius:'50%',background:'#185FA5',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <div style={{width:10,height:10,borderRadius:'50%',background:'white'}}/>
          </div>
          <span style={{fontSize:16,fontWeight:600,letterSpacing:'-0.3px'}}>HawkeyeCRM</span>
        </div>
        <div style={{fontSize:18,fontWeight:500,marginBottom:4}}>Sign in</div>
        <div style={{fontSize:12,color:'#888',marginBottom:20}}>Recruitment outreach — team access only</div>
        <form onSubmit={login}>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:'#666',marginBottom:4}}>Email</div>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required
              style={{width:'100%',fontSize:13,padding:'8px 10px',borderRadius:7,border:'0.5px solid #D0D0D0',fontFamily:'inherit',boxSizing:'border-box'}}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,color:'#666',marginBottom:4}}>Password</div>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required
              style={{width:'100%',fontSize:13,padding:'8px 10px',borderRadius:7,border:'0.5px solid #D0D0D0',fontFamily:'inherit',boxSizing:'border-box'}}/>
          </div>
          {error&&<div style={{fontSize:12,color:'#A32D2D',marginBottom:12,background:'#FCEBEB',padding:'8px 10px',borderRadius:6}}>{error}</div>}
          <button type="submit" disabled={loading}
            style={{width:'100%',padding:'9px',background:'#185FA5',color:'white',border:'none',borderRadius:7,fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:'inherit'}}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}