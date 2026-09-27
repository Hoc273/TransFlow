export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export type PasswordStrength = 'weak' | 'medium' | 'strong' | null

export function scorePassword(password: string): {
  score: number
  strength: PasswordStrength
  hasLen: boolean
  hasUpper: boolean
  hasNum: boolean
  hasSpecial: boolean
} {
  if (!password) {
    return {
      score: 0,
      strength: null,
      hasLen: false,
      hasUpper: false,
      hasNum: false,
      hasSpecial: false,
    }
  }

  const hasLen = password.length >= 8
  const hasUpper = /[A-Z]/.test(password)
  const hasNum = /[0-9]/.test(password)
  const hasSpecial = /[^A-Za-z0-9]/.test(password)

  let score = 0
  if (hasLen) score++
  if (hasUpper) score++
  if (hasNum) score++
  if (hasSpecial) score++

  const strength: PasswordStrength = score <= 1 ? 'weak' : score <= 2 ? 'medium' : 'strong'

  return { score, strength, hasLen, hasUpper, hasNum, hasSpecial }
}
