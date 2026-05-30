import { useState } from "react"

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <div style={{padding:20, fontFamily:"Inter, sans-serif"}}>
      <h1 style={{color:"#FC4C02"}}>Gate 🏁</h1>
      <p>App is live and working</p>
      <button onClick={()=>setCount(c=>c+1)} style={{marginTop:20, padding:"10px 20px", background:"#FC4C02", color:"white", border:"none", borderRadius:8, fontSize:16}}>
        Tapped {count} times
      </button>
    </div>
  )
}
