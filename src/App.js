import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import Login from './Login'
import HawkeyeCRM from './HawkeyeCRM'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui',color:'#888',fontSize:13}}>
      Loading…
    </div>
  )

  return session ? <HawkeyeCRM session={session} /> : <Login />
}