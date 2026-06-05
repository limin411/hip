import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'

export function LoginScreen() {
  const navigate = useNavigate()
  return (
    <div className="flex h-screen items-center justify-center">
      <Button onClick={() => navigate('/app')}>进入应用（占位）</Button>
    </div>
  )
}
