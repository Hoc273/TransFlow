export type CreditTransactionType =
  | 'INITIAL_GRANT'
  | 'PACKAGE_PURCHASE'
  | 'AI_USAGE'
  | 'ADJUSTMENT'

export type CreditBalance = {
  balance: number
}

export type CreditTransaction = {
  id: string
  userId: string
  amount: number
  balanceAfter: number
  type: CreditTransactionType
  performedByUserId: string | null
  refType: string | null
  refId: string | null
  createdAt: string
}

export type CreditPackage = {
  id: string
  name: string
  creditAmount: number
  priceAmount: number
  priceCurrency: string
  isActive: boolean
  createdAt: string
}

export type CreditPurchase = {
  purchaseId: string
  packageId: string
  creditAmount: number
  pricePaid: number
  paymentReference: string
  newBalance: number
  purchasedAt: string
}

export type CreditTransactionPage = {
  items: CreditTransaction[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type CreditTransactionQuery = {
  type?: CreditTransactionType
  from?: string
  to?: string
  page?: number
  size?: number
}
